const IS_EXTENSION = location.protocol === "chrome-extension:";
let SERVER =
  location.protocol === "http:" &&
  ["127.0.0.1", "localhost", "files.localhost"].includes(location.hostname)
    ? location.origin
    : "";

const state = {
  token: "",
  favorites: [],
  s3Configs: [],
  s3Profiles: [],
  s3NodeStates: new Map(),
  activeS3Node: null,
  homeDirectory: "",
  sourceInputs: { local: "", ssh: "" },
  sourceMode: "local",
  source: "",
  targetType: "",
  directoryRoot: null,
  selectedDirectory: null,
  entries: [],
  visibleEntries: [],
  images: [],
  currentTreeFileId: null,
  archiveReturnContext: null,
  currentIndex: 0,
  thumbnailSize: 220,
  markdownDefaultLayout: "wide",
  markdownLayout: "wide",
  htmlViewMode: "rendered",
  currentFileEntry: null,
  viewer: null,
  viewerRequestId: 0,
  viewerImageUrl: "",
  readyThumbnails: new Set(),
  thumbnailObserver: null,
  filePreviewController: null,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  homeView: $("#homeView"),
  galleryView: $("#galleryView"),
  fileView: $("#fileView"),
  viewerView: $("#viewerView"),
  locationBar: $("#locationBar"),
  sourceForm: $("#sourceForm"),
  sourceInput: $("#sourceInput"),
  pathInputFields: $("#pathInputFields"),
  saveSourceButton: $("#saveSourceButton"),
  s3ConfigFields: $("#s3ConfigFields"),
  s3ManualCredentials: $("#s3ManualCredentials"),
  s3ManualConfigFields: $("#s3ManualConfigFields"),
  s3SavedConfig: $("#s3SavedConfig"),
  s3ConfigName: $("#s3ConfigName"),
  s3Endpoint: $("#s3Endpoint"),
  s3AccessKey: $("#s3AccessKey"),
  s3SecretKey: $("#s3SecretKey"),
  s3Region: $("#s3Region"),
  s3PathStyle: $("#s3PathStyle"),
  s3Nodes: $("#s3Nodes"),
  s3NodesEmpty: $("#s3NodesEmpty"),
  refreshS3NodesButton: $("#refreshS3NodesButton"),
  saveS3ConfigButton: $("#saveS3ConfigButton"),
  editCredentialsButton: $("#editCredentialsButton"),
  credentialsDialog: $("#credentialsDialog"),
  credentialsPath: $("#credentialsPath"),
  credentialsContent: $("#credentialsContent"),
  saveCredentialsButton: $("#saveCredentialsButton"),
  formError: $("#formError"),
  serverStatus: $("#serverStatus"),
  settingsButton: $("#settingsButton"),
  homeButton: $("#homeButton"),
  backButton: $("#backButton"),
  refreshButton: $("#refreshButton"),
  sourcePath: $("#sourcePath"),
  pathJumpForm: $("#pathJumpForm"),
  favorites: $("#favorites"),
  favoritesEmpty: $("#favoritesEmpty"),
  favoriteCount: $("#favoriteCount"),
  galleryTitle: $("#galleryTitle"),
  imageCount: $("#imageCount"),
  galleryGrid: $("#galleryGrid"),
  galleryLoading: $("#galleryLoading"),
  galleryEmpty: $("#galleryEmpty"),
  directoryTree: $("#directoryTree"),
  directoryEmpty: $("#directoryEmpty"),
  directoryUpButton: $("#directoryUpButton"),
  sidebarResizer: $("#sidebarResizer"),
  searchInput: $("#searchInput"),
  thumbnailSize: $("#thumbnailSize"),
  downloadDirectoryButton: $("#downloadDirectoryButton"),
  favoriteButton: $("#favoriteButton"),
  closeFileButton: $("#closeFileButton"),
  fileHomeButton: $("#fileHomeButton"),
  fileViewName: $("#fileViewName"),
  fileFormatBadge: $("#fileFormatBadge"),
  markdownLayoutControls: $("#markdownLayoutControls"),
  markdownLayoutWide: $("#markdownLayoutWide"),
  markdownLayoutReading: $("#markdownLayoutReading"),
  htmlViewControls: $("#htmlViewControls"),
  htmlSourceButton: $("#htmlSourceButton"),
  htmlRenderedButton: $("#htmlRenderedButton"),
  formattedFilePreview: $("#formattedFilePreview"),
  formattedFileLoading: $("#formattedFileLoading"),
  formattedFileError: $("#formattedFileError"),
  markdownPreview: $("#markdownPreview"),
  jsonPreview: $("#jsonPreview"),
  codePreview: $("#codePreview"),
  codeLineNumbers: $("#codeLineNumbers"),
  officePreview: $("#officePreview"),
  videoPreview: $("#videoPreview"),
  videoPlayer: $("#videoPlayer"),
  fileFrame: $("#fileFrame"),
  downloadFileButton: $("#downloadFileButton"),
  closeViewerButton: $("#closeViewerButton"),
  viewerHomeButton: $("#viewerHomeButton"),
  previousButton: $("#previousButton"),
  nextButton: $("#nextButton"),
  fitButton: $("#fitButton"),
  actualButton: $("#actualButton"),
  downloadOriginalButton: $("#downloadOriginalButton"),
  viewerName: $("#viewerName"),
  viewerMeta: $("#viewerMeta"),
  viewerNotice: $("#viewerNotice"),
  viewerLoading: $("#viewerLoading"),
  viewerLoadingText: $("#viewerLoadingText"),
  viewerError: $("#viewerError"),
  viewerCanvas: $("#viewer"),
  toast: $("#toast"),
};

function apiUrl(path, params = {}) {
  const url = new URL(path, SERVER);
  url.searchParams.set("token", state.token);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableApiError(status, message) {
  return status === 401 ||
    message === "接口不存在" ||
    /failed to fetch|fetch failed|econn|socket|network|连接.*(?:中断|失败)|通道.*失败/i.test(message);
}

async function api(
  path,
  params = {},
  attempt = 0,
  retryLimit = 2,
  onRetry = null,
) {
  let response;
  try {
    response = await fetch(apiUrl(path, params));
  } catch (error) {
    if (attempt < retryLimit && IS_EXTENSION) {
      onRetry?.(attempt + 1, error);
      if (await connectServer(true)) {
        await delay(Math.min(2000, 250 * (2 ** attempt)));
        return api(path, params, attempt + 1, retryLimit, onRetry);
      }
    }
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error || `请求失败 (${response.status})`;
    if (
      attempt < retryLimit &&
      IS_EXTENSION &&
      isRetryableApiError(response.status, message)
    ) {
      onRetry?.(attempt + 1, new Error(message));
      if (await connectServer(true)) {
        await delay(Math.min(2000, 250 * (2 ** attempt)));
        return api(path, params, attempt + 1, retryLimit, onRetry);
      }
    }
    throw new Error(message);
  }
  return body;
}

async function apiPost(path, body, retry = true) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (retry && IS_EXTENSION && await connectServer(true)) {
      return apiPost(path, body, false);
    }
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.error || `请求失败 (${response.status})`;
    if (
      retry &&
      IS_EXTENSION &&
      (response.status === 401 || message === "接口不存在") &&
      await connectServer(true)
    ) {
      return apiPost(path, body, false);
    }
    throw new Error(message);
  }
  return result;
}

function normalizeObjectStorageSource(source) {
  let value = String(source || "").trim();
  if (
    !/^(?:s3|oss):\/\//i.test(value) &&
    /^(?:s3|oss)%3A%2F%2F/i.test(value)
  ) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  const match = value.match(/^(s3|oss):\/\/(.*)$/i);
  return match ? `s3://${match[2]}` : value;
}

function inheritObjectStorageConnection(source, currentSource = state.source) {
  const normalized = normalizeObjectStorageSource(source);
  if (!normalized.startsWith("s3://") || !currentSource?.startsWith("s3://")) {
    return normalized;
  }
  try {
    const next = new URL(normalized);
    const current = new URL(currentSource);
    for (const name of ["profile", "connection"]) {
      if (!next.searchParams.has(name) && current.searchParams.has(name)) {
        next.searchParams.set(name, current.searchParams.get(name));
      }
    }
    return next.toString();
  } catch {
    return normalized;
  }
}

function sourceType(source) {
  source = normalizeObjectStorageSource(source);
  if (source.startsWith("s3://")) return "S3";
  return source.startsWith("ssh ") ||
    source.startsWith("ssh://") ||
    /^[^/][^:]*:.+/.test(source)
    ? "SSH"
    : "LOCAL";
}

function publicSource(source) {
  if (!source.startsWith("s3://")) return source;
  try {
    const url = new URL(source);
    return `s3://${url.hostname}${decodeURIComponent(url.pathname)}`;
  } catch {
    return source.split("?")[0];
  }
}

function setPathInputSource(source, placeholder) {
  const display = publicSource(source);
  elements.sourcePath.value = display;
  elements.sourcePath.dataset.displaySource = display;
  elements.sourcePath.dataset.resolvedSource = source;
  elements.sourcePath.placeholder =
    placeholder || "/path、user@host:/path 或 s3://bucket/path";
}

function sourceName(source) {
  if (source.startsWith("s3://")) {
    try {
      const url = new URL(source);
      const pathName = decodeURIComponent(url.pathname).replace(/\/+$/, "");
      return pathName.split("/").filter(Boolean).at(-1) || url.hostname;
    } catch {
      // Fall through to generic path handling.
    }
  }
  const trimmed = source.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts.at(-1) || trimmed;
}

function decodeEntryDescriptor(id) {
  try {
    const normalized = id.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(atob(normalized + padding));
  } catch {
    return null;
  }
}

