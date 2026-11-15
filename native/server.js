const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { fromIni } = require("@aws-sdk/credential-providers");
const ZipStream = require("zip-stream").default;
const sharp = require("sharp");
const { RemoteAgentManager } = require("./remote-agent");

const NATIVE_MODE = process.argv.includes("--native");
let PORT = NATIVE_MODE ? 0 : Number(process.env.IMAGE_VIEWER_PORT || 39281);
const HOST = "127.0.0.1";
const STATIC_ROOT = path.resolve(__dirname, "..");
const TILE_SIZE = 512;
const SESSION_TOKEN = crypto.randomBytes(24).toString("base64url");
const CACHE_ROOT =
  process.env.IMAGE_VIEWER_CACHE ||
  path.join(os.homedir(), "Library", "Caches", "image-browser");
const THUMBNAIL_DIR = path.join(CACHE_ROOT, "thumbnails");
const BROWSER_IMAGE_DIR = path.join(CACHE_ROOT, "browser-images");
const DEEP_ZOOM_DIR = path.join(CACHE_ROOT, "deepzoom");
const REMOTE_DIR = path.join(CACHE_ROOT, "remote");
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff",
  ".gif", ".bmp", ".avif", ".heic", ".heif", ".svg",
]);
const ARCHIVE_SUFFIXES = [
  ".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".txz", ".tar", ".zip",
];
const jobs = new Map();
let browserImageQueue = Promise.resolve();
const remoteAgents = new RemoteAgentManager();
const remoteBrowserImages = new Map();
const browserImageProgress = new Map();
const htmlRenderSessions = new Map();
const archiveListings = new Map();
const downloadSelections = new Map();

function sendNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function setupNativeChannel(server) {
  let input = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 4) {
      const length = input.readUInt32LE(0);
      if (length > 1024 * 1024) {
        process.stderr.write("Native message is too large\n");
        process.exit(1);
      }
      if (input.length < length + 4) break;
      const payload = input.subarray(4, length + 4);
      input = input.subarray(length + 4);
      try {
        const message = JSON.parse(payload.toString("utf8"));
        if (message.type === "start" || message.type === "ping") {
          sendNativeMessage({
            type: message.type === "ping" ? "pong" : "ready",
            port: PORT,
            token: SESSION_TOKEN,
          });
        }
      } catch (error) {
        process.stderr.write(`Invalid native message: ${error.message}\n`);
      }
    }
  });
  process.stdin.on("end", async () => {
    await remoteAgents.close();
    server.close(() => process.exit(0));
  });
  process.stdin.resume();
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function encodeDescriptor(descriptor) {
  return Buffer.from(JSON.stringify(descriptor)).toString("base64url");
}

function archiveFormatFor(filePath) {
  const lower = String(filePath || "").toLowerCase();
  const suffix = ARCHIVE_SUFFIXES.find((item) => lower.endsWith(item));
  if (!suffix) return "";
  return suffix === ".zip" ? "zip" : "tar";
}

function entryTypeForPath(filePath) {
  if (IMAGE_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase())) return "image";
  if (archiveFormatFor(filePath)) return "archive";
  return "file";
}

function validDescriptor(descriptor, depth = 0) {
  if (!descriptor || depth > 5) return false;
  if (descriptor.kind === "archive") {
    return Boolean(descriptor.member) && validDescriptor(descriptor.archive, depth + 1);
  }
  if (!["local", "ssh", "s3"].includes(descriptor.kind)) return false;
  return descriptor.kind === "s3" ? Boolean(descriptor.key) : Boolean(descriptor.path);
}

function decodeDescriptor(id) {
  if (!id || id.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpError(400, "无效的图片标识");
  }
  try {
    const descriptor = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
    if (!validDescriptor(descriptor)) {
      throw new Error("invalid");
    }
    return descriptor;
  } catch {
    throw new HttpError(400, "无法解析图片标识");
  }
}

function parseSource(input) {
  const rawSource = input.trim();
  const storageMatch = rawSource.match(/^(s3|oss):\/\/(.*)$/i);
  const source = storageMatch ? `s3://${storageMatch[2]}` : rawSource;
  if (!source) throw new HttpError(400, "请输入目录路径");

  if (source.startsWith("s3://")) {
    let url;
    try {
      url = new URL(source);
    } catch {
      throw new HttpError(400, "S3/OSS 路径格式不正确");
    }
    if (!url.hostname) throw new HttpError(400, "S3/OSS 路径缺少 bucket");
    const requestedAsDirectory = url.pathname.endsWith("/");
    const requestedKey = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
    const prefix = requestedKey ? `${requestedKey}/` : "";
    const connectionId = url.searchParams.get("connection") || undefined;
    const savedConfig = connectionId ? s3Configurations.get(connectionId) : undefined;
    if (connectionId && !savedConfig) {
      throw new HttpError(400, "S3 配置未加载，请刷新插件后重试");
    }
    return {
      kind: "s3",
      bucket: url.hostname,
      prefix,
      requestedKey,
      requestedAsDirectory,
      connectionId,
      endpoint: savedConfig?.endpoint || url.searchParams.get("endpoint") || undefined,
      region: savedConfig?.region || url.searchParams.get("region") || undefined,
      profile: savedConfig?.profile || url.searchParams.get("profile") || undefined,
      forcePathStyle: savedConfig
        ? savedConfig.forcePathStyle
        : url.searchParams.has("forcePathStyle")
          ? url.searchParams.get("forcePathStyle") !== "0"
          : undefined,
      source,
    };
  }

  if (source.startsWith("ssh://")) {
    let url;
    try {
      url = new URL(source);
    } catch {
      throw new HttpError(400, "SSH 链接格式不正确");
    }
    const host = url.hostname;
    const username = decodeURIComponent(url.username);
    const remotePath = decodeURIComponent(url.pathname);
    const port = url.port ? Number(url.port) : undefined;
    if (!host || !remotePath || (port && (!Number.isInteger(port) || port > 65535))) {
      throw new HttpError(400, "SSH 链接缺少主机或目录");
    }
    return makeSshSource(username ? `${username}@${host}` : host, remotePath, port, source);
  }

  const scpValue = source.startsWith("ssh ") ? source.slice(4).trim() : source;
  const scpMatch = scpValue.match(/^([A-Za-z0-9_.-]+(?:@[A-Za-z0-9_.-]+)?):(.*)$/);
  if (scpMatch) {
    return makeSshSource(scpMatch[1], scpMatch[2] || "~", undefined, source);
  }
  if (
    source.startsWith("ssh ") &&
    /^[A-Za-z0-9_.-]+(?:@[A-Za-z0-9_.-]+)?$/.test(scpValue)
  ) {
    return makeSshSource(scpValue, "~", undefined, source);
  }

  return {
    kind: "local",
    path: path.resolve(source.replace(/^~(?=\/|$)/, os.homedir())),
    source,
  };
}

function makeSshSource(target, remotePath, port, source) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(target)) {
    throw new HttpError(400, "SSH 用户名或主机名包含不支持的字符");
  }
  return {
    kind: "ssh",
    target,
    port,
    path: remotePath.startsWith("/") ? path.posix.normalize(remotePath) : remotePath,
    source,
  };
}

function sshArgs(source, command) {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=12",
    "-o", "ServerAliveInterval=15",
    "-o", "ClearAllForwardings=yes",
    "-o", "LogLevel=ERROR",
  ];
  if (source.port) args.push("-p", String(source.port));
  args.push(source.target, command);
  return args;
}

function remoteShellPath(remotePath) {
  if (remotePath === "~") return '"$HOME"';
  if (remotePath.startsWith("~/")) {
    return `"$HOME"${shellQuote(remotePath.slice(1))}`;
  }
  return shellQuote(remotePath);
}

async function runCommand(command, args, options = {}) {
  const maxBytes = options.maxBytes || 32 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        fail(new HttpError(413, "目录内容过多，请缩小目录范围"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes < 1024 * 1024) stderr.push(chunk);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new HttpError(502, detail || `${command} 退出码 ${code}`));
      }
    });
  });
}

async function listLocal(source, recursive) {
  let rootStat;
  try {
    rootStat = await fsp.stat(source.path);
  } catch {
    throw new HttpError(404, `目录不存在：${source.path}`);
  }
  if (rootStat.isFile()) {
    return {
      targetType: "file",
      entries: [{
        id: encodeDescriptor({
          kind: "local",
          path: source.path,
          size: rootStat.size,
          modified: rootStat.mtimeMs,
        }),
        type: entryTypeForPath(source.path),
        name: path.basename(source.path),
        relativePath: path.basename(source.path),
        size: rootStat.size,
        modified: rootStat.mtimeMs,
      }],
    };
  }
  if (!rootStat.isDirectory()) throw new HttpError(400, "输入的路径不是文件或目录");

  const entriesResult = [];
  const queue = [source.path];
  while (queue.length) {
    const directory = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === source.path) throw error;
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          queue.push(fullPath);
        } else {
          entriesResult.push({
            id: encodeDescriptor({ kind: "local", path: fullPath, directory: true }),
            type: "directory",
            name: entry.name,
            relativePath: path.relative(source.path, fullPath),
            childSource: fullPath,
            size: null,
            modified: null,
          });
        }
      } else if (entry.isFile()) {
        const stat = await fsp.stat(fullPath).catch(() => null);
        if (!stat) continue;
        const descriptor = {
          kind: "local",
          path: fullPath,
          size: stat.size,
          modified: stat.mtimeMs,
        };
        entriesResult.push({
          id: encodeDescriptor(descriptor),
          type: entryTypeForPath(entry.name),
          name: entry.name,
          relativePath: path.relative(source.path, fullPath),
          size: stat.size,
          modified: stat.mtimeMs,
        });
      }
      if (entriesResult.length >= 100000) break;
    }
    if (entriesResult.length >= 100000) break;
  }
  const entries = entriesResult.sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.relativePath.localeCompare(b.relativePath, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  return { targetType: "directory", entries };
}

