const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { fromIni } = require("@aws-sdk/credential-providers");
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
const jobs = new Map();
let browserImageQueue = Promise.resolve();
const remoteAgents = new RemoteAgentManager();
const remoteBrowserImages = new Map();

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

function decodeDescriptor(id) {
  if (!id || id.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpError(400, "无效的图片标识");
  }
  try {
    const descriptor = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
    if (
      !descriptor ||
      !["local", "ssh", "s3"].includes(descriptor.kind) ||
      (descriptor.kind === "s3" ? !descriptor.key : !descriptor.path)
    ) {
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
    const isImage = IMAGE_EXTENSIONS.has(path.extname(source.path).toLowerCase());
    return {
      targetType: "file",
      entries: [{
        id: encodeDescriptor({
          kind: "local",
          path: source.path,
          size: rootStat.size,
          modified: rootStat.mtimeMs,
        }),
        type: isImage ? "image" : "file",
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
      if (entry.name.startsWith(".")) continue;
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
        const isImage = IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
        const descriptor = {
          kind: "local",
          path: fullPath,
          size: stat.size,
          modified: stat.mtimeMs,
        };
        entriesResult.push({
          id: encodeDescriptor(descriptor),
          type: isImage ? "image" : "file",
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
        type: IMAGE_EXTENSIONS.has(path.posix.extname(remotePath).toLowerCase())
          ? "image"
          : "file",
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
        type: item.type,
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
            type: IMAGE_EXTENSIONS.has(
              path.posix.extname(source.requestedKey).toLowerCase(),
            ) ? "image" : "file",
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
        const isImage = IMAGE_EXTENSIONS.has(path.posix.extname(object.Key).toLowerCase());
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
          type: isImage ? "image" : "file",
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

async function downloadRemote(descriptor, destination) {
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

async function downloadS3(descriptor, destination) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    const client = getS3Client(descriptor);
    const result = await client.send(new GetObjectCommand({
      Bucket: descriptor.bucket,
      Key: descriptor.key,
    }));
    if (!result.Body) throw new HttpError(502, "对象存储返回了空文件");
    await pipeline(result.Body, fs.createWriteStream(temporary, { flags: "wx" }));
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

async function materialize(descriptor) {
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
  if (existing?.isFile() && existing.size > 0) return destination;
  await singleJob(`remote:${key}`, () => (
    descriptor.kind === "s3"
      ? downloadS3(descriptor, destination)
      : downloadRemote(descriptor, destination)
  ));
  return destination;
}

function descriptorIsImage(descriptor) {
  const sourcePath = descriptor.kind === "s3" ? descriptor.key : descriptor.path;
  return IMAGE_EXTENSIONS.has(path.posix.extname(sourcePath || "").toLowerCase());
}

function descriptorFileName(descriptor) {
  const sourcePath = descriptor.kind === "s3" ? descriptor.key : descriptor.path;
  return path.posix.basename(sourcePath || "image").replaceAll('"', "");
}

async function ensureDescriptorVersion(descriptor) {
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

async function prepareBrowserImage(descriptor, requestedMaxDimension) {
  const maxDimension = Math.max(
    2048,
    Math.min(16384, Number(requestedMaxDimension) || 8192),
  );
  if (descriptor.kind === "ssh") {
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
      return { ...info, key };
    }
    return info;
  }
  const input = await materialize(descriptor);
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
    return { resized, originalWidth, originalHeight, width, height };
  }

  const format = metadata.hasAlpha ? "png" : "jpg";
  const key = sha256(`${JSON.stringify(descriptor)}:${maxDimension}:${format}`);
  const destination = path.join(BROWSER_IMAGE_DIR, `${key}.${format}`);
  if (!await fsp.stat(destination).catch(() => null)) {
    await singleJob(`browser-image:${key}`, async () => {
      await queueBrowserImage(async () => {
        if (await fsp.stat(destination).catch(() => null)) return;
        const temporary = `${destination}.${process.pid}.tmp.${format}`;
        let pipeline = sharp(input, {
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
        pipeline = format === "png"
          ? pipeline.png({ compressionLevel: 1, adaptiveFiltering: false })
          : pipeline.jpeg({ quality: 88 });
        await pipeline.toFile(temporary);
        await fsp.rename(temporary, destination);
      });
    });
  }
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
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 64 * 1024) throw new HttpError(413, "配置内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "JSON 配置格式不正确");
  }
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
  if (download) {
    headers["Content-Disposition"] =
      `attachment; filename="${path.posix.basename(descriptor.key).replaceAll('"', "")}"`;
  }
  response.writeHead(status, headers);
  await pipeline(result.Body, response);
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

  const htmlRenderMatch = url.pathname.match(
    /^\/api\/html-render\/([^/]+)\/([^/]+)\/(.+)$/,
  );
  if (htmlRenderMatch) {
    if (request.method !== "GET") throw new HttpError(405, "只支持 GET 请求");
    const [, token, documentId, requestedPath] = htmlRenderMatch;
    if (token !== SESSION_TOKEN) throw new HttpError(401, "HTML 预览会话已失效");
    const descriptor = htmlRenderDescriptor(
      decodeDescriptor(decodeURIComponent(documentId)),
      requestedPath,
    );
    const filePath = await materialize(descriptor);
    const contentType = contentTypeFor(
      descriptor.kind === "s3" ? descriptor.key : descriptor.path,
    );
    const headers = {
      "X-Content-Type-Options": "nosniff",
      ...(contentType.startsWith("text/html")
        ? {
          "Content-Security-Policy":
            "default-src 'self' data: blob:; script-src 'none'; " +
            "style-src 'self' 'unsafe-inline' data:; connect-src 'none'; " +
            "object-src 'none'; base-uri 'self'; form-action 'none'",
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

  if (url.pathname === "/api/browser-image-info") {
    const descriptor = await ensureDescriptorVersion(
      decodeDescriptor(url.searchParams.get("id")),
    );
    const info = await prepareBrowserImage(
      descriptor,
      url.searchParams.get("maxDimension"),
    );
    sendJson(response, 200, info);
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
            "Content-Disposition":
              `attachment; filename="${descriptorFileName(descriptor)}"`,
          }
          : { "X-File-Cache": descriptor.kind === "local" ? "LOCAL" : "HIT" },
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
        ? { "Content-Disposition": `attachment; filename="${path.basename(filePath).replaceAll('"', "")}"` }
        : {},
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