function encodeEntryDescriptor(descriptor) {
  const bytes = new TextEncoder().encode(JSON.stringify(descriptor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function dirname(value) {
  const clean = value.replace(/\/+$/, "");
  const separator = clean.lastIndexOf("/");
  if (separator < 0) return "";
  return separator === 0 ? "/" : clean.slice(0, separator);
}

function normalizeAssetPath(value, absolute) {
  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length && segments.at(-1) !== "..") segments.pop();
      else if (!absolute) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}

function relativeImageDescriptor(documentEntry, source) {
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return null;
  const documentDescriptor = decodeEntryDescriptor(documentEntry.id);
  if (!documentDescriptor) return null;
  let relativePath;
  try {
    relativePath = decodeURIComponent(source.split(/[?#]/, 1)[0]);
  } catch {
    relativePath = source.split(/[?#]/, 1)[0];
  }
  if (!relativePath) return null;
  const descriptor = { ...documentDescriptor };
  delete descriptor.size;
  delete descriptor.modified;
  delete descriptor.etag;
  delete descriptor.directory;
  if (descriptor.kind === "s3") {
    const absolute = relativePath.startsWith("/");
    const combined = absolute
      ? relativePath
      : `${dirname(descriptor.key)}/${relativePath}`;
    descriptor.key = normalizeAssetPath(combined, false);
  } else if (descriptor.kind === "archive") {
    const combined = `${dirname(descriptor.member)}/${relativePath}`;
    descriptor.member = normalizeAssetPath(combined, false);
  } else {
    const absolute = relativePath.startsWith("/");
    const combined = absolute
      ? relativePath
      : `${dirname(descriptor.path)}/${relativePath}`;
    descriptor.path = normalizeAssetPath(
      combined,
      absolute || descriptor.path.startsWith("/"),
    );
  }
  return descriptor;
}

function resolveMarkdownImages(documentEntry) {
  for (const image of elements.markdownPreview.querySelectorAll("img[src]")) {
    const descriptor = relativeImageDescriptor(
      documentEntry,
      image.getAttribute("src"),
    );
    if (!descriptor) continue;
    image.src = apiUrl("/api/file", {
      id: encodeEntryDescriptor(descriptor),
    });
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", async () => {
      if (image.dataset.retried || !IS_EXTENSION) return;
      image.dataset.retried = "1";
      if (await connectServer(true)) {
        image.src = apiUrl("/api/file", {
          id: encodeEntryDescriptor(descriptor),
          retry: Date.now(),
        });
      }
    });
  }
}

function entryPathForCopy(entry) {
  const descriptor = decodeEntryDescriptor(entry.id);
  if (!descriptor) return entry.childSource || entry.relativePath || entry.name;
  if (descriptor.kind === "local") return descriptor.path;
  if (descriptor.kind === "s3") {
    return `s3://${descriptor.bucket}/${descriptor.key.replace(/^\/+/, "")}`;
  }
  if (descriptor.kind === "ssh") {
    return descriptor.path;
  }
  if (descriptor.kind === "archive") {
    return `${entryPathForCopy({ id: encodeEntryDescriptor(descriptor.archive) })}` +
      `!/${descriptor.member}`;
  }
  return entry.childSource || entry.relativePath || entry.name;
}

function copyPathValue(value) {
  if (sourceType(value) !== "SSH") return publicSource(value);
  if (value.startsWith("ssh://")) {
    try {
      return decodeURIComponent(new URL(value).pathname) || "/";
    } catch {
      return value;
    }
  }
  const normalized = value.startsWith("ssh ") ? value.slice(4) : value;
  const match = normalized.match(/^[^:]+:(.*)$/);
  return match ? match[1] : normalized;
}

async function copyPath(value, type) {
  const text = copyPathValue(value);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast(`已复制${type}路径`);
}

function createCopyPathButton(value, type) {
  const button = document.createElement("button");
  button.className = "directory-copy-button";
  button.type = "button";
  button.textContent = "⧉";
  button.title = `复制${type}路径：${copyPathValue(value)}`;
  button.setAttribute("aria-label", `复制${type}路径`);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    copyPath(value, type);
  });
  return button;
}

function triggerDownload(url, fileName = "") {
  const link = document.createElement("a");
  link.href = url;
  if (fileName) link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

function createFileDownloadButton(entry) {
  const button = document.createElement("button");
  button.className = "entry-download-button";
  button.type = "button";
  button.textContent = "↓";
  button.title = `下载 ${entry.name || entry.relativePath}`;
  button.setAttribute("aria-label", `下载 ${entry.name || entry.relativePath}`);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    triggerDownload(
      apiUrl("/api/file", { id: entry.id, download: "1" }),
      entry.name || "download",
    );
  });
  return button;
}

function directoryDownloadUrl(node) {
  if (node.archiveId) {
    if (!node.archivePath) {
      return apiUrl("/api/file", { id: node.archiveId, download: "1" });
    }
    return apiUrl("/api/download-directory", {
      archiveId: node.archiveId,
      path: node.archivePath,
    });
  }
  return apiUrl("/api/download-directory", { source: node.source });
}

function downloadDirectoryNode(node) {
  if (!node || node.syntheticS3Root) return;
  const name = `${node.name || "files"}${node.archiveId && !node.archivePath ? "" : ".zip"}`;
  triggerDownload(directoryDownloadUrl(node), name);
}

function parentPath(value) {
  const clean = value.replace(/\/+$/, "");
  const separator = clean.lastIndexOf("/");
  if (separator < 0) return "";
  if (separator === 0) return "/";
  return clean.slice(0, separator);
}

function parentSourceForFile(source) {
  if (source.startsWith("s3://") || source.startsWith("ssh://")) {
    const url = new URL(source);
    const parent = parentPath(decodeURIComponent(url.pathname));
    url.pathname = parent || "/";
    return url.toString();
  }
  const scpMatch = source.match(/^([^/][^:]*):(.*)$/);
  if (scpMatch) {
    const remotePath = scpMatch[2];
    const parent = parentPath(remotePath);
    if (!parent && remotePath.startsWith("~/")) return `${scpMatch[1]}:~`;
    return parent ? `${scpMatch[1]}:${parent}` : "";
  }
  return parentPath(source) || "/";
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function routePathForSource(source) {
  if (source.startsWith("s3://")) {
    const url = new URL(source);
    return `/s3/${encodeURIComponent(url.hostname)}${encodePath(url.pathname)}`;
  }
  if (source.startsWith("ssh://")) {
    const url = new URL(source);
    const authority = `${url.username ? `${url.username}@` : ""}${url.hostname}`;
    const query = new URLSearchParams();
    if (url.port) query.set("port", url.port);
    const suffix = query.size ? `?${query}` : "";
    return `/ssh/${encodeURIComponent(authority)}${encodePath(url.pathname)}${suffix}`;
  }
  if (source.startsWith("ssh ")) {
    const value = source.slice(4).trim();
    const separator = value.indexOf(":");
    const authority = separator >= 0 ? value.slice(0, separator) : value;
    const remotePath = separator >= 0 ? value.slice(separator + 1) || "~" : "~";
    const query = new URLSearchParams({ scp: "1", command: "1" });
    if (remotePath.startsWith("/")) query.set("absolute", "1");
    const routePath = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
    return `/ssh/${encodeURIComponent(authority)}${encodePath(routePath)}?${query}`;
  }
  const scpMatch = source.match(/^([^/][^:]*):(.+)$/);
  if (scpMatch) {
    const remotePath = scpMatch[2];
    const query = new URLSearchParams({ scp: "1" });
    if (remotePath.startsWith("/")) query.set("absolute", "1");
    const routePath = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
    return `/ssh/${encodeURIComponent(scpMatch[1])}${encodePath(routePath)}?${query}`;
  }
  return `/local${encodePath(source.startsWith("/") ? source : `/${source}`)}`;
}

function routeForSource(source) {
  const route = routePathForSource(source);
  return IS_EXTENSION ? `#${route}` : route;
}

function sourceFromRoute() {
  const routeUrl = IS_EXTENSION
    ? new URL(location.hash.slice(1) || "/", "http://route.local")
    : new URL(location.href);
  const segments = routeUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!segments.length) return null;
  const [kind, authority, ...rest] = segments;
  const folderPath = `/${rest.join("/")}`;
  if (kind === "s3" && authority) {
    const cleanSource = `s3://${authority}${folderPath}`;
    const storedSource = history.state?.source;
    return storedSource?.startsWith("s3://") &&
      publicSource(storedSource).replace(/\/+$/, "") === cleanSource.replace(/\/+$/, "")
      ? storedSource
      : cleanSource;
  }
  if (kind === "ssh" && authority) {
    if (routeUrl.searchParams.get("scp") === "1") {
      const oldAbsoluteRoute = /^\/ssh\/[^/]+\/\//.test(routeUrl.pathname);
      const remotePath = routeUrl.searchParams.get("absolute") === "1" ||
          oldAbsoluteRoute
        ? `/${rest.join("/")}`
        : rest.join("/");
      const value = `${authority}:${remotePath}`;
      return routeUrl.searchParams.get("command") === "1" ? `ssh ${value}` : value;
    }
    const port = routeUrl.searchParams.get("port");
    return `ssh://${authority}${port ? `:${port}` : ""}${folderPath}`;
  }
  if (kind === "local") return `/${[authority, ...rest].filter(Boolean).join("/")}`;
  return null;
}

function routeUrlForSource(source) {
  return new URL(routePathForSource(source), "http://route.local");
}

function sameRouteSource(left, right) {
  if (!left || !right) return false;
  const leftUrl = routeUrlForSource(left);
  const rightUrl = routeUrlForSource(right);
  return leftUrl.pathname === rightUrl.pathname &&
    leftUrl.search === rightUrl.search;
}

function routeSourceContains(candidate, target) {
  if (!candidate || !target) return false;
  const candidateUrl = routeUrlForSource(candidate);
  const targetUrl = routeUrlForSource(target);
  const candidatePath = candidateUrl.pathname.replace(/\/+$/, "");
  return targetUrl.pathname === candidatePath ||
    targetUrl.pathname.startsWith(`${candidatePath}/`);
}

function routeState(source, extra = {}) {
  const root = state.directoryRoot;
  const rootSource = root && !root.syntheticS3Root
    ? root.source
    : undefined;
  return {
    source,
    ...(rootSource ? { rootSource } : {}),
    ...extra,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 1800);
}

async function clipboardPng(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const maximum = 4096;
  const scale = Math.min(1, maximum / bitmap.width, maximum / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("图片转换失败")),
      "image/png",
    );
  });
  return png;
}

async function copyImageToClipboard(entry, preferredUrl = "") {
  if (!entry || !globalThis.ClipboardItem || !navigator.clipboard?.write) {
    showToast("当前浏览器不支持复制图片");
    return;
  }
  showToast("正在复制图片…");
  try {
    let response;
    try {
      response = await fetch(
        preferredUrl || apiUrl("/api/file", { id: entry.id }),
        { cache: "force-cache" },
      );
    } catch {
      if (!IS_EXTENSION || !(await connectServer(true))) throw new Error("图片连接失败");
      response = await fetch(apiUrl("/api/file", { id: entry.id }));
    }
    if (!response.ok) throw new Error(`图片读取失败 (${response.status})`);
    let blob = await response.blob();
    const supported = ClipboardItem.supports?.(blob.type) ?? blob.type === "image/png";
    if (!supported) blob = await clipboardPng(blob);
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
    showToast("图片已复制到剪贴板");
  } catch (error) {
    showToast(`复制失败：${error.message}`);
  }
}

function showHome() {
  closeViewer(false);
  closeFileViewer(false);
  state.targetType = "";
  state.directoryRoot = null;
  state.selectedDirectory = null;
  state.currentTreeFileId = null;
  state.activeS3Node = null;
  elements.homeView.classList.remove("hidden");
  elements.galleryView.classList.add("hidden");
  elements.locationBar.classList.add("hidden");
  elements.refreshButton.classList.add("hidden");
  history.pushState(null, "", IS_EXTENSION ? "#" : "/");
}

function showGallery() {
  elements.homeView.classList.add("hidden");
  elements.galleryView.classList.remove("hidden");
  elements.fileView.classList.add("hidden");
  elements.viewerView.classList.add("hidden");
  elements.locationBar.classList.remove("hidden");
  elements.refreshButton.classList.remove("hidden");
}

async function loadFavorites() {
  let favorites;
  if (globalThis.chrome?.storage?.local) {
    const result = await chrome.storage.local.get("favorites");
    favorites = result.favorites;
  } else {
    try {
      favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
    } catch {
      favorites = [];
    }
  }
  state.favorites = Array.isArray(favorites) ? favorites : [];
  renderFavorites();
}

async function saveFavorites() {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ favorites: state.favorites });
  } else {
    localStorage.setItem("favorites", JSON.stringify(state.favorites));
  }
  renderFavorites();
}

async function loadS3Configs() {
  let configs;
  if (globalThis.chrome?.storage?.local) {
    const result = await chrome.storage.local.get("s3Configs");
    configs = result.s3Configs;
  } else {
    try {
      configs = JSON.parse(localStorage.getItem("s3Configs") || "[]");
    } catch {
      configs = [];
    }
  }
  state.s3Configs = Array.isArray(configs) ? configs : [];
  renderS3ConfigOptions();
}

async function saveS3Configs() {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ s3Configs: state.s3Configs });
  } else {
    localStorage.setItem("s3Configs", JSON.stringify(state.s3Configs));
  }
  renderS3ConfigOptions(elements.s3SavedConfig.value);
}

function applyInterfaceStyle(style) {
  const selected = style === "windows" ? "windows" : "finder";
  document.documentElement.dataset.interfaceStyle = selected;
}

async function loadInterfaceStyle() {
  let style;
  let sidebarWidth;
  let thumbnailSize;
  let markdownDefaultLayout;
  if (globalThis.chrome?.storage?.local) {
    const result = await chrome.storage.local.get([
      "interfaceStyle",
      "sidebarWidth",
      "thumbnailSize",
      "markdownDefaultLayout",
    ]);
    style = result.interfaceStyle;
    sidebarWidth = result.sidebarWidth;
    thumbnailSize = result.thumbnailSize;
    markdownDefaultLayout = result.markdownDefaultLayout;
  } else {
    style = localStorage.getItem("interfaceStyle");
    sidebarWidth = Number(localStorage.getItem("sidebarWidth"));
    thumbnailSize = Number(localStorage.getItem("thumbnailSize"));
    markdownDefaultLayout = localStorage.getItem("markdownDefaultLayout");
  }
  applyInterfaceStyle(style);
  if (Number.isFinite(sidebarWidth) && sidebarWidth > 0) {
    applySidebarWidth(sidebarWidth);
  }
  applyThumbnailSize(thumbnailSize);
  state.markdownDefaultLayout =
    ["reading", "a4"].includes(markdownDefaultLayout) ? "reading" : "wide";
  setMarkdownLayout(state.markdownDefaultLayout);
}