function sshChildSource(source, remotePath) {
  if (source.source.startsWith("ssh ")) {
    return `ssh ${source.target}:${remotePath}`;
  }
  if (source.source.startsWith("ssh://")) {
    const port = source.port ? `:${source.port}` : "";
    const normalized = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
    return `ssh://${source.target}${port}${normalized}`;
  }
  return `${source.target}:${remotePath}`;
}

async function listSshLegacy(source, recursive) {
  const listCommand = recursive
    ? 'find "$base" -type f -print0'
    : [
      'find "$base" -mindepth 1 -maxdepth 1 -print0 | while IFS= read -r -d \'\' f; do',
      'if [ -d "$f" ]; then printf "d\\0%s\\0" "$f"',
      'elif [ -f "$f" ]; then printf "f\\0%s\\0" "$f"',
      "fi",
      "done",
    ].join("\n");
  const command = [
    `base=${remoteShellPath(source.path)}`,
    'if [ -d "$base" ]; then',
    'printf "directory\\0%s\\0" "$base"',
    listCommand,
    'elif [ -f "$base" ]; then',
    'printf "file\\0%s\\0" "$base"',
    "else",
    'printf "missing\\0%s\\0" "$base"',
    "fi",
  ].join("\n");
  let output;
  try {
    output = await runCommand("ssh", sshArgs(source, command));
  } catch (error) {
    const detail = error.message || "";
    if (/Permission denied|Host key verification failed|Could not resolve|timed out/i.test(detail)) {
      throw new HttpError(
        502,
        `SSH 连接失败：${detail}。请先在终端中确认 ssh ${source.target} 可以免交互登录。`,
      );
    }
    throw error;
  }

  const parts = output.toString("utf8").split("\0").filter(Boolean);
  const targetType = parts.shift();
  const resolvedBase = parts.shift();
  if (targetType === "missing") {
    throw new HttpError(404, `SSH 路径不存在：${source.path}`);
  }
  if (!["file", "directory"].includes(targetType) || !resolvedBase) {
    throw new HttpError(502, "无法判断远程路径类型");
  }
  const remoteEntries = targetType === "file"
    ? [{ remotePath: resolvedBase, type: "file" }]
    : recursive
      ? parts.map((remotePath) => ({ remotePath, type: "file" }))
      : Array.from({ length: Math.floor(parts.length / 2) }, (_, index) => ({
        type: parts[index * 2] === "d" ? "directory" : "file",
        remotePath: parts[index * 2 + 1],
      }));

  const entries = remoteEntries
    .slice(0, 100000)
    .map(({ remotePath, type }) => {
      if (type === "directory") {
        return {
          id: encodeDescriptor({
            kind: "ssh",
            target: source.target,
            port: source.port,
            path: remotePath,
            directory: true,
          }),
          type: "directory",
          name: path.posix.basename(remotePath),
          relativePath: path.posix.relative(resolvedBase, remotePath),
          childSource: sshChildSource(source, remotePath),
          size: null,
          modified: null,
        };
      }
      const descriptor = {
        kind: "ssh",
        target: source.target,
        port: source.port,
        path: remotePath,
      };
      return {
        id: encodeDescriptor(descriptor),
        type: entryTypeForPath(remotePath),
        name: path.posix.basename(remotePath),
        relativePath: targetType === "file"
          ? path.posix.basename(remotePath)
          : path.posix.relative(resolvedBase, remotePath),
        size: null,
        modified: null,
      };
    })
    .sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.relativePath.localeCompare(b.relativePath, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  return { targetType, entries };
}

async function listSsh(source, recursive) {
  try {
    const result = await remoteAgents.json(source, "/list", {
      path: source.path,
      recursive: recursive ? "1" : "0",
    });
    const entries = result.entries.map((item) => {
      if (item.type === "directory") {
        return {
          id: encodeDescriptor({
            kind: "ssh",
            target: source.target,
            port: source.port,
            path: item.path,
            directory: true,
          }),
          type: "directory",
          name: item.name,
          relativePath: item.relativePath,
          childSource: sshChildSource(source, item.path),
          size: null,
          modified: item.modified,
        };
      }
      return {
        id: encodeDescriptor({
          kind: "ssh",
          target: source.target,
          port: source.port,
          path: item.path,
          size: item.size,
          modified: item.modified,
        }),
        type: item.type === "directory" ? "directory" : entryTypeForPath(item.path),
        name: item.name,
        relativePath: item.relativePath,
        size: item.size,
        modified: item.modified,
      };
    });
    return { targetType: result.targetType, entries };
  } catch (error) {
    console.error(`[RemoteAgent] ${source.target}: ${error.message}; falling back to SSH commands`);
    return listSshLegacy(source, recursive);
  }
}

const s3Clients = new Map();
const s3Configurations = new Map();

function awsCredentialsPath() {
  return path.resolve(
    process.env.AWS_SHARED_CREDENTIALS_FILE ||
    path.join(os.homedir(), ".aws", "credentials"),
  );
}

function readAwsProfiles() {
  const profiles = {};
  let current;
  let content = "";
  try {
    content = fs.readFileSync(awsCredentialsPath(), "utf8");
  } catch {
    return profiles;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = section[1].trim();
      profiles[current] ||= {};
      continue;
    }
    const separator = line.indexOf("=");
    if (current && separator > 0) {
      profiles[current][line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return profiles;
}

function getS3Client(config) {
  const savedConfig = config.connectionId
    ? s3Configurations.get(config.connectionId)
    : undefined;
  if (config.connectionId && !savedConfig) {
    throw new HttpError(400, "S3 配置已失效，请刷新插件");
  }
  const resolved = {
    ...savedConfig,
    ...config,
    endpoint: config.endpoint || savedConfig?.endpoint,
    region: config.region || savedConfig?.region,
    forcePathStyle: config.forcePathStyle ?? savedConfig?.forcePathStyle,
  };
  const profileName =
    resolved.profile ||
    process.env.AWS_PROFILE ||
    process.env.OSS_PROFILE ||
    "default";
  const profile = readAwsProfiles()[profileName] || {};
  resolved.endpoint =
    resolved.endpoint ||
    process.env.ALIYUN_OSS_ENDPOINT_URL ||
    process.env.OSS_ENDPOINT_URL ||
    process.env.AWS_ENDPOINT_URL ||
    profile["oss-endpoint-url"] ||
    profile.oss_endpoint_url ||
    profile["endpoint-url"] ||
    profile.endpoint_url;
  resolved.region =
    resolved.region ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.AWS_REGION ||
    profile.region ||
    "oss";
  if (resolved.forcePathStyle === undefined) {
    const style =
      process.env.OSS_ADDRESSING_STYLE ||
      profile["oss-addressing-style"] ||
      profile.oss_addressing_style ||
      "virtual";
    resolved.forcePathStyle = style === "path";
  }
  const clientKey = JSON.stringify({
    connectionId: config.connectionId,
    endpoint: resolved.endpoint,
    region: resolved.region,
    profile: profileName,
    forcePathStyle: resolved.forcePathStyle,
  });
  if (s3Clients.has(clientKey)) return s3Clients.get(clientKey);

  const options = {
    region: resolved.region || "us-east-1",
    forcePathStyle: Boolean(resolved.forcePathStyle),
  };
  if (resolved.endpoint) options.endpoint = resolved.endpoint;
  if (resolved.accessKeyId && resolved.secretAccessKey) {
    options.credentials = {
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      sessionToken: resolved.sessionToken || undefined,
    };
  } else {
    options.credentials = fromIni({ profile: profileName });
  }
  const client = new S3Client(options);
  s3Clients.set(clientKey, client);
  return client;
}

function s3ChildSource(source, prefix) {
  const url = new URL(source.source);
  url.pathname = `/${prefix}`;
  return url.toString();
}

function s3DescriptorConfig(source) {
  return source.connectionId
    ? { connectionId: source.connectionId }
    : {
      endpoint: source.endpoint,
      region: source.region,
      profile: source.profile,
      forcePathStyle: source.forcePathStyle,
    };
}

async function listS3(source, recursive) {
  const client = getS3Client(source);
  const entries = [];
  let continuationToken;

  try {
    if (source.requestedKey && !source.requestedAsDirectory) {
      try {
        const object = await client.send(new HeadObjectCommand({
          Bucket: source.bucket,
          Key: source.requestedKey,
        }));
        const descriptor = {
          kind: "s3",
          bucket: source.bucket,
          key: source.requestedKey,
          ...s3DescriptorConfig(source),
          size: object.ContentLength,
          modified: object.LastModified?.getTime(),
          etag: object.ETag,
        };
        return {
          targetType: "file",
          entries: [{
            id: encodeDescriptor(descriptor),
            type: entryTypeForPath(source.requestedKey),
            name: path.posix.basename(source.requestedKey),
            relativePath: path.posix.basename(source.requestedKey),
            size: object.ContentLength,
            modified: object.LastModified?.getTime(),
          }],
        };
      } catch (error) {
        const status = error.$metadata?.httpStatusCode;
        if (status !== 404 && error.name !== "NotFound" && error.name !== "NoSuchKey") {
          throw error;
        }
      }
    }
    do {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: source.bucket,
        Prefix: source.prefix,
        Delimiter: recursive ? undefined : "/",
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));
      for (const commonPrefix of result.CommonPrefixes || []) {
        if (!commonPrefix.Prefix) continue;
        const withoutSlash = commonPrefix.Prefix.replace(/\/$/, "");
        entries.push({
          id: encodeDescriptor({
            kind: "s3",
            bucket: source.bucket,
            key: commonPrefix.Prefix,
            ...s3DescriptorConfig(source),
            directory: true,
          }),
          type: "directory",
          name: path.posix.basename(withoutSlash),
          relativePath: commonPrefix.Prefix.slice(source.prefix.length),
          childSource: s3ChildSource(source, commonPrefix.Prefix),
          size: null,
          modified: null,
        });
      }
      for (const object of result.Contents || []) {
        if (!object.Key || object.Key === source.prefix) continue;
        const descriptor = {
          kind: "s3",
          bucket: source.bucket,
          key: object.Key,
          ...s3DescriptorConfig(source),
          size: object.Size,
          modified: object.LastModified?.getTime(),
          etag: object.ETag,
        };
        entries.push({
          id: encodeDescriptor(descriptor),
          type: entryTypeForPath(object.Key),
          name: path.posix.basename(object.Key),
          relativePath: object.Key.slice(source.prefix.length),
          size: object.Size,
          modified: object.LastModified?.getTime(),
        });
        if (entries.length >= 100000) break;
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken && entries.length < 100000);
  } catch (error) {
    const message = error.message || String(error);
    if (/credential|access key|signature|forbidden|access denied/i.test(message)) {
      throw new HttpError(
        502,
        `对象存储认证失败：${message}。请检查 ~/.aws/credentials 和路径中的 profile。`,
      );
    }
    throw new HttpError(502, `对象存储读取失败：${message}`);
  }

  const sortedEntries = entries.sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.relativePath.localeCompare(b.relativePath, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  return { targetType: "directory", entries: sortedEntries };
}

function progressMeter(total, onProgress) {
  let received = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      onProgress?.(received, total);
      callback(null, chunk);
    },
  });
}