function applyThumbnailSize(size) {
  const numeric = Number(size);
  const value = Number.isFinite(numeric) && numeric > 0
    ? Math.round(Math.max(140, Math.min(420, numeric)) / 20) * 20
    : 220;
  state.thumbnailSize = value;
  document.documentElement.style.setProperty("--thumbnail-size", `${value}px`);
  elements.thumbnailSize.value = String(value);
  elements.thumbnailSize.setAttribute("aria-valuetext", `${value} 像素`);
  return value;
}

async function saveThumbnailSize(size) {
  const value = applyThumbnailSize(size);
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ thumbnailSize: value });
  } else {
    localStorage.setItem("thumbnailSize", String(value));
  }
}

function setMarkdownLayout(layout) {
  state.markdownLayout = ["reading", "a4"].includes(layout) ? "reading" : "wide";
  const isReading = state.markdownLayout === "reading";
  elements.markdownPreview.classList.toggle("reading-layout", isReading);
  elements.markdownLayoutWide.classList.toggle("active", !isReading);
  elements.markdownLayoutReading.classList.toggle("active", isReading);
  elements.markdownLayoutWide.setAttribute("aria-pressed", String(!isReading));
  elements.markdownLayoutReading.setAttribute("aria-pressed", String(isReading));
}

function applySidebarWidth(width) {
  const maximum = Math.max(220, Math.min(520, window.innerWidth - 360));
  const value = Math.round(Math.max(180, Math.min(maximum, width)));
  document.documentElement.style.setProperty("--sidebar-width", `${value}px`);
  elements.sidebarResizer.setAttribute("aria-valuenow", String(value));
  return value;
}

async function saveSidebarWidth(width) {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ sidebarWidth: width });
  } else {
    localStorage.setItem("sidebarWidth", String(width));
  }
}

function setupSidebarResizer() {
  elements.sidebarResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    elements.sidebarResizer.setPointerCapture(event.pointerId);
    elements.sidebarResizer.classList.add("dragging");
    document.body.classList.add("resizing-sidebar");
  });
  elements.sidebarResizer.addEventListener("pointermove", (event) => {
    if (!elements.sidebarResizer.hasPointerCapture(event.pointerId)) return;
    const left = elements.galleryView.getBoundingClientRect().left;
    applySidebarWidth(event.clientX - left);
  });
  const finish = async (event) => {
    if (!elements.sidebarResizer.hasPointerCapture(event.pointerId)) return;
    elements.sidebarResizer.releasePointerCapture(event.pointerId);
    elements.sidebarResizer.classList.remove("dragging");
    document.body.classList.remove("resizing-sidebar");
    const value = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"),
      10,
    );
    await saveSidebarWidth(value);
  };
  elements.sidebarResizer.addEventListener("pointerup", finish);
  elements.sidebarResizer.addEventListener("pointercancel", finish);
  elements.sidebarResizer.addEventListener("keydown", async (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const current = elements.directoryTree.closest(".directory-panel").offsetWidth;
    const value = applySidebarWidth(current + (event.key === "ArrowLeft" ? -16 : 16));
    await saveSidebarWidth(value);
  });
}

async function loadSystemInfo() {
  try {
    const result = await api("/api/system");
    state.homeDirectory = result.homeDirectory || "";
    if (!state.sourceInputs.local) state.sourceInputs.local = state.homeDirectory;
    if (state.sourceMode === "local" && !elements.sourceInput.value) {
      elements.sourceInput.value = state.homeDirectory;
    }
  } catch {
    // The path field remains editable if an older helper is still shutting down.
  }
}

function renderS3ConfigOptions(selectedId = "") {
  elements.s3SavedConfig.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "新建配置";
  elements.s3SavedConfig.append(empty);
  for (const config of state.s3Configs) {
    const option = document.createElement("option");
    option.value = config.id;
    option.textContent = config.name || config.endpoint || config.accessKeyId;
    elements.s3SavedConfig.append(option);
  }
  elements.s3SavedConfig.value = selectedId;
}

function fillS3Config(config) {
  elements.s3ConfigName.value = config?.name || "";
  elements.s3Endpoint.value = config?.endpoint || "";
  elements.s3AccessKey.value = config?.accessKeyId || "";
  elements.s3SecretKey.value = config?.secretAccessKey || "";
  elements.s3Region.value = config?.region || "us-east-1";
  elements.s3PathStyle.checked = config?.forcePathStyle !== false;
}

function collectS3Config() {
  const selectedId = elements.s3SavedConfig.value;
  const config = {
    id: selectedId || crypto.randomUUID(),
    name: elements.s3ConfigName.value.trim(),
    endpoint: elements.s3Endpoint.value.trim(),
    accessKeyId: elements.s3AccessKey.value.trim(),
    secretAccessKey: elements.s3SecretKey.value,
    region: elements.s3Region.value.trim() || "us-east-1",
    forcePathStyle: elements.s3PathStyle.checked,
  };
  if (!config.name) throw new Error("请输入 S3 配置名称");
  if (!config.accessKeyId) throw new Error("请输入 Access Key (AK)");
  if (!config.secretAccessKey) throw new Error("请输入 Secret Key (SK)");
  if (config.endpoint) {
    let endpoint;
    try {
      endpoint = new URL(config.endpoint);
    } catch {
      throw new Error("Endpoint URL 格式不正确");
    }
    if (!["http:", "https:"].includes(endpoint.protocol)) {
      throw new Error("Endpoint URL 必须以 http:// 或 https:// 开头");
    }
  }
  return config;
}

async function storeAndRegisterS3Config(config) {
  const index = state.s3Configs.findIndex((item) => item.id === config.id);
  if (index >= 0) state.s3Configs[index] = config;
  else state.s3Configs.push(config);
  await saveS3Configs();
  elements.s3SavedConfig.value = config.id;
  await apiPost("/api/s3/config", config);
}

async function registerS3ConfigForSource(source) {
  if (!source.startsWith("s3://")) return;
  const url = new URL(source);
  const connectionId = url.searchParams.get("connection");
  if (!connectionId) return;
  const config = state.s3Configs.find((item) => item.id === connectionId);
  if (!config) throw new Error("找不到该收藏使用的 S3 连接配置");
  await apiPost("/api/s3/config", config);
}

function configuredS3Nodes() {
  return [
    ...state.s3Profiles.map((profile) => ({
      id: `profile:${profile}`,
      kind: "profile",
      name: profile,
      detail: "~/.aws/credentials · Profile",
      profile,
    })),
    ...state.s3Configs.map((config) => ({
      id: `connection:${config.id}`,
      kind: "connection",
      name: config.name || config.endpoint || config.accessKeyId,
      detail: config.endpoint || "独立 S3 连接",
      connectionId: config.id,
      config,
    })),
  ];
}

function bucketSource(node, bucket) {
  const url = new URL(`s3://${bucket}`);
  if (node.kind === "profile" && node.profile !== "default") {
    url.searchParams.set("profile", node.profile);
  }
  if (node.kind === "connection") {
    url.searchParams.set("connection", node.connectionId);
  }
  return url.toString();
}

function renderS3Nodes() {
  const nodes = configuredS3Nodes();
  elements.s3Nodes.replaceChildren();
  elements.s3NodesEmpty.classList.toggle("hidden", nodes.length > 0);
  const fragment = document.createDocumentFragment();

  for (const node of nodes) {
    const nodeState = state.s3NodeStates.get(node.id) || {
      loading: false,
      buckets: null,
      error: "",
    };
    state.s3NodeStates.set(node.id, nodeState);

    const container = document.createElement("div");
    container.className = "s3-node";
    const button = document.createElement("button");
    button.className = "s3-node-button";
    button.type = "button";
    const arrow = document.createElement("span");
    arrow.className = "s3-node-arrow";
    arrow.textContent = "›";
    const info = document.createElement("span");
    info.className = "s3-node-info";
    const name = document.createElement("strong");
    name.textContent = node.name;
    const detail = document.createElement("span");
    detail.textContent = node.detail;
    info.append(name, detail);
    const status = document.createElement("span");
    status.className = "s3-node-state";
    status.textContent = nodeState.loading
      ? "读取中…"
      : nodeState.buckets
        ? `${nodeState.buckets.length} 个 Bucket`
        : "进入";
    button.append(arrow, info, status);
    button.addEventListener("click", () => openS3Root(node));
    container.append(button);
    fragment.append(container);
  }
  elements.s3Nodes.append(fragment);
}

function showS3BucketBrowser(node, buckets) {
  state.activeS3Node = node;
  state.targetType = "directory";
  const entries = buckets.map((bucket) => ({
    id: `bucket:${node.id}:${bucket.name}`,
    type: "directory",
    name: bucket.name,
    relativePath: bucket.name,
    childSource: bucketSource(node, bucket.name),
    size: null,
    modified: bucket.createdAt,
  }));
  const root = createDirectoryRoot("", entries);
  root.name = node.name;
  root.detail = node.detail;
  root.syntheticS3Root = true;
  state.directoryRoot = root;
  state.selectedDirectory = root;
  showGallery();
  updateSelectedDirectory(root, false);
}

async function openS3Root(node, force = false) {
  const nodeState = state.s3NodeStates.get(node.id) || {
    loading: false,
    buckets: null,
    error: "",
  };
  state.s3NodeStates.set(node.id, nodeState);
  if (force) nodeState.buckets = null;
  nodeState.error = "";
  if (nodeState.buckets) {
    showS3BucketBrowser(node, nodeState.buckets);
    return;
  }
  nodeState.loading = true;
  renderS3Nodes();
  try {
    if (node.kind === "connection") {
      await apiPost("/api/s3/config", node.config);
    }
    const result = await api("/api/s3/buckets", node.kind === "connection"
      ? { connection: node.connectionId }
      : { profile: node.profile });
    nodeState.buckets = result.buckets;
    showS3BucketBrowser(node, nodeState.buckets);
  } catch (error) {
    nodeState.error = error.message;
    showToast(`S3 连接失败：${error.message}`);
  } finally {
    nodeState.loading = false;
    renderS3Nodes();
  }
}

async function loadS3Nodes(force = false) {
  if (!state.token && !(await connectServer())) return;
  if (force) state.s3NodeStates.clear();
  try {
    const result = await api("/api/s3/credentials");
    state.s3Profiles = result.profiles || [];
    renderS3Nodes();
  } catch (error) {
    elements.formError.textContent = error.message;
  }
}

async function saveStandaloneS3Config() {
  try {
    const config = collectS3Config();
    await storeAndRegisterS3Config(config);
    state.s3NodeStates.delete(`connection:${config.id}`);
    renderS3Nodes();
    showToast("S3 连接已保存");
  } catch (error) {
    elements.formError.textContent = error.message;
  }
}

async function sourceFromForm() {
  const source = elements.sourceInput.value.trim();
  if (!source) throw new Error("请先输入目录路径");
  if (state.sourceMode === "s3") {
    throw new Error("请从 S3 配置节点中选择 Bucket");
  }
  return source;
}

async function openCredentialsEditor() {
  try {
    const result = await api("/api/s3/credentials");
    elements.credentialsPath.textContent = result.path;
    elements.credentialsContent.value = result.content;
    elements.credentialsDialog.showModal();
    elements.credentialsContent.focus();
  } catch (error) {
    elements.formError.textContent = error.message;
  }
}

async function saveCredentialsFile() {
  try {
    const result = await apiPost("/api/s3/credentials", {
      content: elements.credentialsContent.value,
    });
    elements.credentialsPath.textContent = result.path;
    elements.credentialsDialog.close();
    await loadS3Nodes(true);
    showToast("凭证文件已保存");
  } catch (error) {
    showToast(`保存失败：${error.message}`);
  }
}

function renderFavorites() {
  elements.favorites.replaceChildren();
  elements.favoritesEmpty.classList.toggle("hidden", state.favorites.length > 0);
  elements.favoriteCount.textContent = state.favorites.length
    ? `${state.favorites.length} 个路径`
    : "";

  for (const favorite of state.favorites) {
    const card = document.createElement("article");
    card.className = "favorite-card";
    card.title = publicSource(favorite.source);

    const type = document.createElement("div");
    type.className = "favorite-type";
    const kind = sourceType(favorite.source);
    type.textContent = kind === "LOCAL" ? "⌂" : kind;

    const info = document.createElement("div");
    info.className = "favorite-info";
    const name = document.createElement("strong");
    name.textContent = sourceName(favorite.source);
    const path = document.createElement("span");
    path.textContent = publicSource(favorite.source);
    info.append(name, path);

    const remove = document.createElement("button");
    remove.className = "delete-favorite";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "取消收藏";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      state.favorites = state.favorites.filter((item) => item.id !== favorite.id);
      await saveFavorites();
      syncFavoriteButton();
    });

    card.append(type, info, remove);
    card.addEventListener("click", () => openSource(favorite.source));
    elements.favorites.append(card);
  }
}

function favoriteId(source) {
  return `path:${source}`;
}

function isCurrentFavorite() {
  return state.favorites.some((favorite) => favorite.source === state.source);
}

function syncFavoriteButton() {
  const saved = isCurrentFavorite();
  elements.favoriteButton.textContent = saved ? "★ 已收藏" : "☆ 收藏路径";
}

async function toggleFavorite() {
  const id = favoriteId(state.source);
  if (isCurrentFavorite()) {
    state.favorites = state.favorites.filter((favorite) => favorite.source !== state.source);
    showToast("已取消收藏");
  } else {
    state.favorites.unshift({
      id,
      source: state.source,
      savedAt: Date.now(),
    });
    showToast("路径已收藏");
  }
  await saveFavorites();
  syncFavoriteButton();
}

async function saveInputAsFavorite() {
  let source;
  try {
    source = await sourceFromForm();
  } catch (error) {
    elements.formError.textContent = error.message;
    return;
  }
  const id = favoriteId(source);
  if (state.favorites.some((favorite) => favorite.source === source)) {
    showToast("这个路径已经收藏");
    return;
  }
  state.favorites.unshift({ id, source, savedAt: Date.now() });
  await saveFavorites();
  elements.formError.textContent = "";
  showToast("路径已加入收藏");
}

async function connectServer(forceRestart = false) {
  try {
    if (IS_EXTENSION) {
      const result = await chrome.runtime.sendMessage({
        type: forceRestart ? "recoverBackend" : "getBackend",
      });
      if (!result?.ok) throw new Error(result?.error || "无法启动本地能力");
      SERVER = result.url;
      state.token = result.token;
      elements.serverStatus.textContent = "本地能力已连接";
      elements.serverStatus.className = "status online";
      return true;
    }
    const response = await fetch(`${SERVER}/api/session`);
    if (!response.ok) throw new Error("服务未启动");
    const data = await response.json();
    state.token = data.token;
    elements.serverStatus.textContent = "本地服务已连接";
    elements.serverStatus.className = "status online";
    return true;
  } catch (error) {
    elements.serverStatus.textContent = "本地能力不可用";
    elements.serverStatus.className = "status offline";
    elements.formError.textContent = IS_EXTENSION
      ? error.message
      : "本地开发服务未启动。";
    return false;
  }
}

function updateDirectoryNode(node, entries) {
  const previous = new Map(node.children.map((child) => [
    child.archivePath || child.source,
    child,
  ]));
  node.entries = entries;
  node.children = entries
    .filter((entry) => entry.type === "directory")
    .map((entry) => {
      const key = entry.archivePath || entry.childSource;
      const existing = previous.get(key);
      if (existing) {
        existing.name = entry.name;
        return existing;
      }
      return {
        source: entry.childSource || `${node.source}${entry.name}/`,
        name: entry.name,
        parent: node,
        archiveId: node.archiveId,
        archivePath: entry.archivePath,
        loaded: false,
        loading: false,
        expanded: false,
        entries: [],
        children: [],
      };
    });
  node.loaded = true;
}

function createDirectoryRoot(source, entries) {
  const node = {
    source,
    name: sourceName(source),
    parent: null,
    loaded: true,
    loading: false,
    expanded: true,
    entries: [],
    children: [],
  };
  updateDirectoryNode(node, entries);
  return node;
}

function updateSelectedDirectory(node, updateRoute = true) {
  const syntheticRoot = Boolean(node.syntheticS3Root);
  const archiveDirectory = Boolean(node.archiveId);
  state.selectedDirectory = node;
  state.source = syntheticRoot ? "" : node.source;
  state.entries = node.entries.filter((entry) => entry.type !== "directory");
  state.visibleEntries = state.entries;
  state.images = state.entries.filter((entry) => entry.type === "image");
  if (!syntheticRoot) elements.sourceInput.value = node.source;
  setPathInputSource(
    syntheticRoot ? "" : node.source,
    syntheticRoot
      ? `${node.detail} · 也可以直接输入 s3://bucket/path`
      : undefined,
  );
  elements.galleryTitle.textContent = syntheticRoot ? "Buckets" : node.name;
  elements.searchInput.value = "";
  elements.favoriteButton.classList.toggle("hidden", syntheticRoot || archiveDirectory);
  elements.downloadDirectoryButton.classList.toggle("hidden", syntheticRoot);
  elements.downloadDirectoryButton.textContent =
    archiveDirectory && !node.archivePath ? "↓ 下载归档" : "↓ 下载目录";
  renderDirectoryTree();
  renderGallery();
  if (!syntheticRoot) syncFavoriteButton();

  if (updateRoute && !syntheticRoot && !archiveDirectory) {
    const route = routeForSource(node.source);
    const currentRoute = IS_EXTENSION
      ? location.hash
      : `${location.pathname}${location.search}`;
    if (currentRoute !== route) {
      history.pushState(routeState(node.source), "", route);
    } else {
      history.replaceState(routeState(node.source), "", route);
    }
  }
}

async function loadDirectoryNode(node, force = false) {
  if (node.loaded && !force) return;
  node.loading = true;
  renderDirectoryTree();
  try {
    let result;
    if (node.archiveId) {
      result = await api("/api/archive/list", {
        id: node.archiveId,
        path: node.archivePath || "",
      });
    } else {
      await registerS3ConfigForSource(node.source);
      result = await api("/api/list", {
        source: node.source,
        refresh: force ? "1" : "0",
      });
    }
    if (result.targetType !== "directory") throw new Error("该路径不是目录");
    updateDirectoryNode(node, result.images);
  } finally {
    node.loading = false;
    renderDirectoryTree();
  }
}

async function selectDirectoryNode(node) {
  closeViewer(false);
  closeFileViewer(false);
  state.currentTreeFileId = null;
  elements.galleryLoading.classList.remove("hidden");
  elements.galleryGrid.replaceChildren();
  elements.galleryEmpty.classList.add("hidden");
  try {
    await loadDirectoryNode(node);
    node.expanded = true;
    updateSelectedDirectory(node);
  } catch (error) {
    showToast(`目录读取失败：${error.message}`);
  } finally {
    elements.galleryLoading.classList.add("hidden");
  }
}

function captureDirectoryContext() {
  if (!state.directoryRoot) return null;
  return {
    directoryRoot: state.directoryRoot,
    selectedDirectory: state.selectedDirectory,
    source: state.source,
    targetType: state.targetType,
  };
}

function restoreCapturedDirectoryContext(context) {
  if (!context) {
    showHome();
    return;
  }
  state.directoryRoot = context.directoryRoot;
  state.selectedDirectory = context.selectedDirectory;
  state.source = context.source;
  state.targetType = context.targetType;
  state.archiveReturnContext = context.directoryRoot.archiveReturnContext || null;
  updateSelectedDirectory(context.selectedDirectory, false);
  showGallery();
}

async function openArchive(entry) {
  const returnContext = captureDirectoryContext();
  closeViewer(false);
  closeFileViewer(false);
  elements.galleryLoading.classList.remove("hidden");
  try {
    const result = await api("/api/archive/list", { id: entry.id, path: "" });
    const archivePath = entryPathForCopy(entry);
    const root = {
      source: `${archivePath}!/`,
      name: entry.name || "归档文件",
      parent: null,
      archiveId: entry.id,
      archivePath: "",
      archiveReturnContext: returnContext,
      loaded: true,
      loading: false,
      expanded: true,
      entries: [],
      children: [],
    };
    updateDirectoryNode(root, result.images);
    state.archiveReturnContext = returnContext;
    state.targetType = "directory";
    state.directoryRoot = root;
    state.selectedDirectory = root;
    state.currentTreeFileId = null;
    updateSelectedDirectory(root, false);
    showGallery();
  } catch (error) {
    showToast(`归档文件打开失败：${error.message}`);
  } finally {
    elements.galleryLoading.classList.add("hidden");
  }
}

async function toggleDirectoryNode(node) {
  if (node.expanded) {
    node.expanded = false;
    renderDirectoryTree();
    return;
  }
  try {
    await loadDirectoryNode(node);
    node.expanded = true;
    renderDirectoryTree();
  } catch (error) {
    showToast(`目录读取失败：${error.message}`);
  }
}

function renderDirectoryTree() {
  elements.directoryTree.replaceChildren();
  const root = state.directoryRoot;
  if (!root) return;

  const fragment = document.createDocumentFragment();
  const openTreeFile = (node, entry) => {
    updateSelectedDirectory(node);
    state.currentTreeFileId = entry.id;
    renderDirectoryTree();
    if (entry.type === "image") {
      state.currentIndex = state.images.findIndex((image) => image.id === entry.id);
      openViewer();
    } else if (entry.type === "archive") {
      openArchive(entry);
    } else {
      openFileViewer(entry);
    }
  };
  const appendFile = (node, entry, depth) => {
    const row = document.createElement("div");
    row.className = "directory-row directory-file-row";
    row.classList.toggle("active-file", entry.id === state.currentTreeFileId);
    row.style.setProperty("--tree-depth", depth);
    row.title = entry.relativePath || entry.name;

    const spacer = document.createElement("span");
    spacer.className = "directory-toggle directory-file-spacer";
    const icon = document.createElement("span");
    icon.className = `directory-file-icon ${entry.type}`;
    const extension = entry.name?.split(".").at(-1)?.toLocaleLowerCase();
    icon.textContent = entry.type === "image"
      ? "▧"
      : entry.type === "archive"
        ? "▣"
      : extension === "md" || extension === "markdown"
        ? "M"
        : extension === "json"
          ? "{}"
          : "·";
    const label = document.createElement("span");
    label.className = "directory-label";
    label.textContent = entry.name || entry.relativePath;
    const downloadButton = createFileDownloadButton(entry);
    downloadButton.className = "directory-copy-button";
    const copyButton = createCopyPathButton(entryPathForCopy(entry), "文件");
    row.append(spacer, icon, label, downloadButton, copyButton);
    row.addEventListener("click", () => openTreeFile(node, entry));
    if (entry.type === "image") {
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        copyImageToClipboard(entry);
      });
    }
    fragment.append(row);
  };
  const appendNode = (node, depth) => {
    const row = document.createElement("div");
    row.className = "directory-row";
    row.classList.toggle("selected", node === state.selectedDirectory);
    row.style.setProperty("--tree-depth", depth);
    row.title = node.source;

    const toggle = document.createElement("button");
    toggle.className = "directory-toggle";
    toggle.type = "button";
    toggle.textContent = node.loading ? "…" : node.expanded ? "⌄" : "›";
    toggle.title = node.expanded ? "折叠目录" : "展开目录";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleDirectoryNode(node);
    });

    const icon = document.createElement("span");
    icon.className = "directory-icon";
    icon.textContent = node.expanded ? "▾" : "▸";
    const label = document.createElement("span");
    label.className = "directory-label";
    label.textContent = node.name || node.source;
    const downloadButton = document.createElement("button");
    downloadButton.className = "directory-copy-button";
    downloadButton.type = "button";
    downloadButton.textContent = "↓";
    downloadButton.title = `下载目录：${node.name || node.source}`;
    downloadButton.addEventListener("click", (event) => {
      event.stopPropagation();
      downloadDirectoryNode(node);
    });
    const copyButton = createCopyPathButton(node.source, "目录");
    row.append(toggle, icon, label, downloadButton, copyButton);
    row.addEventListener("click", () => selectDirectoryNode(node));
    fragment.append(row);

    if (node.expanded) {
      node.children.forEach((child) => appendNode(child, depth + 1));
      node.entries
        .filter((entry) => entry.type !== "directory")
        .forEach((entry) => appendFile(node, entry, depth + 1));
    }
  };
  appendNode(root, 0);
  elements.directoryTree.append(fragment);
  const selected = state.selectedDirectory;
  elements.directoryEmpty.classList.toggle(
    "hidden",
    !selected?.loaded || selected.entries.length > 0,
  );
  elements.directoryUpButton.disabled =
    !selected?.parent && !state.directoryRoot?.archiveReturnContext;
}