async function downloadRemote(descriptor, destination, onProgress) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });

  try {
    const remoteResponse = await remoteAgents.fetch(descriptor, "/file", {
      path: descriptor.path,
    });
    if (!remoteResponse.ok) {
      const body = await remoteResponse.json().catch(() => ({}));
      throw new HttpError(
        remoteResponse.status,
        body.error || "远程原始文件读取失败",
      );
    }
    await pipeline(
      Readable.fromWeb(remoteResponse.body),
      progressMeter(
        Number(remoteResponse.headers.get("Content-Length")) || descriptor.size,
        onProgress,
      ),
      fs.createWriteStream(temporary, { flags: "wx" }),
    );
    const stat = await fsp.stat(temporary);
    if (Number.isFinite(descriptor.size) && stat.size !== descriptor.size) {
      throw new HttpError(502, "远程原始文件下载不完整");
    }
    await fsp.rename(temporary, destination);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

async function downloadS3(descriptor, destination, onProgress) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    const client = getS3Client(descriptor);
    const result = await client.send(new GetObjectCommand({
      Bucket: descriptor.bucket,
      Key: descriptor.key,
    }));
    if (!result.Body) throw new HttpError(502, "对象存储返回了空文件");
    await pipeline(
      result.Body,
      progressMeter(Number(result.ContentLength) || descriptor.size, onProgress),
      fs.createWriteStream(temporary, { flags: "wx" }),
    );
    const stat = await fsp.stat(temporary);
    if (Number.isFinite(descriptor.size) && stat.size !== descriptor.size) {
      throw new HttpError(502, "对象原始文件下载不完整");
    }
    await fsp.rename(temporary, destination);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `下载对象失败：${error.message}`);
  }
}

function descriptorSourcePath(descriptor) {
  if (descriptor.kind === "s3") return descriptor.key;
  if (descriptor.kind === "archive") return descriptor.member;
  return descriptor.path;
}