async function openSource(source, force = false, options = {}) {
  if (!state.token && !(await connectServer())) return;

  const cleanSource = normalizeObjectStorageSource(source);
  if (!cleanSource) return;

  closeViewer(false);
  closeFileViewer(false);
  state.source = cleanSource;
  state.sourceMode = sourceType(cleanSource).toLocaleLowerCase();
  state.targetType = "";
  state.directoryRoot = null;
  state.selectedDirectory = null;
  state.currentTreeFileId = null;
  elements.sourceInput.value = cleanSource;
  if (state.sourceMode === "local" || state.sourceMode === "ssh") {
    state.sourceInputs[state.sourceMode] = cleanSource;
  }
  setPathInputSource(cleanSource);
  elements.galleryTitle.textContent = sourceName(cleanSource);
  elements.searchInput.value = "";
  elements.formError.textContent = "";
  elements.galleryGrid.replaceChildren();
  elements.directoryTree.replaceChildren();
  elements.galleryLoading.classList.remove("hidden");
  elements.galleryEmpty.classList.add("hidden");
  showGallery();
  elements.favoriteButton.classList.remove("hidden");
  syncFavoriteButton();

  try {
    await registerS3ConfigForSource(cleanSource);
    const result = await api("/api/list", {
      source: cleanSource,
      refresh: force ? "1" : "0",
    });
    if (result.targetType === "file" && options.anchorFileInParent && result.images[0]) {
      const parentSource = parentSourceForFile(cleanSource);
      if (parentSource && parentSource !== cleanSource) {
        await openSource(parentSource, force, {
          openEntryName: result.images[0].name,
        });
        setPathInputSource(cleanSource);
        history.replaceState(
          routeState(cleanSource, { anchorFileInParent: true }),
          "",
          routeForSource(cleanSource),
        );
        return;
      }
    }
    state.targetType = result.targetType;
    const rootEntries = result.images;
    if (result.targetType === "directory") {
      elements.downloadDirectoryButton.classList.remove("hidden");
      elements.downloadDirectoryButton.textContent = "↓ 下载目录";
      state.directoryRoot = createDirectoryRoot(cleanSource, rootEntries);
      state.selectedDirectory = state.directoryRoot;
      state.entries = rootEntries.filter((entry) => entry.type !== "directory");
      state.visibleEntries = state.entries;
      state.images = state.entries.filter((entry) => entry.type === "image");
      renderDirectoryTree();
      renderGallery();
    } else {
      state.entries = result.images;
      state.visibleEntries = result.images;
      state.images = result.images.filter((entry) => entry.type === "image");
    }
    const route = routeForSource(cleanSource);
    const currentRoute = IS_EXTENSION
      ? location.hash
      : `${location.pathname}${location.search}`;
    if (!options.preserveRoute && currentRoute !== route) {
      history.pushState(routeState(cleanSource), "", route);
    } else if (!options.preserveRoute) {
      history.replaceState(routeState(cleanSource), "", route);
    }
    if (result.targetType === "file" && result.images[0]) {
      if (result.images[0].type === "image") {
        state.currentIndex = 0;
        await openViewer();
      } else if (result.images[0].type === "archive") {
        await openArchive(result.images[0]);
      } else {
        openFileViewer(result.images[0]);
      }
    } else if (result.targetType === "directory" && options.openEntryName) {
      const entry = state.entries.find((item) => item.name === options.openEntryName);
      if (entry?.type === "image") {
        state.currentIndex = state.images.findIndex((image) => image.id === entry.id);
        await openViewer();
      } else if (entry?.type === "archive") {
        await openArchive(entry);
      } else if (entry) {
        await openFileViewer(entry);
      } else {
        showToast(`已进入父目录，但没有找到 ${options.openEntryName}`);
      }
    }
  } catch (error) {
    showHome();
    elements.formError.textContent = error.message;
  } finally {
    elements.galleryLoading.classList.add("hidden");
  }
}

async function restoreDirectoryContext(rootSource, selectedSource) {
  await openSource(rootSource, false, { preserveRoute: true });
  let node = state.directoryRoot;
  if (!node || sameRouteSource(node.source, selectedSource)) {
    history.replaceState(routeState(selectedSource), "", routeForSource(selectedSource));
    return;
  }

  for (let depth = 0; depth < 100; depth += 1) {
    const child = node.children
      .filter((item) => routeSourceContains(item.source, selectedSource))
      .sort((left, right) => (
        routeUrlForSource(right.source).pathname.length -
        routeUrlForSource(left.source).pathname.length
      ))[0];
    if (!child) break;
    node.expanded = true;
    await loadDirectoryNode(child);
    child.expanded = true;
    node = child;
    if (sameRouteSource(node.source, selectedSource)) {
      updateSelectedDirectory(node, false);
      history.replaceState(
        routeState(selectedSource),
        "",
        routeForSource(selectedSource),
      );
      return;
    }
  }

  updateSelectedDirectory(state.directoryRoot, false);
  history.replaceState(
    routeState(state.directoryRoot.source),
    "",
    routeForSource(state.directoryRoot.source),
  );
}

async function openRoutedSource(source) {
  const rootSource = history.state?.rootSource;
  if (
    rootSource &&
    !history.state?.anchorFileInParent &&
    !sameRouteSource(rootSource, source)
  ) {
    await restoreDirectoryContext(rootSource, source);
    return;
  }
  await openSource(source, false, { anchorFileInParent: true });
}

function renderGallery() {
  state.thumbnailObserver?.disconnect();
  elements.galleryGrid.replaceChildren();
  elements.galleryEmpty.classList.toggle("hidden", state.visibleEntries.length > 0);
  elements.imageCount.textContent = `${state.visibleEntries.length} / ${state.entries.length} 项`;

  state.thumbnailObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      image.src = apiUrl("/api/thumbnail", { id: image.dataset.id });
      image.onload = () => {
        state.readyThumbnails.add(image.dataset.id);
        image.classList.add("loaded");
      };
      observer.unobserve(image);
    }
  }, { rootMargin: "500px" });

  const fragment = document.createDocumentFragment();
  state.visibleEntries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "image-card";

    const preview = document.createElement("div");
    preview.className = "image-preview";
    if (entry.type === "image") {
      const thumbnail = document.createElement("img");
      thumbnail.alt = "";
      thumbnail.dataset.id = entry.id;
      preview.append(thumbnail);
      state.thumbnailObserver.observe(thumbnail);
    } else {
      const symbol = document.createElement("div");
      symbol.className = "file-symbol";
      const extension = entry.name?.split(".").at(-1);
      symbol.textContent = entry.type === "archive"
        ? "ARCHIVE"
        : extension && extension !== entry.name
        ? extension.slice(0, 5).toLocaleUpperCase()
        : "FILE";
      preview.append(symbol);
    }
    preview.append(createFileDownloadButton(entry));

    const info = document.createElement("div");
    info.className = "image-info";
    const name = document.createElement("strong");
    name.textContent = entry.relativePath;
    name.title = entry.relativePath;
    const meta = document.createElement("span");
    const typeLabel = entry.type === "image"
      ? "图片"
      : entry.type === "archive"
        ? "归档"
        : "文件";
    meta.textContent = [typeLabel, formatBytes(entry.size)].filter(Boolean).join(" · ");
    info.append(name, meta);

    card.append(preview, info);
    card.addEventListener("click", () => {
      if (entry.type === "image") {
        state.currentIndex = state.images.findIndex((item) => item.id === entry.id);
        openViewer();
      } else if (entry.type === "archive") {
        openArchive(entry);
      } else {
        openFileViewer(entry);
      }
    });
    if (entry.type === "image") {
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        copyImageToClipboard(entry);
      });
    }
    fragment.append(card);
  });
  elements.galleryGrid.append(fragment);
}

function searchImages(value) {
  const query = value.trim().toLocaleLowerCase();
  state.visibleEntries = query
    ? state.entries.filter((entry) => entry.relativePath.toLocaleLowerCase().includes(query))
    : state.entries;
  renderGallery();
}

function navigateDirectoryUp() {
  const parent = state.selectedDirectory?.parent;
  if (parent) selectDirectoryNode(parent);
  else if (state.directoryRoot?.archiveId) {
    restoreCapturedDirectoryContext(state.directoryRoot.archiveReturnContext);
  }
  else showHome();
}

async function refreshCurrentDirectory() {
  const node = state.selectedDirectory;
  if (!node) return;
  if (node.syntheticS3Root && state.activeS3Node) {
    await openS3Root(state.activeS3Node, true);
    return;
  }

  const activeEntry = node.entries.find(
    (entry) => entry.id === state.currentTreeFileId,
  );
  const activePath = activeEntry ? entryPathForCopy(activeEntry) : "";
  const imageWasOpen = !elements.viewerView.classList.contains("hidden");
  const fileWasOpen = !elements.fileView.classList.contains("hidden");
  elements.galleryLoading.classList.remove("hidden");
  try {
    await loadDirectoryNode(node, true);
    updateSelectedDirectory(node, false);
    if (!node.archiveId) {
      history.replaceState(routeState(node.source), "", routeForSource(node.source));
    }

    if (!activePath || (!imageWasOpen && !fileWasOpen)) return;
    const refreshedEntry = node.entries.find(
      (entry) => entryPathForCopy(entry) === activePath,
    );
    if (!refreshedEntry) {
      closeViewer(false);
      closeFileViewer(true);
      showToast("文件已不存在");
      return;
    }
    state.currentTreeFileId = refreshedEntry.id;
    if (imageWasOpen && refreshedEntry.type === "image") {
      state.currentIndex = state.images.findIndex(
        (entry) => entry.id === refreshedEntry.id,
      );
      await openViewer();
    } else if (fileWasOpen && refreshedEntry.type !== "image") {
      await openFileViewer(refreshedEntry);
    }
  } catch (error) {
    showToast(`刷新失败：${error.message}`);
  } finally {
    elements.galleryLoading.classList.add("hidden");
  }
}

function formattedFileKind(entry) {
  const name = (entry.relativePath || entry.name || "").toLocaleLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".json")) return "json";
  const extension = name.includes(".") ? name.split(".").at(-1) : "";
  if (["html", "htm"].includes(extension)) return "html";
  if (["pdf", "mp3", "wav", "m4a", "aac", "flac"].includes(extension)) {
    return "browser";
  }
  if (["mp4", "webm", "mov", "m4v", "ogv", "ogg"].includes(extension)) {
    return "video";
  }
  if (["docx", "xlsx", "pptx"].includes(extension)) return extension;
  if (["doc", "xls", "ppt"].includes(extension)) return "office-legacy";
  if ([
    "txt", "text", "log", "xml", "css", "scss", "less",
    "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "java", "c", "h",
    "cpp", "cc", "cxx", "hpp", "go", "rs", "rb", "php", "swift", "kt",
    "kts", "sh", "bash", "zsh", "fish", "ps1", "sql", "yaml", "yml",
    "toml", "ini", "conf", "cfg", "properties", "vue", "svelte", "csv",
    "cs", "fs", "fsx", "vb", "scala", "groovy", "gradle", "lua", "r",
    "dart", "ex", "exs", "erl", "hrl", "clj", "cljs", "proto", "graphql",
    "gql", "tex", "rst", "adoc", "lock", "diff", "patch", "bat", "cmd",
    "cmake", "editorconfig", "gitignore", "gitattributes",
  ].includes(extension)) return "code";
  if (["dockerfile", "makefile", "cmakelists.txt", ".env"].includes(name)) {
    return "code";
  }
  return "generic";
}

function codeLanguage(entry) {
  const name = (entry.relativePath || entry.name || "").toLocaleLowerCase();
  const extension = name.includes(".") ? name.split(".").at(-1) : "";
  const languages = {
    txt: "plaintext",
    text: "plaintext",
    log: "plaintext",
    html: "xml",
    htm: "xml",
    xml: "xml",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    rs: "rust",
    rb: "ruby",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    ps1: "powershell",
    yml: "yaml",
    conf: "ini",
    cfg: "ini",
    properties: "ini",
    vue: "xml",
    svelte: "xml",
    csv: "plaintext",
  };
  return languages[extension] || extension || "plaintext";
}

function formattedFileLabel(kind, entry) {
  if (kind === "markdown") return "MARKDOWN";
  if (kind === "json") return "JSON";
  if (kind === "html") return "HTML";
  if (kind === "generic") return "FILE";
  if (kind === "browser") return "";
  if (kind === "code") return codeLanguage(entry).toLocaleUpperCase();
  if (kind === "office-legacy") return "OFFICE";
  return kind.toLocaleUpperCase();
}

function loadMarkdownEnhanced() {
  if (globalThis.MarkdownEnhanced) return Promise.resolve();
  if (loadMarkdownEnhanced.promise) return loadMarkdownEnhanced.promise;
  loadMarkdownEnhanced.promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/markdown-enhanced.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Markdown Enhanced 渲染器没有加载"));
    document.head.append(script);
  });
  return loadMarkdownEnhanced.promise;
}

function markdownRenderer() {
  if (markdownRenderer.instance) return markdownRenderer.instance;
  if (!globalThis.markdownit) throw new Error("Markdown 渲染器没有加载");
  const renderer = globalThis.markdownit({
    html: false,
    linkify: true,
    typographer: false,
  });
  if (globalThis.MarkdownEnhanced) {
    renderer.use(MarkdownEnhanced.texmath, {
      engine: MarkdownEnhanced.katex,
      delimiters: "dollars",
      katexOptions: {
        throwOnError: false,
        strict: false,
        trust: false,
      },
    });
  }
  const defaultFence = renderer.renderer.rules.fence;
  renderer.renderer.rules.fence = (tokens, index, options, environment, self) => {
    const language = tokens[index].info.trim().split(/\s+/)[0].toLocaleLowerCase();
    if (language === "mermaid" && globalThis.MarkdownEnhanced?.mermaid) {
      return `<div class="mermaid-diagram">${escapeHtml(tokens[index].content)}</div>`;
    }
    return defaultFence(tokens, index, options, environment, self);
  };
  const defaultLinkOpen = renderer.renderer.rules.link_open ||
    ((tokens, index, options, environment, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, index, options, environment, self);
  };
  markdownRenderer.instance = renderer;
  return renderer;
}

async function renderMarkdown(content, documentEntry) {
  await loadMarkdownEnhanced();
  elements.markdownPreview.innerHTML = markdownRenderer().render(content);
  resolveMarkdownImages(documentEntry);
  const mermaid = globalThis.MarkdownEnhanced?.mermaid;
  const diagrams = [...elements.markdownPreview.querySelectorAll(".mermaid-diagram")];
  if (!mermaid || !diagrams.length) return;
  if (!renderMarkdown.mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      suppressErrorRendering: true,
      fontFamily:
        '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      themeVariables: {
        darkMode: true,
        background: "#0b0f15",
        primaryColor: "#1b2435",
        primaryTextColor: "#e7edf8",
        primaryBorderColor: "#7892e8",
        secondaryColor: "#153b3a",
        secondaryTextColor: "#d9fff7",
        secondaryBorderColor: "#49cdb5",
        tertiaryColor: "#2b2138",
        tertiaryTextColor: "#f0e8ff",
        tertiaryBorderColor: "#a786d8",
        mainBkg: "#1b2435",
        secondBkg: "#153b3a",
        nodeBorder: "#7892e8",
        clusterBkg: "#111722",
        clusterBorder: "#3b465a",
        lineColor: "#8fa7ee",
        textColor: "#dce4f2",
        titleColor: "#f2f5fb",
        edgeLabelBackground: "#111722",
        nodeTextColor: "#e7edf8",
        noteBkgColor: "#2d2a1d",
        noteTextColor: "#fff1b8",
        noteBorderColor: "#a58d45",
        actorBkg: "#1b2435",
        actorBorder: "#7892e8",
        actorTextColor: "#e7edf8",
        actorLineColor: "#59677e",
        signalColor: "#8fa7ee",
        signalTextColor: "#dce4f2",
        labelBoxBkgColor: "#151c29",
        labelBoxBorderColor: "#52617a",
        labelTextColor: "#e7edf8",
        loopTextColor: "#dce4f2",
        activationBorderColor: "#49cdb5",
        activationBkgColor: "#153b3a",
        sequenceNumberColor: "#0b0f15",
      },
      flowchart: {
        htmlLabels: false,
        curve: "basis",
        nodeSpacing: 42,
        rankSpacing: 52,
        padding: 18,
      },
      sequence: {
        diagramMarginX: 32,
        diagramMarginY: 24,
        actorMargin: 60,
        messageMargin: 34,
      },
    });
    renderMarkdown.mermaidInitialized = true;
  }
  for (const [index, diagram] of diagrams.entries()) {
    const source = diagram.textContent;
    try {
      const id = `markdown-mermaid-${Date.now()}-${index}-${Math.random()
        .toString(36)
        .slice(2)}`;
      const result = await mermaid.render(id, source);
      diagram.innerHTML = result.svg;
      result.bindFunctions?.(diagram);
    } catch (error) {
      diagram.classList.add("mermaid-error");
      diagram.textContent = `流程图渲染失败：${error.message}`;
    }
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function highlightedJson(value) {
  const json = JSON.stringify(JSON.parse(value), null, 2);
  const tokenPattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b)/g;
  let result = "";
  let offset = 0;
  for (const match of json.matchAll(tokenPattern)) {
    result += escapeHtml(json.slice(offset, match.index));
    const token = match[0];
    let type = "number";
    if (/^"/.test(token)) type = token.trimEnd().endsWith(":") ? "key" : "string";
    else if (token === "true" || token === "false") type = "boolean";
    else if (token === "null") type = "null";
    result += `<span class="json-${type}">${escapeHtml(token)}</span>`;
    offset = match.index + token.length;
  }
  return result + escapeHtml(json.slice(offset));
}

function setSanitizedHtml(container, html) {
  const documentValue = new DOMParser().parseFromString(html, "text/html");
  documentValue.querySelectorAll("script, style, iframe, object, embed, form").forEach(
    (element) => element.remove(),
  );
  documentValue.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        name === "style" ||
        (["href", "src"].includes(name) && /^(?:javascript|file):/i.test(value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === "A") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  });
  container.innerHTML = documentValue.body.innerHTML;
}

function parseXml(value) {
  const documentValue = new DOMParser().parseFromString(value, "application/xml");
  if (documentValue.querySelector("parsererror")) throw new Error("Office 文件中的 XML 无法解析");
  return documentValue;
}

function excelColumnIndex(reference) {
  const letters = (reference.match(/^[A-Z]+/i)?.[0] || "").toLocaleUpperCase();
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

async function renderXlsxPreview(arrayBuffer) {
  if (!globalThis.JSZip) throw new Error("XLSX 渲染器没有加载");
  const zip = await JSZip.loadAsync(arrayBuffer);
  const workbookFile = zip.file("xl/workbook.xml");
  const relationsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationsFile) throw new Error("不是有效的 XLSX 文件");

  const [workbookXml, relationsXml, sharedXml] = await Promise.all([
    workbookFile.async("string"),
    relationsFile.async("string"),
    zip.file("xl/sharedStrings.xml")?.async("string") || "",
  ]);
  const relationships = new Map();
  for (const relation of parseXml(relationsXml).getElementsByTagName("Relationship")) {
    relationships.set(relation.getAttribute("Id"), relation.getAttribute("Target"));
  }
  const sharedStrings = sharedXml
    ? [...parseXml(sharedXml).getElementsByTagName("si")].map((item) => item.textContent || "")
    : [];
  const sheets = [];
  for (const sheet of parseXml(workbookXml).getElementsByTagName("sheet")) {
    const relationId = sheet.getAttribute("r:id");
    const target = relationships.get(relationId);
    if (!target) continue;
    const normalized = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.?\//, "")}`;
    const sheetFile = zip.file(normalized);
    if (!sheetFile) continue;
    const sheetXml = parseXml(await sheetFile.async("string"));
    const rows = [];
    let maximumColumn = 0;
    for (const rowElement of [...sheetXml.getElementsByTagName("row")].slice(0, 2000)) {
      const row = [];
      for (const cell of [...rowElement.getElementsByTagName("c")].slice(0, 200)) {
        const column = excelColumnIndex(cell.getAttribute("r") || "");
        const type = cell.getAttribute("t");
        const raw = cell.getElementsByTagName("v")[0]?.textContent || "";
        let value = raw;
        if (type === "s") value = sharedStrings[Number(raw)] ?? raw;
        else if (type === "inlineStr") value = cell.getElementsByTagName("is")[0]?.textContent || "";
        else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
        row[column] = value;
        maximumColumn = Math.max(maximumColumn, column);
      }
      rows.push(row);
    }
    sheets.push({
      name: sheet.getAttribute("name") || `Sheet ${sheets.length + 1}`,
      rows,
      maximumColumn,
    });
  }
  if (!sheets.length) throw new Error("XLSX 中没有可显示的工作表");

  elements.officePreview.replaceChildren();
  const tabs = document.createElement("div");
  tabs.className = "office-sheet-tabs";
  const viewport = document.createElement("div");
  viewport.className = "office-sheet-viewport";
  const showSheet = (selected, selectedButton) => {
    tabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button === selectedButton);
    });
    const table = document.createElement("table");
    table.className = "office-sheet-table";
    const body = document.createElement("tbody");
    selected.rows.forEach((row, rowIndex) => {
      const tableRow = document.createElement("tr");
      const rowNumber = document.createElement("th");
      rowNumber.textContent = String(rowIndex + 1);
      tableRow.append(rowNumber);
      for (let column = 0; column <= selected.maximumColumn; column += 1) {
        const cell = document.createElement("td");
        cell.textContent = row[column] ?? "";
        tableRow.append(cell);
      }
      body.append(tableRow);
    });
    table.append(body);
    viewport.replaceChildren(table);
  };
  sheets.forEach((sheet, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = sheet.name;
    button.addEventListener("click", () => showSheet(sheet, button));
    tabs.append(button);
    if (index === 0) queueMicrotask(() => showSheet(sheet, button));
  });
  elements.officePreview.append(tabs, viewport);
}

async function renderPptxPreview(arrayBuffer) {
  if (!globalThis.JSZip) throw new Error("PPTX 渲染器没有加载");
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const aNumber = Number(a.match(/slide(\d+)/)?.[1]);
      const bNumber = Number(b.match(/slide(\d+)/)?.[1]);
      return aNumber - bNumber;
    });
  if (!slideFiles.length) throw new Error("PPTX 中没有可显示的幻灯片");
  elements.officePreview.replaceChildren();
  const notice = document.createElement("div");
  notice.className = "office-preview-notice";
  notice.textContent = "PPTX 以幻灯片文字内容模式显示；原始排版请使用“在新标签页打开”下载查看。";
  const slides = document.createElement("div");
  slides.className = "office-slides";
  for (const [index, fileName] of slideFiles.entries()) {
    const xml = parseXml(await zip.file(fileName).async("string"));
    const texts = [...xml.getElementsByTagName("a:t")]
      .map((item) => item.textContent?.trim())
      .filter(Boolean);
    const slide = document.createElement("section");
    slide.className = "office-slide";
    const number = document.createElement("span");
    number.className = "office-slide-number";
    number.textContent = String(index + 1);
    const content = document.createElement("div");
    if (texts.length) {
      texts.forEach((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        content.append(paragraph);
      });
    } else {
      content.textContent = "（此页没有可提取的文字）";
    }
    slide.append(number, content);
    slides.append(slide);
  }
  elements.officePreview.append(notice, slides);
}

async function renderOfficePreview(kind, arrayBuffer) {
  elements.officePreview.replaceChildren();
  if (kind === "docx") {
    if (!globalThis.mammoth) throw new Error("DOCX 渲染器没有加载");
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const article = document.createElement("article");
    article.className = "office-document";
    setSanitizedHtml(article, result.value);
    elements.officePreview.append(article);
    return;
  }
  if (kind === "xlsx") {
    await renderXlsxPreview(arrayBuffer);
    return;
  }
  if (kind === "pptx") {
    await renderPptxPreview(arrayBuffer);
  }
}