async function runCommandToFile(command, args, destination) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stderr = [];
  child.stderr.on("data", (chunk) => {
    if (stderr.reduce((total, item) => total + item.length, 0) < 1024 * 1024) {
      stderr.push(chunk);
    }
  });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(new HttpError(
          422,
          Buffer.concat(stderr).toString("utf8").trim() || "归档文件读取失败",
        ));
      }
    });
  });
  try {
    await Promise.all([
      pipeline(child.stdout, fs.createWriteStream(temporary, { flags: "wx" })),
      exited,
    ]);
    await fsp.rename(temporary, destination);
  } catch (error) {
    child.kill("SIGKILL");
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

async function materializeArchiveMember(descriptor) {
  if (descriptor.directory) throw new HttpError(400, "归档目录不能作为文件打开");
  const archivePath = await materialize(descriptor.archive);
  const format = archiveFormatFor(descriptorSourcePath(descriptor.archive));
  if (!format) throw new HttpError(415, "不支持的归档格式");
  const extension = path.posix.extname(descriptor.member).toLowerCase();
  const key = sha256(JSON.stringify(descriptor));
  const destination = path.join(REMOTE_DIR, `archive-${key}${extension}`);
  const existing = await fsp.stat(destination).catch(() => null);
  if (existing?.isFile()) return destination;
  await singleJob(`archive:${key}`, () => runCommandToFile(
    format === "zip" ? "unzip" : "tar",
    format === "zip"
      ? ["-p", archivePath, descriptor.member]
      : ["-xOf", archivePath, descriptor.member],
    destination,
  ));
  return destination;
}

async function materialize(descriptor, onProgress) {
  if (descriptor.kind === "archive") {
    return materializeArchiveMember(descriptor);
  }
  if (descriptor.kind === "local") {
    const stat = await fsp.stat(descriptor.path).catch(() => null);
    if (!stat?.isFile()) throw new HttpError(404, "图片文件不存在");
    return descriptor.path;
  }

  const sourcePath = descriptor.kind === "s3" ? descriptor.key : descriptor.path;
  const extension = path.posix.extname(sourcePath).toLowerCase();
  const key = sha256(JSON.stringify(descriptor));
  const destination = path.join(REMOTE_DIR, `${key}${extension}`);
  const existing = await fsp.stat(destination).catch(() => null);
  if (existing?.isFile() && existing.size > 0) {
    onProgress?.(existing.size, existing.size);
    return destination;
  }
  await singleJob(`remote:${key}`, () => (
    descriptor.kind === "s3"
      ? downloadS3(descriptor, destination, onProgress)
      : downloadRemote(descriptor, destination, onProgress)
  ));
  return destination;
}

function descriptorIsImage(descriptor) {
  const sourcePath = descriptorSourcePath(descriptor);
  return IMAGE_EXTENSIONS.has(path.posix.extname(sourcePath || "").toLowerCase());
}

function descriptorFileName(descriptor) {
  const sourcePath = descriptorSourcePath(descriptor);
  return path.posix.basename(sourcePath || "image").replaceAll('"', "");
}

function contentDisposition(fileName, type = "attachment") {
  const clean = String(fileName || "download").replaceAll(/[\r\n"]/g, "");
  const fallback = clean.replaceAll(/[^\x20-\x7e]/g, "_") || "download";
  const encoded = encodeURIComponent(clean).replaceAll("'", "%27");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function attachmentDisposition(fileName) {
  return contentDisposition(fileName, "attachment");
}

function inlineDisposition(fileName) {
  return contentDisposition(fileName, "inline");
}

async function ensureDescriptorVersion(descriptor) {
  if (descriptor.kind === "archive") return descriptor;
  if (descriptor.kind === "local") {
    if (
      Number.isFinite(descriptor.size) &&
      Number.isFinite(descriptor.modified)
    ) return descriptor;
    const stat = await fsp.stat(descriptor.path).catch(() => null);
    if (!stat?.isFile()) throw new HttpError(404, "图片文件不存在");
    return {
      ...descriptor,
      size: stat.size,
      modified: stat.mtimeMs,
    };
  }

  if (descriptor.kind === "ssh") {
    if (
      Number.isFinite(descriptor.size) &&
      Number.isFinite(descriptor.modified)
    ) return descriptor;
    const response = await remoteAgents.fetch(descriptor, "/stat", {
      path: descriptor.path,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new HttpError(response.status, result.error || "远程文件不存在");
    }
    if (result.directory) throw new HttpError(400, "目录不能作为图片打开");
    return {
      ...descriptor,
      path: result.path || descriptor.path,
      size: result.size,
      modified: result.modified,
    };
  }

  if (descriptor.kind === "s3") {
    if (
      Number.isFinite(descriptor.size) &&
      (descriptor.etag || Number.isFinite(descriptor.modified))
    ) return descriptor;
    try {
      const client = getS3Client(descriptor);
      const result = await client.send(new HeadObjectCommand({
        Bucket: descriptor.bucket,
        Key: descriptor.key,
      }));
      return {
        ...descriptor,
        size: result.ContentLength,
        modified: result.LastModified?.getTime(),
        etag: result.ETag,
      };
    } catch (error) {
      const status = error.$metadata?.httpStatusCode;
      if (status === 404 || error.name === "NotFound" || error.name === "NoSuchKey") {
        throw new HttpError(404, "对象不存在");
      }
      throw new HttpError(502, `对象存储读取失败：${error.message || error}`);
    }
  }

  return descriptor;
}

function normalizeArchiveMember(value, directory = false) {
  const raw = String(value || "").replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!raw || raw.includes("\0") || raw.startsWith("/")) return "";
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../")) return "";
  const clean = normalized.replace(/^\/+|\/+$/g, "");
  return clean && directory ? `${clean}/` : clean;
}

async function archiveMembers(descriptor) {
  const archivePath = await materialize(descriptor);
  const format = archiveFormatFor(descriptorSourcePath(descriptor));
  if (!format) throw new HttpError(415, "不支持的归档格式");
  const stat = await fsp.stat(archivePath);
  const cacheKey = `${archivePath}:${stat.size}:${stat.mtimeMs}`;
  const cached = archiveListings.get(cacheKey);
  if (cached) return { ...cached, archivePath, format };
  const output = await runCommand(
    format === "zip" ? "unzip" : "tar",
    format === "zip" ? ["-Z1", archivePath] : ["-tf", archivePath],
    { maxBytes: 64 * 1024 * 1024 },
  );
  const members = output.toString("utf8")
    .split(/\r?\n/)
    .map((item) => ({
      path: normalizeArchiveMember(item, item.endsWith("/")),
      directory: item.endsWith("/"),
    }))
    .filter((item) => item.path);
  const result = { members };
  archiveListings.clear();
  archiveListings.set(cacheKey, result);
  return { ...result, archivePath, format };
}

async function listArchive(descriptor, requestedPath = "") {
  const { members } = await archiveMembers(descriptor);
  const normalizedDirectory = requestedPath
    ? normalizeArchiveMember(requestedPath, true)
    : "";
  if (requestedPath && !normalizedDirectory) {
    throw new HttpError(400, "归档目录路径无效");
  }
  const entriesByName = new Map();
  for (const member of members) {
    if (!member.path.startsWith(normalizedDirectory)) continue;
    const remainder = member.path.slice(normalizedDirectory.length).replace(/\/$/, "");
    if (!remainder) continue;
    const segments = remainder.split("/");
    const name = segments[0];
    const memberPath = `${normalizedDirectory}${name}`;
    const isDirectory = segments.length > 1 || member.directory;
    const existing = entriesByName.get(name);
    if (existing?.type === "directory") continue;
    if (isDirectory) {
      const archivePath = `${memberPath}/`;
      entriesByName.set(name, {
        id: encodeDescriptor({
          kind: "archive",
          archive: descriptor,
          member: archivePath,
          directory: true,
        }),
        type: "directory",
        name,
        relativePath: name,
        archivePath,
        size: null,
        modified: null,
      });
      continue;
    }
    entriesByName.set(name, {
      id: encodeDescriptor({
        kind: "archive",
        archive: descriptor,
        member: memberPath,
      }),
      type: entryTypeForPath(memberPath),
      name,
      relativePath: name,
      size: null,
      modified: null,
    });
  }
  const entries = [...entriesByName.values()].sort((left, right) => {
    if (left.type === "directory" && right.type !== "directory") return -1;
    if (left.type !== "directory" && right.type === "directory") return 1;
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  return { targetType: "directory", entries };
}

function directoryDescriptorForSource(source) {
  if (source.kind === "local") {
    return { kind: "local", path: source.path, directory: true };
  }
  if (source.kind === "ssh") {
    return {
      kind: "ssh",
      target: source.target,
      port: source.port,
      path: source.path,
      directory: true,
    };
  }
  return {
    kind: "s3",
    bucket: source.bucket,
    key: source.prefix,
    ...s3DescriptorConfig(source),
    directory: true,
  };
}

function safeZipPath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

async function* localDirectoryFiles(descriptor) {
  const root = descriptor.path;
  const rootName = path.basename(root.replace(/[\\/]+$/, "")) || "files";
  const queue = [root];
  while (queue.length) {
    const directory = queue.shift();
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(fullPath);
        yield {
          name: `${rootName}/${safeZipPath(path.relative(root, fullPath))}`,
          stream: fs.createReadStream(fullPath),
          date: stat.mtime,
        };
      }
    }
  }
}

async function* sshDirectoryFiles(descriptor) {
  const result = await remoteAgents.json(descriptor, "/list", {
    path: descriptor.path,
    recursive: "1",
  });
  if (result.targetType !== "directory") throw new HttpError(400, "SSH 路径不是目录");
  const root = result.path || descriptor.path;
  const rootName = path.posix.basename(root.replace(/\/+$/, "")) || "files";
  for (const entry of result.entries) {
    if (entry.type === "directory") continue;
    const response = await remoteAgents.fetch(descriptor, "/file", {
      path: entry.path,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new HttpError(response.status, body.error || "SSH 文件读取失败");
    }
    yield {
      name: `${rootName}/${safeZipPath(path.posix.relative(root, entry.path))}`,
      stream: Readable.fromWeb(response.body),
      date: Number.isFinite(entry.modified) ? new Date(entry.modified) : undefined,
    };
  }
}

async function* s3DirectoryFiles(descriptor) {
  const client = getS3Client(descriptor);
  const prefix = descriptor.key || "";
  const rootName = path.posix.basename(prefix.replace(/\/+$/, "")) || descriptor.bucket;
  let continuationToken;
  do {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: descriptor.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));
    for (const object of listed.Contents || []) {
      if (!object.Key || object.Key.endsWith("/")) continue;
      const result = await client.send(new GetObjectCommand({
        Bucket: descriptor.bucket,
        Key: object.Key,
      }));
      if (!result.Body) throw new HttpError(502, `对象读取失败：${object.Key}`);
      yield {
        name: `${rootName}/${safeZipPath(object.Key.slice(prefix.length))}`,
        stream: result.Body,
        date: object.LastModified,
      };
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function* archiveDirectoryFiles(descriptor) {
  const prefix = normalizeArchiveMember(descriptor.member, true);
  const { members } = await archiveMembers(descriptor.archive);
  const rootName = path.posix.basename(prefix.replace(/\/$/, "")) || "files";
  for (const member of members) {
    if (member.directory || !member.path.startsWith(prefix)) continue;
    const memberDescriptor = {
      kind: "archive",
      archive: descriptor.archive,
      member: member.path,
    };
    const filePath = await materialize(memberDescriptor);
    yield {
      name: `${rootName}/${safeZipPath(member.path.slice(prefix.length))}`,
      stream: fs.createReadStream(filePath),
    };
  }
}

function addZipEntry(zip, item) {
  return new Promise((resolve, reject) => {
    zip.entry(item.stream, {
      name: item.name,
      ...(item.date ? { date: item.date } : {}),
    }, (error) => error ? reject(error) : resolve());
  });
}

async function streamDirectoryZip(response, descriptor) {
  const sourcePath = descriptorSourcePath(descriptor).replace(/\/+$/, "");
  const baseName = path.posix.basename(sourcePath) || descriptor.bucket || "files";
  const downloadName = `${baseName.replaceAll('"', "") || "files"}.zip`;
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": attachmentDisposition(downloadName),
    "Cache-Control": "no-store",
  });
  const zip = new ZipStream({ level: 6 });
  zip.pipe(response);
  const files = descriptor.kind === "local"
    ? localDirectoryFiles(descriptor)
    : descriptor.kind === "ssh"
      ? sshDirectoryFiles(descriptor)
      : descriptor.kind === "s3"
        ? s3DirectoryFiles(descriptor)
        : archiveDirectoryFiles(descriptor);
  try {
    for await (const item of files) {
      if (!item.name || item.name.endsWith("/")) continue;
      await addZipEntry(zip, item);
    }
    zip.finalize();
    await once(response, "finish");
  } catch (error) {
    zip.destroy(error);
    response.destroy(error);
  }
}

function directoryFileIterator(descriptor) {
  if (descriptor.kind === "local") return localDirectoryFiles(descriptor);
  if (descriptor.kind === "ssh") return sshDirectoryFiles(descriptor);
  if (descriptor.kind === "s3") return s3DirectoryFiles(descriptor);
  return archiveDirectoryFiles(descriptor);
}

async function selectedFileZipEntry(descriptor, name) {
  if (descriptor.kind === "local") {
    const stat = await fsp.stat(descriptor.path);
    return { name, stream: fs.createReadStream(descriptor.path), date: stat.mtime };
  }
  if (descriptor.kind === "ssh") {
    const response = await remoteAgents.fetch(descriptor, "/file", {
      path: descriptor.path,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new HttpError(response.status, result.error || "SSH 文件读取失败");
    }
    return {
      name,
      stream: Readable.fromWeb(response.body),
      date: Number.isFinite(descriptor.modified)
        ? new Date(descriptor.modified)
        : undefined,
    };
  }
  if (descriptor.kind === "s3") {
    const result = await getS3Client(descriptor).send(new GetObjectCommand({
      Bucket: descriptor.bucket,
      Key: descriptor.key,
    }));
    if (!result.Body) throw new HttpError(502, "S3/OSS 文件读取失败");
    return { name, stream: result.Body, date: result.LastModified };
  }
  const filePath = await materialize(descriptor);
  return { name, stream: fs.createReadStream(filePath) };
}

function uniqueSelectedName(descriptor, usedNames) {
  const sourcePath = descriptorSourcePath(descriptor).replace(/\/+$/, "");
  const fallback = descriptor.directory ? "folder" : "file";
  const rawName = safeZipPath(path.posix.basename(sourcePath)) || fallback;
  const extension = descriptor.directory ? "" : path.posix.extname(rawName);
  const stem = extension ? rawName.slice(0, -extension.length) : rawName;
  let name = rawName;
  let suffix = 2;
  while (usedNames.has(name.toLocaleLowerCase())) {
    name = `${stem} (${suffix})${extension}`;
    suffix += 1;
  }
  usedNames.add(name.toLocaleLowerCase());
  return name;
}

function selectedZipName(descriptors) {
  if (!descriptors.length) return "files.zip";
  const sourceKey = (descriptor) => {
    if (descriptor.kind === "local") return "local";
    if (descriptor.kind === "ssh") {
      return `ssh:${descriptor.target}:${descriptor.port || 22}`;
    }
    if (descriptor.kind === "s3") return `s3:${descriptor.bucket}`;
    return `archive:${encodeDescriptor(descriptor.archive)}`;
  };
  if (descriptors.some((item) => sourceKey(item) !== sourceKey(descriptors[0]))) {
    return "AnyFs-selected.zip";
  }
  const parentPath = (descriptor) => {
    const sourcePath = descriptorSourcePath(descriptor).replace(/\/+$/, "");
    return descriptor.kind === "local"
      ? path.dirname(sourcePath)
      : path.posix.dirname(sourcePath);
  };
  const parents = descriptors.map(parentPath);
  const splitPath = (value) => value.replaceAll("\\", "/").split("/").filter(Boolean);
  const common = splitPath(parents[0]);
  for (const parent of parents.slice(1)) {
    const parts = splitPath(parent);
    let length = 0;
    while (length < common.length && common[length] === parts[length]) length += 1;
    common.length = length;
  }
  const fallback = descriptors[0].kind === "s3"
    ? descriptors[0].bucket
    : "files";
  const baseName = (common.at(-1) || fallback).replaceAll('"', "") || "files";
  return `${baseName}.zip`;
}

async function streamSelectedZip(response, descriptors) {
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": attachmentDisposition(selectedZipName(descriptors)),
    "Cache-Control": "no-store",
  });
  const zip = new ZipStream({ level: 6 });
  zip.pipe(response);
  const usedNames = new Set();
  try {
    for (const descriptor of descriptors) {
      const selectedName = uniqueSelectedName(descriptor, usedNames);
      if (!descriptor.directory) {
        await addZipEntry(zip, await selectedFileZipEntry(descriptor, selectedName));
        continue;
      }
      for await (const item of directoryFileIterator(descriptor)) {
        const separator = item.name.indexOf("/");
        const relativeName = separator >= 0
          ? item.name.slice(separator + 1)
          : item.name;
        if (!relativeName) continue;
        await addZipEntry(zip, {
          ...item,
          name: `${selectedName}/${relativeName}`,
        });
      }
    }
    zip.finalize();
    await once(response, "finish");
  } catch (error) {
    zip.destroy(error);
    response.destroy(error);
  }
}

function createDownloadSelection(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000) {
    throw new HttpError(400, "请选择 1 到 1000 个文件或目录");
  }
  for (const [key, selection] of downloadSelections) {
    if (selection.expiresAt < Date.now()) downloadSelections.delete(key);
  }
  while (downloadSelections.size >= 100) {
    downloadSelections.delete(downloadSelections.keys().next().value);
  }
  const token = crypto.randomBytes(24).toString("base64url");
  downloadSelections.set(token, {
    descriptors: [...new Set(ids)].map(decodeDescriptor),
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return token;
}

function singleJob(key, task) {
  if (jobs.has(key)) return jobs.get(key);
  const promise = Promise.resolve()
    .then(task)
    .finally(() => jobs.delete(key));
  jobs.set(key, promise);
  return promise;
}

function queueBrowserImage(task) {
  const result = browserImageQueue.then(task, task);
  browserImageQueue = result.catch(() => {});
  return result;
}

function updateBrowserImageProgress(progressId, update) {
  if (!progressId) return;
  browserImageProgress.set(progressId, {
    ...(browserImageProgress.get(progressId) || {}),
    ...update,
    updatedAt: Date.now(),
  });
}

function finishBrowserImageProgress(progressId, update = {}) {
  if (!progressId) return;
  updateBrowserImageProgress(progressId, { ...update, done: true });
  setTimeout(() => browserImageProgress.delete(progressId), 60 * 1000).unref();
}

async function createThumbnail(descriptor, destination) {
  if (descriptor.kind === "ssh") {
    const response = await remoteAgents.fetch(descriptor, "/thumbnail", {
      path: descriptor.path,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new HttpError(response.status, body.error || "远端缩略图生成失败");
    }
    const temporary = `${destination}.${process.pid}.tmp.jpg`;
    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(temporary),
    );
    await fsp.rename(temporary, destination);
    return;
  }
  const input = await materialize(descriptor);
  const temporary = `${destination}.${process.pid}.tmp.jpg`;
  await sharp(input, { limitInputPixels: false, sequentialRead: true, pages: 1 })
    .rotate()
    .resize({
      width: 480,
      height: 360,
      fit: "inside",
      withoutEnlargement: true,
      fastShrinkOnLoad: true,
    })
    .jpeg({ quality: 76 })
    .toFile(temporary);
  await fsp.rename(temporary, destination);
}

async function getThumbnail(descriptor) {
  const key = sha256(JSON.stringify(descriptor));
  const destination = path.join(THUMBNAIL_DIR, `${key}.jpg`);
  if (await fsp.stat(destination).catch(() => null)) return destination;
  await singleJob(`thumbnail:${key}`, () => createThumbnail(descriptor, destination));
  return destination;
}

async function prepareBrowserImage(descriptor, requestedMaxDimension, progressId) {
  const maxDimension = Math.max(
    2048,
    Math.min(16384, Number(requestedMaxDimension) || 8192),
  );
  updateBrowserImageProgress(progressId, {
    phase: "metadata",
    label: "正在读取图片信息",
    received: 0,
    total: Number(descriptor.size) || 0,
    done: false,
  });
  if (descriptor.kind === "ssh") {
    updateBrowserImageProgress(progressId, {
      phase: "remote",
      label: "远程主机正在分析并准备图片",
    });
    const info = await remoteAgents.json(descriptor, "/image-info", {
      path: descriptor.path,
      maxDimension,
    });
    if (info.resized) {
      const key = sha256(`${JSON.stringify(descriptor)}:${maxDimension}:${info.cacheName}`);
      remoteBrowserImages.set(key, {
        descriptor,
        cacheName: info.cacheName,
        format: info.format,
      });
      finishBrowserImageProgress(progressId, {
        phase: "ready",
        label: "远程清晰图已准备完成",
      });
      return { ...info, key };
    }
    finishBrowserImageProgress(progressId, {
      phase: "ready",
      label: "图片信息读取完成",
    });
    return info;
  }
  const input = await materialize(descriptor, (received, total) => {
    updateBrowserImageProgress(progressId, {
      phase: "download",
      label: "正在读取原始图片",
      received,
      total: Number(total) || Number(descriptor.size) || 0,
    });
  });
  updateBrowserImageProgress(progressId, {
    phase: "metadata",
    label: "正在分析图片尺寸",
    received: 0,
    total: 0,
  });
  const metadata = await sharp(input, { limitInputPixels: false }).metadata();
  const originalWidth = metadata.autoOrient?.width || metadata.width;
  const originalHeight = metadata.autoOrient?.height || metadata.height;
  if (!originalWidth || !originalHeight) {
    throw new HttpError(422, "无法读取图片尺寸");
  }

  const scale = Math.min(1, maxDimension / originalWidth, maxDimension / originalHeight);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const resized = scale < 1;
  if (!resized) {
    finishBrowserImageProgress(progressId, {
      phase: "ready",
      label: "图片信息读取完成",
    });
    return { resized, originalWidth, originalHeight, width, height };
  }

  const format = metadata.hasAlpha ? "png" : "jpg";
  const key = sha256(`${JSON.stringify(descriptor)}:${maxDimension}:${format}`);
  const destination = path.join(BROWSER_IMAGE_DIR, `${key}.${format}`);
  if (!await fsp.stat(destination).catch(() => null)) {
    updateBrowserImageProgress(progressId, {
      phase: "queued",
      label: "正在等待大图缩放任务",
      received: 0,
      total: 0,
    });
    await singleJob(`browser-image:${key}`, async () => {
      await queueBrowserImage(async () => {
        if (await fsp.stat(destination).catch(() => null)) {
          updateBrowserImageProgress(progressId, {
            phase: "ready",
            label: "缩放图片已从缓存读取",
          });
          return;
        }
        const temporary = `${destination}.${process.pid}.tmp.${format}`;
        const inputStat = await fsp.stat(input);
        updateBrowserImageProgress(progressId, {
          phase: "resize-read",
          label: "正在读取大图用于缩放",
          received: 0,
          total: inputStat.size,
        });
        let imagePipeline = sharp({
          limitInputPixels: false,
          sequentialRead: true,
          pages: 1,
        })
          .rotate()
          .resize({
            width: maxDimension,
            height: maxDimension,
            fit: "inside",
            withoutEnlargement: true,
            fastShrinkOnLoad: true,
          });
        imagePipeline = format === "png"
          ? imagePipeline.png({ compressionLevel: 1, adaptiveFiltering: false })
          : imagePipeline.jpeg({ quality: 88 });
        const source = fs.createReadStream(input);
        let read = 0;
        source.on("data", (chunk) => {
          read += chunk.length;
          updateBrowserImageProgress(progressId, {
            phase: "resize-read",
            label: "正在读取大图用于缩放",
            received: read,
            total: inputStat.size,
          });
        });
        source.on("end", () => {
          updateBrowserImageProgress(progressId, {
            phase: "encode",
            label: "正在编码缩放图片",
            received: inputStat.size,
            total: inputStat.size,
          });
        });
        source.on("error", (error) => imagePipeline.destroy(error));
        const output = imagePipeline.toFile(temporary);
        source.pipe(imagePipeline);
        await output;
        await fsp.rename(temporary, destination);
      });
    });
  } else {
    updateBrowserImageProgress(progressId, {
      phase: "ready",
      label: "缩放图片已从缓存读取",
    });
  }
  finishBrowserImageProgress(progressId, {
    phase: "ready",
    label: "清晰浏览图准备完成",
  });
  return {
    resized,
    originalWidth,
    originalHeight,
    width,
    height,
    key,
    format,
  };
}

async function createDeepZoom(descriptor, key) {
  const input = await materialize(descriptor);
  const metadata = await sharp(input, { limitInputPixels: false }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new HttpError(422, "无法读取图片尺寸");
  }

  const descriptorPath = path.join(DEEP_ZOOM_DIR, `${key}.dzi`);
  const tilesPath = path.join(DEEP_ZOOM_DIR, `${key}_files`);
  await fsp.rm(descriptorPath, { force: true });
  await fsp.rm(tilesPath, { recursive: true, force: true });

  try {
    await sharp(input, {
      limitInputPixels: false,
      sequentialRead: true,
      pages: 1,
    })
      .rotate()
      .webp({ lossless: true, effort: 3 })
      .tile({
        size: TILE_SIZE,
        overlap: 0,
        depth: "onepixel",
        layout: "dz",
        container: "fs",
      })
      .toFile(path.join(DEEP_ZOOM_DIR, `${key}.dz`));
  } catch (error) {
    await fsp.rm(descriptorPath, { force: true });
    await fsp.rm(tilesPath, { recursive: true, force: true });
    throw error;
  }

  return {
    key,
    width: metadata.autoOrient?.width || metadata.width,
    height: metadata.autoOrient?.height || metadata.height,
    tileSize: TILE_SIZE,
    maxLevel: Math.ceil(Math.log2(Math.max(metadata.width, metadata.height))),
    format: "webp",
  };
}

async function prepareDeepZoom(descriptor) {
  const key = sha256(JSON.stringify(descriptor));
  const descriptorPath = path.join(DEEP_ZOOM_DIR, `${key}.dzi`);
  const infoPath = path.join(DEEP_ZOOM_DIR, `${key}.json`);
  const existing = await fsp.readFile(infoPath, "utf8").catch(() => null);
  if (existing && await fsp.stat(descriptorPath).catch(() => null)) {
    return JSON.parse(existing);
  }

  return singleJob(`deepzoom:${key}`, async () => {
    const secondCheck = await fsp.readFile(infoPath, "utf8").catch(() => null);
    if (secondCheck && await fsp.stat(descriptorPath).catch(() => null)) {
      return JSON.parse(secondCheck);
    }
    const info = await createDeepZoom(descriptor, key);
    await fsp.writeFile(infoPath, JSON.stringify(info));
    return info;
  });
}

function isExtensionOrigin(origin) {
  return typeof origin === "string" && origin.startsWith("chrome-extension://");
}

function isAppOrigin(origin) {
  if (isExtensionOrigin(origin)) return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "files.localhost"].includes(url.hostname) &&
      url.port === String(PORT)
    );
  } catch {
    return false;
  }
}

function isTrustedAppRequest(request) {
  if (isAppOrigin(request.headers.origin)) return true;
  if (request.headers["sec-fetch-site"] === "same-origin") return true;
  try {
    return isAppOrigin(new URL(request.headers.referer).origin);
  } catch {
    return false;
  }
}

function setCors(request, response) {
  const origin = request.headers.origin;
  response.setHeader("Access-Control-Allow-Origin", isAppOrigin(origin) ? origin : "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, body) {
  const content = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": content.length,
  });
  response.end(content);
}