async function setHtmlViewMode(mode) {
  const rendered = mode === "rendered";
  state.htmlViewMode = rendered ? "rendered" : "source";
  elements.htmlSourceButton.classList.toggle("active", !rendered);
  elements.htmlRenderedButton.classList.toggle("active", rendered);
  elements.htmlSourceButton.setAttribute("aria-pressed", String(!rendered));
  elements.htmlRenderedButton.setAttribute("aria-pressed", String(rendered));
  elements.formattedFilePreview.classList.toggle("hidden", rendered);
  elements.fileFrame.classList.toggle("hidden", !rendered);

  const entry = state.currentFileEntry;
  if (!rendered || !entry) return;
  if (elements.fileFrame.dataset.renderEntry === entry.id) return;

  try {
    const response = await fetch(apiUrl("/api/html-render-session", { id: entry.id }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.url) {
      throw new Error(result.error || `HTML 页面准备失败 (${response.status})`);
    }
    if (state.currentFileEntry?.id !== entry.id || state.htmlViewMode !== "rendered") {
      return;
    }
    elements.fileFrame.setAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-modals allow-popups allow-downloads",
    );
    elements.fileFrame.dataset.renderEntry = entry.id;
    elements.fileFrame.src = new URL(result.url, SERVER).toString();
  } catch (error) {
    if (state.currentFileEntry?.id !== entry.id) return;
    state.htmlViewMode = "source";
    elements.htmlSourceButton.classList.add("active");
    elements.htmlRenderedButton.classList.remove("active");
    elements.formattedFilePreview.classList.remove("hidden");
    elements.fileFrame.classList.add("hidden");
    showToast(error.message);
  }
}

function renderCodeContent(entry, content, language = "plaintext", notice = "") {
  const code = elements.codePreview.querySelector("code");
  const lineCount = content.split(/\r\n|\r|\n/).length;
  elements.codeLineNumbers.textContent = Array.from(
    { length: lineCount },
    (_, index) => index + 1,
  ).join("\n");
  code.className = `hljs language-${language}`;
  const contentBytes = new TextEncoder().encode(content).byteLength;
  if (contentBytes > 2 * 1024 * 1024 || !globalThis.CodeHighlighter) {
    code.textContent = content;
    if (!notice && contentBytes > 2 * 1024 * 1024) {
      notice = "文件超过 2 MB，已关闭语法分析以保持浏览流畅。";
    }
  } else {
    const highlighted = CodeHighlighter.highlight(content, language);
    code.className = `hljs language-${highlighted.language}`;
    code.innerHTML = highlighted.html;
  }
  if (notice) {
    elements.formattedFileError.textContent = notice;
    elements.formattedFileError.classList.remove("hidden");
  }
  elements.codePreview.classList.remove("hidden");
}

function decodeGenericText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    const encoding = bytes[0] === 0xff ? "utf-16le" : "utf-16be";
    return new TextDecoder(encoding).decode(bytes);
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 64 * 1024));
  let controlCharacters = 0;
  for (const byte of sample) {
    if (byte === 0) return null;
    if (byte < 9 || (byte > 13 && byte < 32)) controlCharacters += 1;
  }
  if (sample.length && controlCharacters / sample.length > 0.03) return null;
  return new TextDecoder("utf-8").decode(bytes);
}

function showUnsupportedBinary(entry) {
  const notice = document.createElement("div");
  notice.className = "office-legacy-notice";
  const title = document.createElement("strong");
  title.textContent = "无法在编辑器中显示此二进制文件";
  const detail = document.createElement("span");
  detail.textContent =
    `${entry.name || "该文件"} 不是可直接显示的文本格式。` +
    "文件不会自动下载，如需保存请点击右上角“下载文件”。";
  notice.append(title, detail);
  elements.officePreview.replaceChildren(notice);
  elements.officePreview.classList.remove("hidden");
}

async function openFileViewer(entry) {
  state.currentFileEntry = entry;
  state.currentTreeFileId = entry.id;
  if (state.directoryRoot) renderDirectoryTree();
  state.filePreviewController?.abort();
  const controller = new AbortController();
  state.filePreviewController = controller;
  const url = apiUrl("/api/file", { id: entry.id });
  const kind = formattedFileKind(entry);
  const directFile = state.targetType === "file";
  elements.closeFileButton.textContent = directFile ? "← 返回主页" : "← 返回目录";
  elements.fileHomeButton.classList.toggle("hidden", directFile);
  elements.fileView.classList.toggle("with-directory", !directFile);
  elements.fileViewName.textContent = entry.relativePath || entry.name;
  elements.downloadFileButton.href = apiUrl("/api/file", {
    id: entry.id,
    download: "1",
  });
  elements.downloadFileButton.download = entry.name || "download";
  const formatLabel = formattedFileLabel(kind, entry);
  elements.fileFormatBadge.textContent = formatLabel;
  elements.fileFormatBadge.classList.toggle("hidden", !formatLabel);
  elements.markdownLayoutControls.classList.toggle("hidden", kind !== "markdown");
  elements.htmlViewControls.classList.toggle("hidden", kind !== "html");
  if (kind === "markdown") setMarkdownLayout(state.markdownDefaultLayout);
  elements.homeView.classList.add("hidden");
  elements.galleryView.classList.toggle("hidden", directFile);
  elements.viewerView.classList.add("hidden");
  elements.fileView.classList.remove("hidden");

  const browserPreview = kind === "browser";
  elements.fileFrame.classList.toggle("hidden", !browserPreview);
  elements.formattedFilePreview.classList.toggle("hidden", browserPreview);
  elements.formattedFilePreview.classList.toggle("video-mode", kind === "video");
  elements.markdownPreview.classList.add("hidden");
  elements.jsonPreview.classList.add("hidden");
  elements.codePreview.classList.add("hidden");
  elements.officePreview.classList.add("hidden");
  elements.videoPreview.classList.add("hidden");
  elements.videoPlayer.pause();
  elements.videoPlayer.removeAttribute("src");
  elements.videoPlayer.load();
  elements.formattedFileError.classList.add("hidden");

  if (browserPreview) {
    elements.fileFrame.removeAttribute("sandbox");
    delete elements.fileFrame.dataset.renderEntry;
    elements.fileFrame.src = url;
    return;
  }

  elements.fileFrame.src = "about:blank";
  delete elements.fileFrame.dataset.renderEntry;
  if (kind === "html") await setHtmlViewMode("rendered");
  if (kind === "video") {
    elements.videoPlayer.autoplay = false;
    elements.videoPlayer.src = url;
    elements.videoPreview.classList.remove("hidden");
    elements.formattedFileLoading.classList.add("hidden");
    return;
  }
  if (kind === "office-legacy") {
    const notice = document.createElement("div");
    notice.className = "office-legacy-notice";
    notice.innerHTML =
      "<strong>旧版 Office 格式暂不支持页面内解析</strong>" +
      "<span>请使用右上角“下载文件”保存原文件；DOCX、XLSX、PPTX 可直接预览。</span>";
    elements.officePreview.replaceChildren(notice);
    elements.officePreview.classList.remove("hidden");
    elements.formattedFileLoading.classList.add("hidden");
    return;
  }
  elements.formattedFileLoading.classList.remove("hidden");
  try {
    const genericPreview = kind === "generic";
    const response = await fetch(url, {
      signal: controller.signal,
      ...(genericPreview
        ? { headers: { Range: "bytes=0-4194303" } }
        : {}),
    });
    if (!response.ok) throw new Error(`文件读取失败 (${response.status})`);
    const isOffice = ["docx", "xlsx", "pptx"].includes(kind);
    const content = isOffice || genericPreview
      ? await response.arrayBuffer()
      : await response.text();
    if (controller.signal.aborted) return;

    if (kind === "markdown") {
      await renderMarkdown(content, entry);
      if (controller.signal.aborted) return;
      elements.markdownPreview.classList.remove("hidden");
    } else if (kind === "json") {
      try {
        elements.jsonPreview.querySelector("code").innerHTML = highlightedJson(content);
      } catch (error) {
        elements.jsonPreview.querySelector("code").textContent = content;
        elements.formattedFileError.textContent = `JSON 格式有误，已按原文显示：${error.message}`;
        elements.formattedFileError.classList.remove("hidden");
      }
      elements.jsonPreview.classList.remove("hidden");
    } else if (kind === "code" || kind === "html") {
      const language = kind === "html" ? "xml" : codeLanguage(entry);
      renderCodeContent(entry, content, language);
    } else if (genericPreview) {
      const text = decodeGenericText(content);
      if (text === null) {
        showUnsupportedBinary(entry);
      } else {
        const rangeMatch = response.headers
          .get("Content-Range")
          ?.match(/bytes\s+\d+-(\d+)\/(\d+)/i);
        const truncated = rangeMatch && Number(rangeMatch[1]) + 1 < Number(rangeMatch[2]);
        renderCodeContent(
          entry,
          text,
          "plaintext",
          truncated ? "文件较大，仅显示前 4 MB；可使用右上角下载完整文件。" : "",
        );
      }
    } else if (isOffice) {
      await renderOfficePreview(kind, content);
      elements.officePreview.classList.remove("hidden");
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.formattedFileError.textContent = error.message;
    elements.formattedFileError.classList.remove("hidden");
  } finally {
    if (state.filePreviewController === controller) {
      elements.formattedFileLoading.classList.add("hidden");
    }
  }
}

function closeFileViewer(showDirectory = true) {
  if (elements.fileView.classList.contains("hidden")) return;
  state.filePreviewController?.abort();
  state.filePreviewController = null;
  state.currentFileEntry = null;
  elements.fileFrame.src = "about:blank";
  delete elements.fileFrame.dataset.renderEntry;
  elements.markdownPreview.replaceChildren();
  elements.jsonPreview.querySelector("code").replaceChildren();
  elements.codePreview.querySelector("code").replaceChildren();
  elements.codeLineNumbers.replaceChildren();
  elements.officePreview.replaceChildren();
  elements.videoPlayer.pause();
  elements.videoPlayer.removeAttribute("src");
  elements.videoPlayer.load();
  elements.fileView.classList.add("hidden");
  if (showDirectory) {
    if (state.targetType === "file") showHome();
    else showGallery();
  }
}

function createViewer() {
  if (state.viewer) return state.viewer;
  state.viewer = OpenSeadragon({
    id: "viewer",
    prefixUrl: "/vendor/images/",
    showNavigationControl: false,
    showNavigator: true,
    navigatorPosition: "BOTTOM_RIGHT",
    navigatorSizeRatio: 0.16,
    animationTime: 0.55,
    blendTime: 0.08,
    maxZoomPixelRatio: 8,
    minZoomImageRatio: 0.8,
    visibilityRatio: 0.05,
    constrainDuringPan: false,
    preserveViewport: false,
    crossOriginPolicy: "Anonymous",
    gestureSettingsMouse: {
      clickToZoom: false,
      dblClickToZoom: true,
      scrollToZoom: true,
    },
  });
  state.viewer.addHandler("open", () => {
    elements.viewerLoading.classList.add("hidden");
  });
  return state.viewer;
}

function browserMaxImageDimension() {
  if (browserMaxImageDimension.cached) return browserMaxImageDimension.cached;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  const detected = gl?.getParameter(gl.MAX_TEXTURE_SIZE) || 8192;
  browserMaxImageDimension.cached = Math.max(2048, Math.min(16384, detected));
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return browserMaxImageDimension.cached;
}

async function openViewer(recoveryAttempt = 0) {
  const image = state.images[state.currentIndex];
  if (!image) return;
  const requestId = ++state.viewerRequestId;
  state.viewerImageUrl = "";
  state.currentTreeFileId = image.id;
  if (state.directoryRoot) renderDirectoryTree();
  const directFile = state.targetType === "file";

  elements.viewerView.classList.remove("hidden");
  elements.viewerView.classList.toggle("with-directory", !directFile);
  if (directFile) elements.galleryView.classList.add("hidden");
  elements.closeViewerButton.textContent = directFile
    ? "← 返回主页"
    : "← 返回文件列表";
  elements.viewerHomeButton.classList.toggle("hidden", directFile);
  elements.previousButton.classList.toggle("hidden", state.images.length <= 1);
  elements.nextButton.classList.toggle("hidden", state.images.length <= 1);
  elements.viewerLoading.classList.remove("hidden");
  elements.viewerLoadingText.textContent = "正在打开图片…";
  elements.viewerNotice.textContent = "正在后台准备清晰浏览图…";
  elements.viewerNotice.classList.toggle(
    "hidden",
    !state.readyThumbnails.has(image.id),
  );
  elements.viewerError.classList.add("hidden");
  elements.viewerName.textContent = image.relativePath;
  elements.downloadOriginalButton.href = apiUrl("/api/file", {
    id: image.id,
    download: "1",
  });
  elements.downloadOriginalButton.download = image.name || "original-image";
  elements.viewerMeta.textContent =
    `${state.currentIndex + 1} / ${state.images.length} · ${formatBytes(image.size)}`;

  const viewer = createViewer();
  if (state.readyThumbnails.has(image.id)) {
    viewer.open({
      type: "image",
      url: apiUrl("/api/thumbnail", { id: image.id }),
      buildPyramid: false,
    });
  }

  try {
    const prepared = await api("/api/browser-image-info", {
      id: image.id,
      maxDimension: String(browserMaxImageDimension()),
    }, 0, 4, (attempt) => {
      if (requestId !== state.viewerRequestId) return;
      elements.viewerLoading.classList.remove("hidden");
      elements.viewerLoadingText.textContent =
        `连接中断，正在自动重连（${attempt}/4）…`;
      elements.viewerNotice.textContent = "缩略图仍可浏览，连接恢复后会自动加载清晰图片。";
      elements.viewerNotice.classList.remove("hidden");
    });
    if (
      requestId !== state.viewerRequestId ||
      elements.viewerView.classList.contains("hidden")
    ) return;
    const imageUrl = prepared.resized
      ? apiUrl(`/api/browser-image/${prepared.key}.${prepared.format}`)
      : apiUrl("/api/file", { id: image.id });
    state.viewerImageUrl = imageUrl;
    const dimensions = prepared.resized
      ? `${prepared.originalWidth} × ${prepared.originalHeight} → ` +
        `${prepared.width} × ${prepared.height}`
      : `${prepared.width} × ${prepared.height}`;
    elements.viewerMeta.textContent =
      `${state.currentIndex + 1} / ${state.images.length} · ` +
      `${dimensions} · ${formatBytes(image.size)}`;
    const preparedNotice = prepared.resized
      ? (
        `原图超过浏览器上限，已按比例缩放：` +
        `${prepared.originalWidth}×${prepared.originalHeight} → ` +
        `${prepared.width}×${prepared.height}`
      )
      : "";
    elements.viewerLoadingText.textContent = "正在加载清晰图片…";
    const removePreparedHandlers = () => {
      viewer.removeHandler("open", handlePreparedOpen);
      viewer.removeHandler("open-failed", handlePreparedFailure);
    };
    const handlePreparedOpen = () => {
      removePreparedHandlers();
      if (requestId !== state.viewerRequestId) return;
      elements.viewerLoading.classList.add("hidden");
      elements.viewerNotice.textContent = preparedNotice;
      elements.viewerNotice.classList.toggle("hidden", !preparedNotice);
    };
    const handlePreparedFailure = async (event) => {
      removePreparedHandlers();
      if (requestId !== state.viewerRequestId) return;
      if (recoveryAttempt < 3 && IS_EXTENSION) {
        elements.viewerLoading.classList.remove("hidden");
        elements.viewerLoadingText.textContent =
          `清晰图片连接中断，正在恢复（${recoveryAttempt + 1}/3）…`;
        if (await connectServer(true)) {
          await delay(300 * (recoveryAttempt + 1));
          if (requestId === state.viewerRequestId) {
            openViewer(recoveryAttempt + 1);
          }
          return;
        }
      }
      elements.viewerLoading.classList.add("hidden");
      elements.viewerError.textContent =
        `清晰图片加载失败：${event?.message || "连接无法恢复"}`;
      elements.viewerError.classList.remove("hidden");
    };
    viewer.addHandler("open", handlePreparedOpen);
    viewer.addHandler("open-failed", handlePreparedFailure);
    viewer.open({
      type: "image",
      url: imageUrl,
      buildPyramid: false,
    });
  } catch (error) {
    if (requestId !== state.viewerRequestId) return;
    elements.viewerLoading.classList.add("hidden");
    elements.viewerError.textContent = state.readyThumbnails.has(image.id)
      ? `清晰图片加载失败，当前显示缩略图：${error.message}`
      : error.message;
    elements.viewerError.classList.remove("hidden");
  }
}

function closeViewer(updateRoute = true) {
  if (elements.viewerView.classList.contains("hidden")) return;
  state.viewerRequestId += 1;
  state.viewerImageUrl = "";
  state.viewer?.close();
  elements.viewerView.classList.add("hidden");
  if (updateRoute && state.targetType === "file") {
    showHome();
    return;
  }
  if (updateRoute && !elements.galleryView.classList.contains("hidden")) {
    history.replaceState(history.state, "", routeForSource(state.source));
  }
}

function moveImage(direction) {
  if (!state.images.length) return;
  state.currentIndex =
    (state.currentIndex + direction + state.images.length) % state.images.length;
  state.viewer?.close();
  openViewer();
}

function setSourceMode(mode) {
  if (state.sourceMode === "local" || state.sourceMode === "ssh") {
    state.sourceInputs[state.sourceMode] = elements.sourceInput.value;
  }
  state.sourceMode = mode;
  document.querySelectorAll(".source-type").forEach((item) => {
    item.classList.toggle("active", item.dataset.type === mode);
  });
  elements.s3ConfigFields.classList.toggle("hidden", mode !== "s3");
  elements.pathInputFields.classList.toggle("hidden", mode === "s3");
  elements.formError.textContent = "";
  const examples = {
    local: "/Users/me/data",
    ssh: "user@host:~",
  };
  if (examples[mode]) {
    elements.sourceInput.placeholder = examples[mode];
    elements.sourceInput.value = state.sourceInputs[mode] ||
      (mode === "local" ? state.homeDirectory : "");
  }
  if (mode === "s3") loadS3Nodes();
}

elements.pathJumpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const visibleSource = elements.sourcePath.value.trim();
  let source = visibleSource === elements.sourcePath.dataset.displaySource
    ? elements.sourcePath.dataset.resolvedSource || visibleSource
    : visibleSource;
  source = normalizeObjectStorageSource(source);
  if (
    normalizeObjectStorageSource(visibleSource) === source &&
    source.startsWith("s3://") &&
    elements.sourcePath.dataset.resolvedSource?.startsWith("s3://")
  ) {
    try {
      const next = new URL(source);
      const current = new URL(elements.sourcePath.dataset.resolvedSource);
      for (const name of ["profile", "connection"]) {
        if (!next.searchParams.has(name) && current.searchParams.has(name)) {
          next.searchParams.set(name, current.searchParams.get(name));
        }
      }
      source = next.toString();
    } catch {
      // openSource will report malformed paths.
    }
  }
  if (!source) {
    elements.sourcePath.focus();
    return;
  }
  await openSource(source, false, { anchorFileInParent: true });
});