async function readJsonBody(request, maximum = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) throw new HttpError(413, "请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "JSON 配置格式不正确");
  }
}

async function readRequestBuffer(request, maximum = 64 * 1024 * 1024) {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw new HttpError(413, "文本文件超过 64 MB，不能在页面内保存");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) {
      throw new HttpError(413, "文本文件超过 64 MB，不能在页面内保存");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function sendFile(
  response,
  filePath,
  contentType,
  cache = true,
  extraHeaders = {},
  rangeHeader = "",
) {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, "文件不存在");
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (match && stat.size > 0) {
    if (!match[1] && match[2]) {
      start = Math.max(0, stat.size - Number(match[2]));
    } else {
      start = Number(match[1] || 0);
      end = match[2] ? Math.min(end, Number(match[2])) : end;
    }
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
      status = 206;
    } else {
      throw new HttpError(416, "请求的文件范围无效");
    }
  }
  const length = Math.max(0, end - start + 1);
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": length,
    "Accept-Ranges": "bytes",
    ...(status === 206
      ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` }
      : {}),
    "Cache-Control": cache ? "public, max-age=31536000, immutable" : "no-store",
    ...extraHeaders,
  });
  await pipeline(fs.createReadStream(filePath, { start, end }), response);
}

async function proxyRemoteFile(request, response, descriptor, options = {}) {
  const headers = {};
  if (request.headers.range) headers.Range = request.headers.range;
  const remoteResponse = await remoteAgents.fetch(
    descriptor,
    options.cached ? "/cached" : "/file",
    options.cached
      ? { name: options.cached }
      : { path: descriptor.path, download: options.download ? "1" : "0" },
    { headers },
  );
  if (!remoteResponse.ok && remoteResponse.status !== 206) {
    const body = await remoteResponse.json().catch(() => ({}));
    throw new HttpError(remoteResponse.status, body.error || "远端文件读取失败");
  }
  const forwardedHeaders = {};
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "content-disposition",
  ]) {
    const value = remoteResponse.headers.get(name);
    if (value) forwardedHeaders[name] = value;
  }
  if (!options.cached) {
    forwardedHeaders["content-disposition"] = options.download
      ? attachmentDisposition(descriptorFileName(descriptor))
      : inlineDisposition(descriptorFileName(descriptor));
  }
  response.writeHead(remoteResponse.status, forwardedHeaders);
  await pipeline(Readable.fromWeb(remoteResponse.body), response);
}

async function proxyS3File(request, response, descriptor, download = false) {
  let result;
  try {
    result = await getS3Client(descriptor).send(new GetObjectCommand({
      Bucket: descriptor.bucket,
      Key: descriptor.key,
      ...(request.headers.range ? { Range: request.headers.range } : {}),
    }));
  } catch (error) {
    throw new HttpError(502, `对象读取失败：${error.message || error}`);
  }
  if (!result.Body) throw new HttpError(502, "对象存储返回了空文件");
  const status = result.ContentRange ? 206 : 200;
  const headers = {
    "Content-Type": result.ContentType || contentTypeFor(descriptor.key),
    "Accept-Ranges": result.AcceptRanges || "bytes",
    "Cache-Control": "no-store",
  };
  if (result.ContentLength !== undefined) {
    headers["Content-Length"] = result.ContentLength;
  }
  if (result.ContentRange) headers["Content-Range"] = result.ContentRange;
  headers["Content-Disposition"] = download
    ? attachmentDisposition(path.posix.basename(descriptor.key))
    : inlineDisposition(path.posix.basename(descriptor.key));
  response.writeHead(status, headers);
  await pipeline(result.Body, response);
}

function validateUploadRelativePath(value) {
  const raw = String(value || "").normalize("NFC");
  if (!raw || raw.includes("\\") || raw.includes("\0") || raw.startsWith("/")) {
    throw new HttpError(400, "上传文件路径无效");
  }
  const segments = raw.split("/");
  if (
    segments.some((segment) => (
      !segment ||
      segment === "." ||
      segment === ".." ||
      Buffer.byteLength(segment) > 255
    )) ||
    Buffer.byteLength(raw) > 4096
  ) {
    throw new HttpError(400, "上传文件路径无效");
  }
  return segments.join("/");
}

async function uploadSshFile(request, source, fileName) {
  if (source.kind !== "ssh") {
    throw new HttpError(400, "当前目录不是 SSH 目录");
  }
  const contentLength = Number(request.headers["content-length"]);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new HttpError(411, "上传请求缺少有效的文件大小");
  }
  if (contentLength > 50 * 1024 * 1024 * 1024) {
    throw new HttpError(413, "单个上传文件不能超过 50 GB");
  }
  const relativePath = validateUploadRelativePath(fileName);
  const remotePath = path.posix.join(source.path, relativePath);
  const remoteResponse = await remoteAgents.fetch(
    source,
    "/upload",
    { path: remotePath },
    {
      method: "PUT",
      headers: {
        "Content-Type": request.headers["content-type"] || "application/octet-stream",
        "Content-Length": String(contentLength),
      },
      body: request,
      duplex: "half",
    },
    false,
  );
  const result = await remoteResponse.json().catch(() => ({}));
  if (!remoteResponse.ok) {
    throw new HttpError(
      remoteResponse.status,
      result.error || `SSH 上传失败 (${remoteResponse.status})`,
    );
  }
  return result;
}

async function renameSshEntry(source, newName) {
  if (source.kind !== "ssh") {
    throw new HttpError(400, "只有 SSH 文件或目录支持重命名");
  }
  const name = validateUploadRelativePath(newName);
  if (name.includes("/")) throw new HttpError(400, "新名称不能包含路径分隔符");
  const remoteResponse = await remoteAgents.fetch(
    source,
    "/rename",
    { path: source.path, name },
    { method: "POST" },
  );
  const result = await remoteResponse.json().catch(() => ({}));
  if (!remoteResponse.ok) {
    throw new HttpError(
      remoteResponse.status,
      result.error || `SSH 重命名失败 (${remoteResponse.status})`,
    );
  }
  return result;
}

async function saveTextFile(descriptor, content, contentType) {
  if (descriptor.directory || descriptor.kind === "archive") {
    throw new HttpError(400, "该文件是只读的，不能保存");
  }
  if (descriptor.kind === "local") {
    const stat = await fsp.stat(descriptor.path).catch(() => null);
    if (!stat?.isFile()) throw new HttpError(404, "文本文件不存在");
    try {
      await fsp.access(descriptor.path, fs.constants.W_OK);
    } catch {
      throw new HttpError(403, "该文本文件为只读，不能保存");
    }
    const temporary =
      `${descriptor.path}.anyfs-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`;
    let handle;
    try {
      handle = await fsp.open(temporary, "wx", stat.mode & 0o777);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();
      handle = null;
      await fsp.rename(temporary, descriptor.path);
    } finally {
      await handle?.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
    const updated = await fsp.stat(descriptor.path);
    return {
      id: encodeDescriptor({
        ...descriptor,
        size: updated.size,
        modified: updated.mtimeMs,
      }),
      size: updated.size,
      modified: updated.mtimeMs,
    };
  }
  if (descriptor.kind === "ssh") {
    const remoteResponse = await remoteAgents.fetch(
      descriptor,
      "/save",
      { path: descriptor.path },
      {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(content.length),
        },
        body: content,
      },
    );
    const result = await remoteResponse.json().catch(() => ({}));
    if (!remoteResponse.ok) {
      throw new HttpError(
        remoteResponse.status,
        result.error || `SSH 文件保存失败 (${remoteResponse.status})`,
      );
    }
    return {
      id: encodeDescriptor({
        ...descriptor,
        size: result.size,
        modified: result.modified,
      }),
      size: result.size,
      modified: result.modified,
    };
  }
  if (descriptor.kind === "s3") {
    throw new HttpError(403, "S3/OSS 使用只读模式，不能修改文件");
  }
  throw new HttpError(400, "当前来源不支持保存");
}

async function fileCapabilities(descriptor) {
  if (descriptor.directory || descriptor.kind === "archive") {
    return { writable: false };
  }
  if (descriptor.kind === "local") {
    try {
      const stat = await fsp.stat(descriptor.path);
      if (!stat.isFile()) return { writable: false };
      await fsp.access(descriptor.path, fs.constants.W_OK);
      return { writable: true };
    } catch {
      return { writable: false };
    }
  }
  if (descriptor.kind === "ssh") {
    try {
      const result = await remoteAgents.json(descriptor, "/stat", {
        path: descriptor.path,
      });
      return { writable: result.writable === true && !result.directory };
    } catch {
      return { writable: false };
    }
  }
  if (descriptor.kind === "s3") {
    return { writable: false, readOnly: true };
  }
  return { writable: false };
}

async function deleteDescriptor(descriptor) {
  if (descriptor.kind === "archive") {
    throw new HttpError(400, "归档包内部文件为只读，不能删除");
  }
  if (descriptor.kind === "local") {
    const target = path.resolve(descriptor.path);
    if (target === path.parse(target).root || target === path.resolve(os.homedir())) {
      throw new HttpError(403, "不允许删除受保护的根目录");
    }
    const stat = await fsp.lstat(target).catch(() => null);
    if (!stat) return;
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      if (!descriptor.directory) throw new HttpError(400, "目录标识无效");
      await fsp.rm(target, { recursive: true });
    } else {
      await fsp.unlink(target);
    }
    return;
  }
  if (descriptor.kind === "ssh") {
    const response = await remoteAgents.fetch(
      descriptor,
      "/delete",
      {
        path: descriptor.path,
        directory: descriptor.directory ? "1" : "0",
      },
      { method: "POST" },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new HttpError(
        response.status,
        result.error || `SSH 删除失败 (${response.status})`,
      );
    }
    return;
  }
  if (descriptor.kind === "s3") {
    throw new HttpError(403, "S3/OSS 使用只读模式，不能删除文件或目录");
  }
  throw new HttpError(400, "当前来源不支持删除");
}

async function deleteEntries(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) {
    throw new HttpError(400, "请选择 1 到 100 个文件或目录");
  }
  const uniqueIds = [...new Set(ids)];
  const deleted = [];
  const failed = [];
  for (const id of uniqueIds) {
    try {
      const descriptor = decodeDescriptor(id);
      await deleteDescriptor(descriptor);
      deleted.push(id);
    } catch (error) {
      failed.push({ id, error: error.message || String(error) });
    }
  }
  return { deleted, failed };
}

function contentTypeFor(filePath) {
  const types = {
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".ts": "text/plain; charset=utf-8",
    ".py": "text/plain; charset=utf-8",
    ".java": "text/plain; charset=utf-8",
    ".c": "text/plain; charset=utf-8",
    ".cpp": "text/plain; charset=utf-8",
    ".go": "text/plain; charset=utf-8",
    ".rs": "text/plain; charset=utf-8",
    ".sh": "text/plain; charset=utf-8",
    ".yaml": "text/plain; charset=utf-8",
    ".yml": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".pdf": "application/pdf",
    ".html": "text/html; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".tgz": "application/gzip",
    ".bz2": "application/x-bzip2",
    ".xz": "application/x-xz",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".ogv": "video/ogg",
    ".ogg": "video/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
  };
  return types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function htmlRenderDescriptor(documentDescriptor, requestedPath) {
  let decodedPath;
  try {
    decodedPath = requestedPath
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    throw new HttpError(400, "HTML 资源路径无效");
  }
  if (
    !decodedPath ||
    decodedPath.includes("\0") ||
    path.posix.isAbsolute(decodedPath)
  ) {
    throw new HttpError(400, "HTML 资源路径无效");
  }

  const normalized = path.posix.normalize(decodedPath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new HttpError(403, "HTML 资源不能访问页面目录之外的文件");
  }

  const descriptor = { ...documentDescriptor };
  delete descriptor.size;
  delete descriptor.modified;
  delete descriptor.etag;
  delete descriptor.directory;

  if (descriptor.kind === "local") {
    const root = path.dirname(descriptor.path);
    const target = path.resolve(root, ...normalized.split("/"));
    const relative = path.relative(root, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new HttpError(403, "HTML 资源不能访问页面目录之外的文件");
    }
    descriptor.path = target;
    return descriptor;
  }

  if (descriptor.kind === "archive") {
    const root = path.posix.dirname(descriptor.member);
    descriptor.member = root === "." ? normalized : path.posix.join(root, normalized);
    return descriptor;
  }

  const sourcePath = descriptor.kind === "s3" ? descriptor.key : descriptor.path;
  const root = path.posix.dirname(sourcePath);
  const target = root === "." ? normalized : path.posix.join(root, normalized);
  if (descriptor.kind === "s3") descriptor.key = target;
  else descriptor.path = target;
  return descriptor;
}

async function handleRequest(request, response) {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (!url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") throw new HttpError(405, "只支持 GET 请求");
    const isAppRoute = /^\/(s3|ssh|local)(\/|$)/.test(url.pathname);
    const requested = url.pathname === "/" || isAppRoute
      ? "app.html"
      : decodeURIComponent(url.pathname.slice(1));
    const staticPath = path.resolve(STATIC_ROOT, requested);
    if (!staticPath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
      throw new HttpError(403, "不允许访问该路径");
    }
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    await sendFile(
      response,
      staticPath,
      contentTypes[path.extname(staticPath)] || "application/octet-stream",
      false,
    );
    return;
  }

  if (url.pathname === "/api/session") {
    if (request.method !== "GET") throw new HttpError(405, "只支持 GET 请求");
    if (!isTrustedAppRequest(request) && process.env.IMAGE_VIEWER_DEV !== "1") {
      throw new HttpError(403, "只允许 AnyFs Browser 连接");
    }
    sendJson(response, 200, { token: SESSION_TOKEN, version: "0.1.0" });
    return;
  }

  const htmlRenderMatch = url.pathname.match(/^\/api\/html-render\/([^/]+)\/(.+)$/);
  if (htmlRenderMatch) {
    if (request.method !== "GET") throw new HttpError(405, "只支持 GET 请求");
    const [, token, requestedPath] = htmlRenderMatch;
    const renderSession = htmlRenderSessions.get(token);
    if (!renderSession || renderSession.expiresAt < Date.now()) {
      htmlRenderSessions.delete(token);
      throw new HttpError(401, "HTML 预览会话已失效");
    }
    renderSession.expiresAt = Date.now() + 60 * 60 * 1000;
    const descriptor = htmlRenderDescriptor(renderSession.descriptor, requestedPath);
    const filePath = await materialize(descriptor);
    const contentType = contentTypeFor(
      descriptor.kind === "s3" ? descriptor.key : descriptor.path,
    );
    const scopedSource = `http://${HOST}:${PORT}/api/html-render/${token}/`;
    const headers = {
      "X-Content-Type-Options": "nosniff",
      ...(contentType.startsWith("text/html")
        ? {
          "Content-Security-Policy":
            `default-src 'none'; script-src ${scopedSource} 'unsafe-inline'; ` +
            `style-src ${scopedSource} 'unsafe-inline' data:; ` +
            `img-src ${scopedSource} data: blob:; font-src ${scopedSource} data:; ` +
            `media-src ${scopedSource} data: blob:; connect-src ${scopedSource}; ` +
            `worker-src ${scopedSource} blob:; frame-src ${scopedSource} data: blob:; ` +
            "object-src 'none'; base-uri 'none'; form-action 'none'",
        }
        : {}),
    };
    await sendFile(
      response,
      filePath,
      contentType,
      false,
      headers,
      request.headers.range,
    );
    return;
  }

  if (url.searchParams.get("token") !== SESSION_TOKEN) {
    throw new HttpError(401, "会话已失效，请刷新插件页面");
  }

  if (url.pathname === "/api/ssh/upload") {
    if (request.method !== "PUT") throw new HttpError(405, "上传只支持 PUT 请求");
    const source = parseSource(url.searchParams.get("source") || "");
    const result = await uploadSshFile(
      request,
      source,
      url.searchParams.get("name") || "",
    );
    sendJson(response, 201, result);
    return;
  }

  if (url.pathname === "/api/ssh/rename") {
    if (request.method !== "POST") throw new HttpError(405, "重命名只支持 POST 请求");
    const body = await readJsonBody(request);
    const source = parseSource(body.source || "");
    const result = await renameSshEntry(source, body.newName || "");
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/file/save") {
    if (request.method !== "PUT") throw new HttpError(405, "保存只支持 PUT 请求");
    const descriptor = decodeDescriptor(url.searchParams.get("id"));
    const content = await readRequestBuffer(request);
    const result = await saveTextFile(
      descriptor,
      content,
      request.headers["content-type"] || "text/plain; charset=utf-8",
    );
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  if (url.pathname === "/api/entries/delete") {
    if (request.method !== "POST") throw new HttpError(405, "删除只支持 POST 请求");
    const body = await readJsonBody(request);
    sendJson(response, 200, await deleteEntries(body.ids));
    return;
  }

  if (url.pathname === "/api/download-selection" && request.method === "POST") {
    const body = await readJsonBody(request, 1024 * 1024);
    sendJson(response, 200, { id: createDownloadSelection(body.ids) });
    return;
  }

  if (url.pathname === "/api/download-selection" && request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    const selection = downloadSelections.get(id);
    downloadSelections.delete(id);
    if (!selection || selection.expiresAt < Date.now()) {
      throw new HttpError(404, "下载选择已失效，请重新选择");
    }
    await streamSelectedZip(response, selection.descriptors);
    return;
  }

  if (url.pathname === "/api/download-directory" && request.method === "GET") {
    let descriptor;
    const archiveId = url.searchParams.get("archiveId");
    if (archiveId) {
      descriptor = {
        kind: "archive",
        archive: decodeDescriptor(archiveId),
        member: normalizeArchiveMember(url.searchParams.get("path") || "", true),
        directory: true,
      };
      if (!descriptor.member) throw new HttpError(400, "归档目录路径无效");
    } else {
      descriptor = directoryDescriptorForSource(
        parseSource(url.searchParams.get("source") || ""),
      );
    }
    await streamDirectoryZip(response, descriptor);
    return;
  }

  if (url.pathname === "/api/archive/list" && request.method === "GET") {
    const descriptor = decodeDescriptor(url.searchParams.get("id"));
    if (!archiveFormatFor(descriptorSourcePath(descriptor))) {
      throw new HttpError(415, "不支持的归档格式");
    }
    const result = await listArchive(
      descriptor,
      url.searchParams.get("path") || "",
    );
    sendJson(response, 200, {
      images: result.entries,
      targetType: result.targetType,
    });
    return;
  }

  if (url.pathname === "/api/html-render-session" && request.method === "GET") {
    const descriptor = decodeDescriptor(url.searchParams.get("id"));
    const sourcePath = descriptor.kind === "s3" ? descriptor.key : descriptor.path;
    if (![".html", ".htm"].includes(path.posix.extname(sourcePath).toLowerCase())) {
      throw new HttpError(400, "只有 HTML 文件可以使用页面预览");
    }
    for (const [key, session] of htmlRenderSessions) {
      if (session.expiresAt < Date.now()) htmlRenderSessions.delete(key);
    }
    while (htmlRenderSessions.size >= 100) {
      htmlRenderSessions.delete(htmlRenderSessions.keys().next().value);
    }
    const renderToken = crypto.randomBytes(24).toString("base64url");
    htmlRenderSessions.set(renderToken, {
      descriptor,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const fileName = path.posix.basename(sourcePath) || "index.html";
    sendJson(response, 200, {
      url: `/api/html-render/${renderToken}/${encodeURIComponent(fileName)}`,
    });
    return;
  }

  if (url.pathname === "/api/system" && request.method === "GET") {
    sendJson(response, 200, { homeDirectory: os.homedir() });
    return;
  }

  if (url.pathname === "/api/s3/credentials" && request.method === "GET") {
    const credentialsFile = awsCredentialsPath();
    const content = await fsp.readFile(credentialsFile, "utf8").catch(() => (
      "# AWS / S3 / OSS credentials\n" +
      "[default]\n" +
      "aws_access_key_id =\n" +
      "aws_secret_access_key =\n" +
      "oss-endpoint-url =\n"
    ));
    sendJson(response, 200, {
      path: credentialsFile,
      content,
      profiles: Object.keys(readAwsProfiles()),
    });
    return;
  }

  if (url.pathname === "/api/s3/credentials" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (typeof body.content !== "string" || body.content.includes("\0")) {
      throw new HttpError(400, "凭证文件内容无效");
    }
    const credentialsFile = awsCredentialsPath();
    const temporary = `${credentialsFile}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
    await fsp.writeFile(temporary, body.content, { mode: 0o600 });
    await fsp.rename(temporary, credentialsFile);
    await fsp.chmod(credentialsFile, 0o600);
    s3Clients.clear();
    sendJson(response, 200, {
      ok: true,
      path: credentialsFile,
      profiles: Object.keys(readAwsProfiles()),
    });
    return;
  }

  if (url.pathname === "/api/s3/config" && request.method === "POST") {
    const config = await readJsonBody(request);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(config.id || "")) {
      throw new HttpError(400, "S3 配置 ID 无效");
    }
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new HttpError(400, "S3 配置需要 AK 和 SK");
    }
    if (config.endpoint) {
      try {
        const endpoint = new URL(config.endpoint);
        if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error();
      } catch {
        throw new HttpError(400, "Endpoint URL 必须是 http:// 或 https:// 地址");
      }
    }
    s3Configurations.set(config.id, {
      endpoint: config.endpoint || undefined,
      region: config.region || "us-east-1",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken || undefined,
      forcePathStyle: config.forcePathStyle !== false,
    });
    for (const key of s3Clients.keys()) {
      if (key.includes(config.id)) s3Clients.delete(key);
    }
    sendJson(response, 200, { ok: true, id: config.id });
    return;
  }

  if (request.method !== "GET") throw new HttpError(405, "请求方法不支持");

  if (url.pathname === "/api/file-capabilities") {
    const descriptor = decodeDescriptor(url.searchParams.get("id"));
    sendJson(response, 200, await fileCapabilities(descriptor));
    return;
  }

  if (url.pathname === "/api/s3/buckets") {
    const profile = url.searchParams.get("profile") || undefined;
    const connectionId = url.searchParams.get("connection") || undefined;
    if (connectionId && !/^[A-Za-z0-9_-]{8,128}$/.test(connectionId)) {
      throw new HttpError(400, "S3 配置 ID 无效");
    }
    try {
      const client = getS3Client({ profile, connectionId });
      const result = await client.send(new ListBucketsCommand({}));
      const buckets = (result.Buckets || [])
        .filter((bucket) => bucket.Name)
        .map((bucket) => ({
          name: bucket.Name,
          createdAt: bucket.CreationDate?.getTime() || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }));
      sendJson(response, 200, { buckets });
    } catch (error) {
      throw new HttpError(502, `无法读取 Bucket：${error.message || error}`);
    }
    return;
  }

  if (url.pathname === "/api/list") {
    const source = parseSource(url.searchParams.get("source") || "");
    const result = source.kind === "local"
      ? await listLocal(source, false)
      : source.kind === "ssh"
        ? await listSsh(source, false)
        : await listS3(source, false);
    sendJson(response, 200, {
      images: result.entries,
      targetType: result.targetType,
      source: source.source,
      kind: source.kind,
    });
    return;
  }

  if (url.pathname === "/api/thumbnail") {
    const descriptor = await ensureDescriptorVersion(
      decodeDescriptor(url.searchParams.get("id")),
    );
    const thumbnail = await getThumbnail(descriptor);
    await sendFile(response, thumbnail, "image/jpeg");
    return;
  }

  if (url.pathname === "/api/browser-image-progress") {
    const progressId = url.searchParams.get("progressId") || "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(progressId)) {
      throw new HttpError(400, "图片进度 ID 无效");
    }
    sendJson(response, 200, browserImageProgress.get(progressId) || {
      phase: "starting",
      label: "正在启动图片处理",
      received: 0,
      total: 0,
      done: false,
    });
    return;
  }

  if (url.pathname === "/api/browser-image-info") {
    const progressId = url.searchParams.get("progressId") || "";
    if (progressId && !/^[A-Za-z0-9_-]{8,128}$/.test(progressId)) {
      throw new HttpError(400, "图片进度 ID 无效");
    }
    const descriptor = await ensureDescriptorVersion(
      decodeDescriptor(url.searchParams.get("id")),
    );
    try {
      const info = await prepareBrowserImage(
        descriptor,
        url.searchParams.get("maxDimension"),
        progressId,
      );
      sendJson(response, 200, info);
    } catch (error) {
      finishBrowserImageProgress(progressId, {
        phase: "error",
        label: error.message || "图片处理失败",
        error: true,
      });
      throw error;
    }
    return;
  }

  const browserImageMatch = url.pathname.match(
    /^\/api\/browser-image\/([a-f0-9]{64})\.(jpg|png)$/,
  );
  if (browserImageMatch) {
    const [, key, format] = browserImageMatch;
    const remoteImage = remoteBrowserImages.get(key);
    if (remoteImage) {
      await proxyRemoteFile(
        request,
        response,
        remoteImage.descriptor,
        { cached: remoteImage.cacheName },
      );
      return;
    }
    await sendFile(
      response,
      path.join(BROWSER_IMAGE_DIR, `${key}.${format}`),
      format === "png" ? "image/png" : "image/jpeg",
    );
    return;
  }

  if (url.pathname === "/api/prepare") {
    const descriptor = decodeDescriptor(url.searchParams.get("id"));
    const info = await prepareDeepZoom(descriptor);
    sendJson(response, 200, info);
    return;
  }

  if (url.pathname === "/api/file") {
    let descriptor = decodeDescriptor(url.searchParams.get("id"));
    if (descriptor.directory) throw new HttpError(400, "目录不能作为文件打开");
    const download = url.searchParams.get("download") === "1";
    if (descriptorIsImage(descriptor)) {
      descriptor = await ensureDescriptorVersion(descriptor);
      const filePath = await materialize(descriptor);
      await sendFile(
        response,
        filePath,
        contentTypeFor(filePath),
        true,
        download
          ? {
            "Content-Disposition": attachmentDisposition(
              descriptorFileName(descriptor),
            ),
          }
          : {
            "Content-Disposition": inlineDisposition(
              descriptorFileName(descriptor),
            ),
            "X-File-Cache": descriptor.kind === "local" ? "LOCAL" : "HIT",
          },
        request.headers.range,
      );
      return;
    }
    if (descriptor.kind === "ssh") {
      await proxyRemoteFile(request, response, descriptor, { download });
      return;
    }
    if (descriptor.kind === "s3") {
      await proxyS3File(request, response, descriptor, download);
      return;
    }
    const filePath = await materialize(descriptor);
    await sendFile(
      response,
      filePath,
      contentTypeFor(filePath),
      false,
      download
        ? {
          "Content-Disposition": attachmentDisposition(
            descriptorFileName(descriptor),
          ),
        }
        : {
          "Content-Disposition": inlineDisposition(
            descriptorFileName(descriptor),
          ),
        },
      request.headers.range,
    );
    return;
  }

  const tileMatch = url.pathname.match(
    /^\/api\/tile\/([a-f0-9]{64})\/(\d+)\/(\d+)_(\d+)\.(webp)$/,
  );
  if (tileMatch) {
    const [, key, level, column, row, format] = tileMatch;
    const tile = path.join(
      DEEP_ZOOM_DIR,
      `${key}_files`,
      level,
      `${column}_${row}.${format}`,
    );
    await sendFile(response, tile, "image/webp");
    return;
  }

  throw new HttpError(404, "接口不存在");
}

async function main() {
  await Promise.all([
    fsp.mkdir(THUMBNAIL_DIR, { recursive: true }),
    fsp.mkdir(BROWSER_IMAGE_DIR, { recursive: true }),
    fsp.mkdir(DEEP_ZOOM_DIR, { recursive: true }),
    fsp.mkdir(REMOTE_DIR, { recursive: true }),
  ]);

  sharp.cache({ memory: 256, files: 100, items: 100 });
  sharp.concurrency(Math.max(1, Math.min(4, os.cpus().length - 1)));

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const status = error.status || 500;
      console.error(`[${new Date().toISOString()}]`, error);
      sendJson(response, status, {
        error: status === 500 ? `处理失败：${error.message}` : error.message,
      });
    });
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await remoteAgents.close().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  server.listen(PORT, HOST, () => {
    PORT = server.address().port;
    if (NATIVE_MODE) {
      setupNativeChannel(server);
      sendNativeMessage({ type: "ready", port: PORT, token: SESSION_TOKEN });
      process.stderr.write(`AnyFs Browser native host listening on ${PORT}\n`);
    } else {
      console.log(`AnyFs Browser 开发服务已启动：http://files.localhost:${PORT}`);
      console.log(`缓存目录：${CACHE_ROOT}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