elements.sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const source = await sourceFromForm();
    await openSource(source);
  } catch (error) {
    elements.formError.textContent = error.message;
  }
});
elements.saveSourceButton.addEventListener("click", saveInputAsFavorite);
document.querySelectorAll(".source-type").forEach((button) => {
  button.addEventListener("click", () => {
    setSourceMode(button.dataset.type);
    if (button.dataset.type !== "s3") elements.sourceInput.focus();
  });
});
elements.s3SavedConfig.addEventListener("change", () => {
  const config = state.s3Configs.find((item) => item.id === elements.s3SavedConfig.value);
  fillS3Config(config);
});
elements.s3ManualCredentials.addEventListener("change", () => {
  elements.s3ManualConfigFields.classList.toggle(
    "hidden",
    !elements.s3ManualCredentials.checked,
  );
});
elements.editCredentialsButton.addEventListener("click", openCredentialsEditor);
elements.refreshS3NodesButton.addEventListener("click", () => loadS3Nodes(true));
elements.saveS3ConfigButton.addEventListener("click", saveStandaloneS3Config);
elements.saveCredentialsButton.addEventListener("click", saveCredentialsFile);
elements.homeButton.addEventListener("click", showHome);
elements.settingsButton.addEventListener("click", () => {
  if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  else location.href = "/options.html";
});
elements.backButton.addEventListener("click", navigateDirectoryUp);
elements.directoryUpButton.addEventListener("click", navigateDirectoryUp);
elements.refreshButton.addEventListener("click", refreshCurrentDirectory);
elements.downloadDirectoryButton.addEventListener("click", () => {
  downloadDirectoryNode(state.selectedDirectory);
});
elements.favoriteButton.addEventListener("click", toggleFavorite);
elements.searchInput.addEventListener("input", (event) => searchImages(event.target.value));
elements.searchInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  const source = inheritObjectStorageConnection(event.currentTarget.value);
  if (!source.startsWith("s3://")) return;
  event.preventDefault();
  await openSource(source, false, { anchorFileInParent: true });
});
elements.thumbnailSize.addEventListener("input", (event) => {
  applyThumbnailSize(event.target.value);
});
elements.thumbnailSize.addEventListener("change", (event) => {
  saveThumbnailSize(event.target.value);
});
elements.closeFileButton.addEventListener("click", () => closeFileViewer(true));
elements.fileHomeButton.addEventListener("click", showHome);
elements.markdownLayoutWide.addEventListener("click", () => setMarkdownLayout("wide"));
elements.markdownLayoutReading.addEventListener(
  "click",
  () => setMarkdownLayout("reading"),
);
elements.htmlSourceButton.addEventListener("click", () => setHtmlViewMode("source"));
elements.htmlRenderedButton.addEventListener(
  "click",
  () => setHtmlViewMode("rendered"),
);
elements.viewerCanvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  copyImageToClipboard(
    state.images[state.currentIndex],
    state.viewerImageUrl,
  );
});
elements.closeViewerButton.addEventListener("click", closeViewer);
elements.viewerHomeButton.addEventListener("click", showHome);
elements.previousButton.addEventListener("click", () => moveImage(-1));
elements.nextButton.addEventListener("click", () => moveImage(1));
elements.fitButton.addEventListener("click", () => state.viewer?.viewport.goHome());
elements.actualButton.addEventListener("click", () => {
  const zoom = state.viewer?.viewport.imageToViewportZoom(1);
  if (zoom) state.viewer.viewport.zoomTo(zoom);
});

document.addEventListener("keydown", (event) => {
  if (elements.viewerView.classList.contains("hidden")) return;
  if (event.key === "Escape") closeViewer();
  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") moveImage(-1);
  if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") moveImage(1);
  if (event.key === "0") state.viewer?.viewport.goHome();
  if (event.key === "1") elements.actualButton.click();
});

window.addEventListener("popstate", () => {
  closeViewer(false);
  const routedSource = sourceFromRoute();
  if (!routedSource) {
    elements.homeView.classList.remove("hidden");
    elements.galleryView.classList.add("hidden");
    elements.locationBar.classList.add("hidden");
  } else if (routedSource !== state.source) {
    openRoutedSource(routedSource);
  }
});

globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.interfaceStyle) {
    applyInterfaceStyle(changes.interfaceStyle.newValue);
  }
  if (area === "local" && changes.sidebarWidth) {
    applySidebarWidth(changes.sidebarWidth.newValue);
  }
  if (area === "local" && changes.thumbnailSize) {
    applyThumbnailSize(changes.thumbnailSize.newValue);
  }
  if (area === "local" && changes.markdownDefaultLayout) {
    state.markdownDefaultLayout =
      ["reading", "a4"].includes(changes.markdownDefaultLayout.newValue)
        ? "reading"
        : "wide";
  }
});

setupSidebarResizer();

async function init() {
  await Promise.all([loadFavorites(), loadS3Configs(), loadInterfaceStyle()]);
  await connectServer();
  await loadSystemInfo();
  const routedSource = sourceFromRoute();
  if (routedSource) {
    if (routedSource.startsWith("s3://")) setSourceMode("s3");
    await openRoutedSource(routedSource);
  } else {
    elements.sourceInput.focus();
  }
}

init();
