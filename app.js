const IS_EXTENSION = location.protocol === "chrome-extension:";
const KNOWN_BINARY_EXTENSIONS = new Set([
  "pth", "pt", "ckpt", "onnx", "safetensors", "npz", "npy",
  "pkl", "pickle", "joblib", "h5", "hdf5", "parquet", "feather",
  "arrow", "avro", "orc", "mat", "pb", "tflite", "weights", "bin",
  "db", "sqlite", "sqlite3", "mdb", "accdb", "wasm", "class", "pyc",
  "so", "dylib", "dll", "exe", "dmg", "iso",
]);
let SERVER =
  location.protocol === "http:" &&
  ["127.0.0.1", "localhost", "files.localhost"].includes(location.hostname)
    ? location.origin
    : "";
let serverReconnectTimer = null;
let serverReconnectAttempt = 0;

const state = {
  token: "",
  favorites: [],
  s3Configs: [],
  s3Profiles: [],
  s3NodeStates: new Map(),
  activeS3Node: null,
  homeDirectory: "",
  sourceInputs: { local: "", ssh: "" },
  sourceMode: "ssh",
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
  htmlDefaultViewMode: "rendered",
  htmlViewMode: "rendered",
  currentFileEntry: null,
  currentFileText: null,
  currentFileTextTruncated: false,
  currentFileWritable: false,
  currentFileReadOnlyView: false,
  textEditMode: false,
  textSaveMode: "manual",
  textDefaultMode: "edit",
  maxPreviewBytes: 256 * 1024 * 1024,
  maxTextPreviewBytes: 2 * 1024 * 1024,
  textDirty: false,
  textSaving: false,
  textEditVersion: 0,
  textAutoSaveTimer: null,
  viewer: null,
  viewerRequestId: 0,
  viewerImageUrl: "",
  viewerObjectUrl: "",
  viewerFetchController: null,
  readyThumbnails: new Set(),
  thumbnailObserver: null,
  thumbnailQueue: [],
  activeThumbnailLoads: 0,
  thumbnailGeneration: 0,
  viewerLoadingTimer: null,
  videoCacheToken: 0,
  videoCacheTimer: null,
  videoUsingCache: false,
  videoScrubbing: false,
  videoFpsLocked: false,
  videoTiming: null,
  videoTimingResolved: false,
  videoCache: null,
  videoShownFrame: null,
  videoHoldDirection: 0,
  videoStepToken: 0,
  videoFastPlayback: false,
  videoFallbackAttempted: false,
  videoUsingCompatible: false,
  videoRequestedTime: null,
  videoSourceTransition: "",
  videoZoom: 1,
  videoPanX: 0,
  videoPanY: 0,
  filePreviewController: null,
  uploadInProgress: false,
  uploadPickerTarget: null,
  selectedItems: new Map(),
  selectionAnchorId: null,
  directorySelectionMode: false,
  gallerySelectionItems: new Map(),
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
  sourcePath: $("#sourcePath"),
  pathJumpForm: $("#pathJumpForm"),
  favorites: $("#favorites"),
  favoritesEmpty: $("#favoritesEmpty"),
  favoriteCount: $("#favoriteCount"),
  galleryTitle: $("#galleryTitle"),
  imageCount: $("#imageCount"),
  galleryGrid: $("#galleryGrid"),
  marqueeSelection: $("#marqueeSelection"),
  galleryLoading: $("#galleryLoading"),
  galleryEmpty: $("#galleryEmpty"),
  fileWorkspace: $(".file-workspace"),
  directoryTree: $("#directoryTree"),
  directoryEmpty: $("#directoryEmpty"),
  directoryUpButton: $("#directoryUpButton"),
  directoryRefreshButton: $("#directoryRefreshButton"),
  sidebarResizer: $("#sidebarResizer"),
  searchInput: $("#searchInput"),
  thumbnailSize: $("#thumbnailSize"),
  selectionActions: $("#selectionActions"),
  selectionCount: $("#selectionCount"),
  copySelectedPathsButton: $("#copySelectedPathsButton"),
  deleteSelectedButton: $("#deleteSelectedButton"),
  clearSelectionButton: $("#clearSelectionButton"),
  uploadActions: $("#uploadActions"),
  uploadButton: $("#uploadButton"),
  uploadMenu: $("#uploadMenu"),
  uploadFilesButton: $("#uploadFilesButton"),
  uploadDirectoryButton: $("#uploadDirectoryButton"),
  uploadFilesInput: $("#uploadFilesInput"),
  uploadDirectoryInput: $("#uploadDirectoryInput"),
  uploadStatus: $("#uploadStatus"),
  uploadDropOverlay: $("#uploadDropOverlay"),
  treeContextMenu: $("#treeContextMenu"),
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
  textEditControls: $("#textEditControls"),
  editTextButton: $("#editTextButton"),
  textSaveMode: $("#textSaveMode"),
  saveTextButton: $("#saveTextButton"),
  textSaveStatus: $("#textSaveStatus"),
  textEditor: $("#textEditor"),
  textEditorInput: $("#textEditorInput"),
  textEditorLineNumbers: $("#textEditorLineNumbers"),
  formattedFilePreview: $("#formattedFilePreview"),
  formattedFileLoading: $("#formattedFileLoading"),
  formattedFileError: $("#formattedFileError"),
  markdownPreview: $("#markdownPreview"),
  jsonPreview: $("#jsonPreview"),
  codePreview: $("#codePreview"),
  codeLineNumbers: $("#codeLineNumbers"),
  officePreview: $("#officePreview"),
  videoPreview: $("#videoPreview"),
  videoStage: $("#videoStage"),
  videoPlayer: $("#videoPlayer"),
  videoTimeline: $("#videoTimeline"),
  videoPreviousFrame: $("#videoPreviousFrame"),
  videoPlayButton: $("#videoPlayButton"),
  videoNextFrame: $("#videoNextFrame"),
  videoTime: $("#videoTime"),
  videoFrame: $("#videoFrame"),
  videoFps: $("#videoFps"),
  videoCacheStatus: $("#videoCacheStatus"),
  videoZoomIn: $("#videoZoomIn"),
  videoZoomOut: $("#videoZoomOut"),
  videoZoomReset: $("#videoZoomReset"),
  videoFullscreen: $("#videoFullscreen"),
  fileFrame: $("#fileFrame"),
  copyFileTextButton: $("#copyFileTextButton"),
  copyFilePathButton: $("#copyFilePathButton"),
  downloadFileButton: $("#downloadFileButton"),
  closeViewerButton: $("#closeViewerButton"),
  viewerHomeButton: $("#viewerHomeButton"),
  previousButton: $("#previousButton"),
  nextButton: $("#nextButton"),
  fitButton: $("#fitButton"),
  actualButton: $("#actualButton"),
  viewerName: $("#viewerName"),
  viewerMeta: $("#viewerMeta"),
  viewerNotice: $("#viewerNotice"),
  viewerNoticeProgress: $("#viewerNoticeProgress"),
  viewerNoticeProgressText: $("#viewerNoticeProgressText"),
  viewerNoticeText: $("#viewerNoticeText"),
  viewerLoading: $("#viewerLoading"),
  viewerProgress: $("#viewerProgress"),
  viewerProgressText: $("#viewerProgressText"),
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

async function writeClipboardText(text) {
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
}

async function copyPath(value, type) {
  await writeClipboardText(copyPathValue(value));
  showToast(`已复制${type}路径`);
}

function selectionItemForEntry(entry, node) {
  const descriptor = decodeEntryDescriptor(entry.id);
  return {
    id: entry.id,
    name: entry.name || entry.relativePath,
    path: entryPathForCopy(entry),
    entry,
    node,
    directory: false,
    deletable: Boolean(descriptor && !["archive", "s3"].includes(descriptor.kind)),
  };
}

function selectionItemForNode(node) {
  if (!node?.id) return null;
  const descriptor = decodeEntryDescriptor(node.id);
  return {
    id: node.id,
    name: node.name || node.source,
    path: copyPathValue(node.source),
    node,
    directory: true,
    deletable: Boolean(descriptor && !["archive", "s3"].includes(descriptor.kind)),
  };
}

function syncSelectionUI() {
  const count = state.selectedItems.size;
  if (count === 0) state.directorySelectionMode = false;
  elements.directoryTree.classList.toggle(
    "selection-active",
    state.directorySelectionMode && count > 0,
  );
  elements.selectionActions.classList.toggle("hidden", count === 0);
  elements.selectionCount.textContent = `已选择 ${count} 项`;
  elements.downloadDirectoryButton.disabled = count === 0;
  elements.downloadDirectoryButton.title =
    count > 0 ? `下载选中的 ${count} 项` : "请先选择文件或目录";
  const allDeletable =
    count > 0 && [...state.selectedItems.values()].every((item) => item.deletable);
  elements.deleteSelectedButton.classList.toggle("hidden", !allDeletable);
  document.querySelectorAll("[data-selection-id]").forEach((element) => {
    const selected = state.selectedItems.has(element.dataset.selectionId);
    if (element.classList.contains("image-card")) {
      element.classList.toggle("selected", selected);
    } else if (element.classList.contains("directory-row")) {
      element.classList.toggle("multi-selected", selected);
    }
    const checkbox = element.querySelector(".entry-selection-checkbox, .directory-selection-checkbox");
    if (checkbox) checkbox.checked = selected;
  });
}

function clearSelection() {
  state.selectedItems.clear();
  state.selectionAnchorId = null;
  state.directorySelectionMode = false;
  syncSelectionUI();
}

function selectOnlyItem(item) {
  if (!item) return;
  state.selectedItems.clear();
  state.selectedItems.set(item.id, item);
  state.selectionAnchorId = item.id;
  syncSelectionUI();
}

function toggleSelectedItem(item) {
  if (!item) return;
  if (state.selectedItems.has(item.id)) state.selectedItems.delete(item.id);
  else state.selectedItems.set(item.id, item);
  state.selectionAnchorId = item.id;
  syncSelectionUI();
}

function selectItemRange(items, target, additive = false) {
  const anchor = items.findIndex((item) => item.id === state.selectionAnchorId);
  const current = items.findIndex((item) => item.id === target.id);
  if (anchor < 0 || current < 0) {
    selectOnlyItem(target);
    return;
  }
  if (!additive) state.selectedItems.clear();
  const [start, end] = anchor < current ? [anchor, current] : [current, anchor];
  items.slice(start, end + 1).forEach((item) => state.selectedItems.set(item.id, item));
  syncSelectionUI();
}

async function copySelectedPaths() {
  const paths = [...state.selectedItems.values()].map((item) => item.path);
  if (!paths.length) return;
  await writeClipboardText(paths.join("\n"));
  showToast(`已复制 ${paths.length} 个路径`);
}

async function downloadSelectedItems() {
  const items = [...state.selectedItems.values()];
  if (!items.length) {
    showToast("请先选择要下载的文件或目录");
    return;
  }
  if (items.length === 1) {
    const [item] = items;
    if (item.directory) downloadDirectoryNode(item.node);
    else {
      triggerDownload(
        apiUrl("/api/file", { id: item.id, download: "1" }),
        item.name || "download",
      );
    }
    return;
  }
  try {
    elements.downloadDirectoryButton.disabled = true;
    elements.downloadDirectoryButton.textContent = "准备下载…";
    const result = await apiPost("/api/download-selection", {
      ids: items.map((item) => item.id),
    });
    triggerDownload(
      apiUrl("/api/download-selection", { id: result.id }),
    );
  } catch (error) {
    showToast(`下载失败：${error.message}`);
  } finally {
    elements.downloadDirectoryButton.disabled = false;
    elements.downloadDirectoryButton.textContent = "↓ 下载";
  }
}

function selectedItemsCanDelete() {
  return state.selectedItems.size > 0 &&
    [...state.selectedItems.values()].every((item) => item.deletable);
}

function nodeContainsNode(parent, child) {
  for (let current = child; current; current = current.parent) {
    if (current === parent) return true;
  }
  return false;
}

async function deleteSelectedItems() {
  const items = [...state.selectedItems.values()];
  if (!items.length) return;
  if (items.some((item) => !item.deletable)) {
    showToast("S3/OSS 与归档内部内容为只读，不能删除");
    return;
  }
  const names = items.slice(0, 4).map((item) => item.name).join("、");
  const suffix = items.length > 4 ? ` 等 ${items.length} 项` : "";
  if (!confirm(`确定永久删除“${names}${suffix}”吗？此操作无法恢复。`)) return;

  const deletedCurrentNode = items.find(
    (item) => item.directory && nodeContainsNode(item.node, state.selectedDirectory),
  );
  const fallbackNode = deletedCurrentNode?.node?.parent || null;
  elements.deleteSelectedButton.disabled = true;
  elements.deleteSelectedButton.textContent = "删除中…";
  try {
    const result = { deleted: [], failed: [] };
    const ids = items.map((item) => item.id);
    for (let index = 0; index < ids.length; index += 50) {
      const batch = await apiPost("/api/entries/delete", {
        ids: ids.slice(index, index + 50),
      });
      result.deleted.push(...(batch.deleted || []));
      result.failed.push(...(batch.failed || []));
    }
    clearSelection();
    if (fallbackNode) {
      await loadDirectoryNode(fallbackNode, true);
      await selectDirectoryNode(fallbackNode);
    } else if (state.selectedDirectory) {
      await refreshCurrentDirectory();
    }
    if (result.failed?.length) {
      showToast(
        `已删除 ${result.deleted.length} 项，${result.failed.length} 项失败：` +
        result.failed[0].error,
      );
    } else {
      showToast(`已删除 ${result.deleted.length} 项`);
    }
  } catch (error) {
    showToast(`删除失败：${error.message}`);
  } finally {
    elements.deleteSelectedButton.disabled = false;
    elements.deleteSelectedButton.textContent = "删除";
  }
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

function createFileCopyPathButton(entry) {
  const button = document.createElement("button");
  button.className = "entry-copy-path-button";
  button.type = "button";
  button.textContent = "⧉";
  button.title = `复制路径：${entryPathForCopy(entry)}`;
  button.setAttribute("aria-label", `复制 ${entry.name || entry.relativePath} 的路径`);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    copyPath(entryPathForCopy(entry), "文件");
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

function isSshDirectoryNode(node) {
  return Boolean(
    node &&
    !node.syntheticS3Root &&
    !node.archiveId &&
    sourceType(node.source) === "SSH",
  );
}

function showUploadStatus(message, error = false) {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.classList.remove("hidden");
  elements.uploadStatus.classList.toggle("error", error);
}

function uploadItemsFromFileList(files) {
  return [...files].map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

function fileFromEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const readBatch = () => reader.readEntries((batch) => {
      if (!batch.length) {
        resolve(entries);
        return;
      }
      entries.push(...batch);
      readBatch();
    }, reject);
    readBatch();
  });
}

async function walkFileSystemEntry(entry, parent = "") {
  const relativePath = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    return [{ file: await fileFromEntry(entry), relativePath }];
  }
  if (!entry.isDirectory) return [];
  const children = await readDirectoryEntries(entry.createReader());
  const nested = await Promise.all(
    children.map((child) => walkFileSystemEntry(child, relativePath)),
  );
  return nested.flat();
}

async function walkFileSystemHandle(handle, parent = "") {
  const relativePath = parent ? `${parent}/${handle.name}` : handle.name;
  if (handle.kind === "file") {
    return [{ file: await handle.getFile(), relativePath }];
  }
  if (handle.kind !== "directory") return [];
  const nested = [];
  for await (const child of handle.values()) {
    nested.push(...await walkFileSystemHandle(child, relativePath));
  }
  return nested;
}

async function uploadItemsFromDataTransfer(dataTransfer) {
  const items = [...(dataTransfer.items || [])].filter(
    (item) => item.kind === "file",
  );
  const collected = [];
  for (const item of items) {
    if (item.getAsFileSystemHandle) {
      const handle = await item.getAsFileSystemHandle().catch(() => null);
      if (handle) {
        collected.push(...await walkFileSystemHandle(handle));
        continue;
      }
    }
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      collected.push(...await walkFileSystemEntry(entry));
      continue;
    }
    const file = item.getAsFile();
    if (file) collected.push({ file, relativePath: file.name });
  }
  return collected.length ? collected : uploadItemsFromFileList(dataTransfer.files || []);
}

async function putSshUpload(node, item) {
  const upload = async () => {
    const response = await fetch(apiUrl("/api/ssh/upload", {
      source: node.source,
      name: item.relativePath,
    }), {
      method: "PUT",
      headers: {
        "Content-Type": item.file.type || "application/octet-stream",
      },
      body: item.file,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || `上传失败 (${response.status})`);
      error.httpStatus = response.status;
      throw error;
    }
    return result;
  };
  try {
    return await upload();
  } catch (error) {
    if (error.httpStatus || !IS_EXTENSION || !(await connectServer(true))) throw error;
    return upload();
  }
}

async function uploadFilesToSshNode(node, items) {
  if (!isSshDirectoryNode(node)) {
    showToast("请选择 SSH 目录后再上传");
    return;
  }
  const validItems = items.filter((item) => item.file && item.relativePath);
  if (!validItems.length || state.uploadInProgress) return;
  state.uploadInProgress = true;
  elements.uploadButton.disabled = true;
  const errors = [];
  try {
    for (let index = 0; index < validItems.length; index += 1) {
      const item = validItems[index];
      showUploadStatus(
        `正在上传 ${index + 1} / ${validItems.length}：${item.relativePath}`,
      );
      try {
        await putSshUpload(node, item);
      } catch (error) {
        errors.push(`${item.relativePath}：${error.message}`);
      }
    }
    await loadDirectoryNode(node, true);
    node.expanded = true;
    if (state.selectedDirectory === node) updateSelectedDirectory(node, false);
    else renderDirectoryTree();
    if (errors.length) {
      showUploadStatus(
        `已上传 ${validItems.length - errors.length} 个，失败 ${errors.length} 个：` +
        errors.slice(0, 2).join("；"),
        true,
      );
    } else {
      showUploadStatus(`上传完成，共 ${validItems.length} 个文件`);
      setTimeout(() => elements.uploadStatus.classList.add("hidden"), 2600);
    }
  } finally {
    state.uploadInProgress = false;
    elements.uploadButton.disabled = false;
  }
}

function enableSshDropTarget(row, node) {
  if (!isSshDirectoryNode(node)) return;
  row.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    row.classList.add("upload-drop-target");
  });
  row.addEventListener("dragleave", (event) => {
    if (!row.contains(event.relatedTarget)) row.classList.remove("upload-drop-target");
  });
  row.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove("upload-drop-target");
    const items = await uploadItemsFromDataTransfer(event.dataTransfer);
    await uploadFilesToSshNode(node, items);
  });
}

function pastedImageName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `paste_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.jpg`;
}

async function clipboardImageAsJpeg(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("粘贴图片转换失败")),
      "image/jpeg",
      0.94,
    );
  });
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

function findImageEntryById(id) {
  if (!id) return null;
  const queue = state.directoryRoot ? [state.directoryRoot] : [];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const entry = node.entries?.find((item) => item.id === id);
    if (entry?.type === "image") return entry;
    queue.push(...(node.children || []));
  }
  return state.entries.find((entry) => entry.id === id && entry.type === "image") || null;
}

function imageFromContextMenu(srcUrl) {
  if (!elements.viewerView.classList.contains("hidden")) {
    return state.images[state.currentIndex] || null;
  }
  let id = "";
  try {
    id = new URL(srcUrl).searchParams.get("id") || "";
  } catch {
    // The menu may have been opened outside an image element.
  }
  return findImageEntryById(id);
}

function copyImageFromContextMenu(srcUrl) {
  const entry = imageFromContextMenu(srcUrl);
  if (entry) copyImageToClipboard(entry);
  else showToast("请在图片上使用“复制图像”");
}

function copyImagePathFromContextMenu(srcUrl) {
  const entry = imageFromContextMenu(srcUrl);
  if (entry) copyPath(entryPathForCopy(entry), "图片");
  else showToast("请在图片上使用“复制图片路径”");
}

function downloadImageFromContextMenu(srcUrl) {
  const entry = imageFromContextMenu(srcUrl);
  if (!entry) {
    showToast("请在图片上使用“下载原图”");
    return;
  }
  triggerDownload(
    apiUrl("/api/file", { id: entry.id, download: "1" }),
    entry.name || "original-image",
  );
}

function connectImageContextMenu() {
  if (!IS_EXTENSION) return;
  const port = chrome.runtime.connect({ name: "remotefs-app-page" });
  port.onMessage.addListener((message) => {
    if (message?.type === "copyImageFromContextMenu") {
      copyImageFromContextMenu(message.srcUrl || "");
    } else if (message?.type === "copyImagePathFromContextMenu") {
      copyImagePathFromContextMenu(message.srcUrl || "");
    } else if (message?.type === "downloadImageFromContextMenu") {
      downloadImageFromContextMenu(message.srcUrl || "");
    }
  });
  port.onDisconnect.addListener(() => {
    setTimeout(connectImageContextMenu, 500);
  });
}

function showHome() {
  closeViewer(false);
  closeFileViewer(false);
  clearSelection();
  state.targetType = "";
  state.directoryRoot = null;
  state.selectedDirectory = null;
  state.currentTreeFileId = null;
  state.activeS3Node = null;
  elements.homeView.classList.remove("hidden");
  elements.galleryView.classList.add("hidden");
  elements.locationBar.classList.add("hidden");
  history.pushState(null, "", IS_EXTENSION ? "#" : "/");
}

function showGallery() {
  elements.homeView.classList.add("hidden");
  elements.galleryView.classList.remove("hidden");
  elements.fileView.classList.add("hidden");
  elements.viewerView.classList.add("hidden");
  elements.locationBar.classList.remove("hidden");
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
  let textSaveMode;
  let textDefaultMode;
  let htmlDefaultViewMode;
  let maxPreviewBytes;
  let maxTextPreviewBytes;
  if (globalThis.chrome?.storage?.local) {
    const result = await chrome.storage.local.get([
      "interfaceStyle",
      "sidebarWidth",
      "thumbnailSize",
      "markdownDefaultLayout",
      "textSaveMode",
      "textDefaultMode",
      "htmlDefaultViewMode",
      "maxPreviewBytes",
      "maxTextPreviewBytes",
    ]);
    style = result.interfaceStyle;
    sidebarWidth = result.sidebarWidth;
    thumbnailSize = result.thumbnailSize;
    markdownDefaultLayout = result.markdownDefaultLayout;
    textSaveMode = result.textSaveMode;
    textDefaultMode = result.textDefaultMode;
    htmlDefaultViewMode = result.htmlDefaultViewMode;
    maxPreviewBytes = result.maxPreviewBytes;
    maxTextPreviewBytes = result.maxTextPreviewBytes;
  } else {
    style = localStorage.getItem("interfaceStyle");
    sidebarWidth = Number(localStorage.getItem("sidebarWidth"));
    thumbnailSize = Number(localStorage.getItem("thumbnailSize"));
    markdownDefaultLayout = localStorage.getItem("markdownDefaultLayout");
    textSaveMode = localStorage.getItem("textSaveMode");
    textDefaultMode = localStorage.getItem("textDefaultMode");
    htmlDefaultViewMode = localStorage.getItem("htmlDefaultViewMode");
    maxPreviewBytes = localStorage.getItem("maxPreviewBytes");
    maxTextPreviewBytes = localStorage.getItem("maxTextPreviewBytes");
  }
  applyInterfaceStyle(style);
  if (Number.isFinite(sidebarWidth) && sidebarWidth > 0) {
    applySidebarWidth(sidebarWidth);
  }
  applyThumbnailSize(thumbnailSize);
  state.markdownDefaultLayout =
    ["reading", "a4"].includes(markdownDefaultLayout) ? "reading" : "wide";
  setMarkdownLayout(state.markdownDefaultLayout);
  state.textSaveMode = textSaveMode === "auto" ? "auto" : "manual";
  state.textDefaultMode = textDefaultMode === "read" ? "read" : "edit";
  state.htmlDefaultViewMode = htmlDefaultViewMode === "source" ? "source" : "rendered";
  state.maxPreviewBytes =
    (maxPreviewBytes !== null && maxPreviewBytes !== undefined) &&
      (Number(maxPreviewBytes) === 0 || Number(maxPreviewBytes) >= 16 * 1024 * 1024)
      ? Number(maxPreviewBytes)
      : 256 * 1024 * 1024;
  state.maxTextPreviewBytes =
    Number(maxTextPreviewBytes) >= 1024 * 1024
      ? Number(maxTextPreviewBytes)
      : 2 * 1024 * 1024;
  elements.textSaveMode.value = state.textSaveMode;
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

function setupGalleryMarqueeSelection() {
  let drag = null;
  elements.fileWorkspace.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      elements.galleryView.classList.contains("hidden") ||
      event.target.closest(
        ".image-card, .gallery-toolbar, button, input, select, textarea, a",
      )
    ) return;
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initial: additive ? new Map(state.selectedItems) : new Map(),
      moved: false,
    };
    if (!additive) clearSelection();
    elements.fileWorkspace.setPointerCapture(event.pointerId);
    document.body.classList.add("marquee-selecting");
    event.preventDefault();
  });

  elements.fileWorkspace.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = Math.min(drag.startX, event.clientX);
    const top = Math.min(drag.startY, event.clientY);
    const right = Math.max(drag.startX, event.clientX);
    const bottom = Math.max(drag.startY, event.clientY);
    if (!drag.moved && Math.hypot(right - left, bottom - top) < 4) return;
    drag.moved = true;
    Object.assign(elements.marqueeSelection.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
    elements.marqueeSelection.classList.remove("hidden");
    state.selectedItems = new Map(drag.initial);
    elements.galleryGrid.querySelectorAll(".image-card").forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (
        rect.right >= left &&
        rect.left <= right &&
        rect.bottom >= top &&
        rect.top <= bottom
      ) {
        const item = state.gallerySelectionItems.get(card.dataset.selectionId);
        if (item) state.selectedItems.set(item.id, item);
      }
    });
    syncSelectionUI();
  });

  const finish = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (elements.fileWorkspace.hasPointerCapture(event.pointerId)) {
      elements.fileWorkspace.releasePointerCapture(event.pointerId);
    }
    drag = null;
    elements.marqueeSelection.classList.add("hidden");
    document.body.classList.remove("marquee-selecting");
  };
  elements.fileWorkspace.addEventListener("pointerup", finish);
  elements.fileWorkspace.addEventListener("pointercancel", finish);
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

function clearServerReconnect() {
  clearTimeout(serverReconnectTimer);
  serverReconnectTimer = null;
  serverReconnectAttempt = 0;
}

function scheduleServerReconnect() {
  if (serverReconnectTimer) return;
  const wait = Math.min(30_000, 1000 * (2 ** serverReconnectAttempt));
  serverReconnectAttempt += 1;
  elements.serverStatus.textContent = "本地能力已断开，正在自动重连…";
  elements.serverStatus.className = "status pending reconnecting";
  serverReconnectTimer = setTimeout(async () => {
    serverReconnectTimer = null;
    if (!await connectServer(true, false)) scheduleServerReconnect();
  }, wait);
}

async function connectServer(forceRestart = false, retryAutomatically = true) {
  try {
    if (IS_EXTENSION) {
      const result = await chrome.runtime.sendMessage({
        type: forceRestart ? "recoverBackend" : "getBackend",
      });
      if (!result?.ok) throw new Error(result?.error || "无法启动本地能力");
      SERVER = result.url;
      state.token = result.token;
      clearServerReconnect();
      elements.serverStatus.textContent = "本地能力已连接";
      elements.serverStatus.className = "status online";
      return true;
    }
    const response = await fetch(`${SERVER}/api/session`);
    if (!response.ok) throw new Error("服务未启动");
    const data = await response.json();
    state.token = data.token;
    clearServerReconnect();
    elements.serverStatus.textContent = "本地服务已连接";
    elements.serverStatus.className = "status online";
    return true;
  } catch (error) {
    elements.serverStatus.textContent = retryAutomatically
      ? "本地能力已断开，正在自动重连…"
      : "本地能力重连中…";
    elements.serverStatus.className = "status pending reconnecting";
    elements.formError.textContent = IS_EXTENSION
      ? error.message
      : "本地开发服务未启动。";
    if (retryAutomatically) scheduleServerReconnect();
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
        existing.id = entry.id;
        return existing;
      }
      return {
        id: entry.id,
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
  elements.uploadActions.classList.toggle("hidden", !isSshDirectoryNode(node));
  if (!isSshDirectoryNode(node)) {
    elements.uploadMenu.classList.add("hidden");
    elements.uploadStatus.classList.add("hidden");
  }
  elements.downloadDirectoryButton.textContent = "↓ 下载";
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
  if (node !== state.selectedDirectory) clearSelection();
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

function hideTreeContextMenu() {
  elements.treeContextMenu.classList.add("hidden");
  elements.treeContextMenu.replaceChildren();
}

function showTreeContextMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  elements.treeContextMenu.replaceChildren();
  items.forEach(({ label, action }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = label;
    button.addEventListener("click", async () => {
      hideTreeContextMenu();
      try {
        await action();
      } catch (error) {
        showToast(error.message);
      }
    });
    elements.treeContextMenu.append(button);
  });
  elements.treeContextMenu.classList.remove("hidden");
  const rect = elements.treeContextMenu.getBoundingClientRect();
  elements.treeContextMenu.style.left =
    `${Math.max(6, Math.min(event.clientX, innerWidth - rect.width - 6))}px`;
  elements.treeContextMenu.style.top =
    `${Math.max(6, Math.min(event.clientY, innerHeight - rect.height - 6))}px`;
}

function sshSourceForEntry(entry) {
  const descriptor = decodeEntryDescriptor(entry.id);
  if (!descriptor || descriptor.kind !== "ssh") return "";
  if (!descriptor.port) return `${descriptor.target}:${descriptor.path}`;
  const remotePath = descriptor.path.startsWith("/")
    ? descriptor.path
    : `/${descriptor.path}`;
  return `ssh://${descriptor.target}:${descriptor.port}${remotePath}`;
}

async function renameSshSource(source, newName) {
  return apiPost("/api/ssh/rename", { source, newName });
}

function beginTreeRename({ row, label, source, oldName, afterRename }) {
  hideTreeContextMenu();
  const input = document.createElement("input");
  input.className = "directory-rename-input";
  input.value = oldName;
  input.setAttribute("aria-label", `重命名 ${oldName}`);
  label.replaceWith(input);
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const newName = input.value.trim();
    if (!save || !newName || newName === oldName) {
      input.replaceWith(label);
      return;
    }
    try {
      await renameSshSource(source, newName);
      showToast(`已重命名为 ${newName}`);
      await afterRename(newName);
    } catch (error) {
      input.replaceWith(label);
      showToast(`重命名失败：${error.message}`);
    }
  };
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  const extensionIndex = oldName.lastIndexOf(".");
  const selectionEnd = extensionIndex > 0 ? extensionIndex : oldName.length;
  input.setSelectionRange(0, selectionEnd);
  row.scrollIntoView({ block: "nearest" });
}

function renderDirectoryTree() {
  elements.directoryTree.replaceChildren();
  const root = state.directoryRoot;
  if (!root) return;

  const fragment = document.createDocumentFragment();
  const treeSelectionItems = [];
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
    const selectionItem = selectionItemForEntry(entry, node);
    treeSelectionItems.push(selectionItem);
    if (state.selectedItems.has(entry.id)) {
      state.selectedItems.set(entry.id, selectionItem);
    }
    const row = document.createElement("div");
    row.className = "directory-row directory-file-row";
    row.dataset.selectionId = entry.id;
    row.classList.toggle("multi-selected", state.selectedItems.has(entry.id));
    row.classList.toggle("active-file", entry.id === state.currentTreeFileId);
    row.style.setProperty("--tree-depth", depth);
    row.title = entry.relativePath || entry.name;

    const spacer = document.createElement("span");
    spacer.className = "directory-toggle directory-file-spacer";
    const checkbox = document.createElement("input");
    checkbox.className = "directory-selection-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedItems.has(entry.id);
    checkbox.setAttribute("aria-label", `选择 ${entry.name || entry.relativePath}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelectedItem(selectionItem);
    });
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
    row.append(spacer, checkbox, icon, label, downloadButton, copyButton);
    row.addEventListener("click", (event) => {
      if (event.shiftKey) {
        selectItemRange(
          treeSelectionItems,
          selectionItem,
          event.metaKey || event.ctrlKey,
        );
      } else if (event.metaKey || event.ctrlKey) {
        toggleSelectedItem(selectionItem);
      } else {
        openTreeFile(node, entry);
      }
    });
    row.addEventListener("pointerdown", (event) => {
      if (event.button === 2 && !state.selectedItems.has(entry.id)) {
        selectOnlyItem(selectionItem);
      }
    });
    row.addEventListener("contextmenu", (event) => {
      if (!state.selectedItems.has(entry.id)) selectOnlyItem(selectionItem);
      const sshSource = sshSourceForEntry(entry);
      const selectedCount = state.selectedItems.size;
      const items = [
        { label: "打开", action: () => openTreeFile(node, entry) },
      ];
      if (sshSource && selectedCount === 1) {
        items.push({
          label: "重命名",
          action: () => beginTreeRename({
            row,
            label,
            source: sshSource,
            oldName: entry.name,
            afterRename: async () => {
              if (state.currentTreeFileId === entry.id) {
                closeViewer(false);
                closeFileViewer(false);
                state.currentTreeFileId = null;
              }
              await loadDirectoryNode(node, true);
              if (state.selectedDirectory === node) updateSelectedDirectory(node, false);
            },
          }),
        });
      }
      items.push(
        {
          label: "下载文件",
          action: () => triggerDownload(
            apiUrl("/api/file", { id: entry.id, download: "1" }),
            entry.name || "download",
          ),
        },
        {
          label: selectedCount > 1 ? `复制 ${selectedCount} 个路径` : "复制路径",
          action: copySelectedPaths,
        },
      );
      if (selectedItemsCanDelete()) {
        items.push({
          label: selectedCount > 1 ? `删除 ${selectedCount} 项` : "删除",
          action: deleteSelectedItems,
        });
      }
      showTreeContextMenu(event, items);
    });
    fragment.append(row);
  };
  const appendNode = (node, depth) => {
    const selectionItem = selectionItemForNode(node);
    if (selectionItem) treeSelectionItems.push(selectionItem);
    if (selectionItem && state.selectedItems.has(selectionItem.id)) {
      state.selectedItems.set(selectionItem.id, selectionItem);
    }
    const row = document.createElement("div");
    row.className = "directory-row";
    if (selectionItem) row.dataset.selectionId = selectionItem.id;
    row.classList.toggle("selected", node === state.selectedDirectory);
    row.classList.toggle(
      "multi-selected",
      Boolean(selectionItem && state.selectedItems.has(selectionItem.id)),
    );
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
    const checkbox = document.createElement("input");
    checkbox.className = "directory-selection-checkbox";
    checkbox.classList.toggle("root-selection-checkbox", !selectionItem);
    checkbox.type = "checkbox";
    checkbox.disabled = !selectionItem;
    checkbox.checked = Boolean(selectionItem && state.selectedItems.has(selectionItem.id));
    checkbox.setAttribute("aria-label", `选择 ${node.name || node.source}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelectedItem(selectionItem);
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
    row.append(toggle, checkbox, icon, label, downloadButton, copyButton);
    row.addEventListener("click", (event) => {
      if (selectionItem && event.shiftKey) {
        selectItemRange(
          treeSelectionItems,
          selectionItem,
          event.metaKey || event.ctrlKey,
        );
      } else if (selectionItem && (event.metaKey || event.ctrlKey)) {
        toggleSelectedItem(selectionItem);
      } else {
        selectDirectoryNode(node);
      }
    });
    row.addEventListener("pointerdown", (event) => {
      if (
        selectionItem &&
        event.button === 2 &&
        !state.selectedItems.has(selectionItem.id)
      ) {
        selectOnlyItem(selectionItem);
      }
    });
    row.addEventListener("contextmenu", (event) => {
      if (selectionItem && !state.selectedItems.has(selectionItem.id)) {
        selectOnlyItem(selectionItem);
      }
      const sshDirectory = isSshDirectoryNode(node);
      const selectedCount = state.selectedItems.size;
      const items = [
        { label: "打开", action: () => selectDirectoryNode(node) },
      ];
      if (sshDirectory) {
        items.push(
          {
            label: "上传文件到此处",
            action: () => {
              state.uploadPickerTarget = node;
              elements.uploadFilesInput.click();
            },
          },
          {
            label: "上传目录到此处",
            action: () => {
              state.uploadPickerTarget = node;
              elements.uploadDirectoryInput.click();
            },
          },
        );
      }
      if (sshDirectory && node.parent && selectedCount === 1) {
        items.push({
          label: "重命名",
          action: () => beginTreeRename({
            row,
            label,
            source: node.source,
            oldName: node.name,
            afterRename: async (newName) => {
              const parent = node.parent;
              const wasSelected = state.selectedDirectory === node;
              await loadDirectoryNode(parent, true);
              const renamed = parent.children.find((child) => child.name === newName);
              if (wasSelected && renamed) {
                await selectDirectoryNode(renamed);
              } else {
                renderDirectoryTree();
              }
            },
          }),
        });
      }
      items.push(
        { label: "下载目录", action: () => downloadDirectoryNode(node) },
      );
      if (selectionItem) {
        items.push({
          label: selectedCount > 1 ? `复制 ${selectedCount} 个路径` : "复制路径",
          action: copySelectedPaths,
        });
        if (selectedItemsCanDelete()) {
          items.push({
            label: selectedCount > 1 ? `删除 ${selectedCount} 项` : "删除",
            action: deleteSelectedItems,
          });
        }
      } else {
        items.push({ label: "复制路径", action: () => copyPath(node.source, "目录") });
      }
      showTreeContextMenu(event, items);
    });
    enableSshDropTarget(row, node);
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
  clearSelection();
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
      elements.downloadDirectoryButton.textContent = "↓ 下载";
      elements.uploadActions.classList.toggle("hidden", state.sourceMode !== "ssh");
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

function pumpThumbnailQueue() {
  const maximum = 8;
  while (state.activeThumbnailLoads < maximum && state.thumbnailQueue.length) {
    const job = state.thumbnailQueue.shift();
    if (
      job.generation !== state.thumbnailGeneration ||
      !job.image.isConnected
    ) continue;
    state.activeThumbnailLoads += 1;
    let settled = false;
    const finish = (loaded) => {
      if (settled) {
        if (loaded && job.generation === state.thumbnailGeneration) {
          state.readyThumbnails.add(job.image.dataset.id);
          job.image.classList.add("loaded");
        }
        return;
      }
      settled = true;
      clearTimeout(timeout);
      state.activeThumbnailLoads = Math.max(0, state.activeThumbnailLoads - 1);
      if (loaded && job.generation === state.thumbnailGeneration) {
        state.readyThumbnails.add(job.image.dataset.id);
        job.image.classList.add("loaded");
      }
      pumpThumbnailQueue();
    };
    const timeout = setTimeout(() => finish(false), 30 * 1000);
    job.image.onload = () => finish(true);
    job.image.onerror = () => finish(false);
    job.image.src = apiUrl("/api/thumbnail", { id: job.image.dataset.id });
  }
}

function queueThumbnail(image, generation) {
  state.thumbnailQueue.push({ image, generation });
  pumpThumbnailQueue();
}

function renderGallery() {
  state.thumbnailObserver?.disconnect();
  state.thumbnailGeneration += 1;
  const thumbnailGeneration = state.thumbnailGeneration;
  state.thumbnailQueue = [];
  elements.galleryGrid.replaceChildren();
  elements.galleryEmpty.classList.toggle("hidden", state.visibleEntries.length > 0);
  elements.imageCount.textContent = `${state.visibleEntries.length} / ${state.entries.length} 项`;

  state.thumbnailObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      queueThumbnail(image, thumbnailGeneration);
      observer.unobserve(image);
    }
  }, { rootMargin: "500px" });

  const fragment = document.createDocumentFragment();
  const selectionItems = state.visibleEntries.map(
    (entry) => selectionItemForEntry(entry, state.selectedDirectory),
  );
  const selectionItemsById = new Map(selectionItems.map((item) => [item.id, item]));
  state.gallerySelectionItems = selectionItemsById;
  state.visibleEntries.forEach((entry) => {
    const selectionItem = selectionItemsById.get(entry.id);
    if (state.selectedItems.has(entry.id)) {
      state.selectedItems.set(entry.id, selectionItem);
    }
    const card = document.createElement("article");
    card.className = "image-card";
    card.dataset.selectionId = entry.id;
    card.classList.toggle("selected", state.selectedItems.has(entry.id));

    const preview = document.createElement("div");
    preview.className = "image-preview";
    const checkbox = document.createElement("input");
    checkbox.className = "entry-selection-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedItems.has(entry.id);
    checkbox.setAttribute("aria-label", `选择 ${entry.name || entry.relativePath}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelectedItem(selectionItem);
    });
    preview.append(checkbox);
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
    preview.append(
      createFileCopyPathButton(entry),
      createFileDownloadButton(entry),
    );

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
    const openEntry = () => {
      if (entry.type === "image") {
        state.currentIndex = state.images.findIndex((item) => item.id === entry.id);
        openViewer();
      } else if (entry.type === "archive") {
        openArchive(entry);
      } else {
        openFileViewer(entry);
      }
    };
    card.addEventListener("click", (event) => {
      if (event.shiftKey) {
        selectItemRange(
          selectionItems,
          selectionItem,
          event.metaKey || event.ctrlKey,
        );
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        toggleSelectedItem(selectionItem);
        return;
      }
      openEntry();
    });
    card.addEventListener("pointerdown", (event) => {
      if (event.button === 2 && !state.selectedItems.has(entry.id)) {
        selectOnlyItem(selectionItem);
      }
    });
    if (entry.type !== "image") {
      card.addEventListener("contextmenu", (event) => {
        if (!state.selectedItems.has(entry.id)) selectOnlyItem(selectionItem);
        const selectedCount = state.selectedItems.size;
        const items = [
          { label: "打开", action: openEntry },
          {
            label: selectedCount > 1 ? `复制 ${selectedCount} 个路径` : "复制路径",
            action: copySelectedPaths,
          },
        ];
        if (selectedItemsCanDelete()) {
          items.push({
            label: selectedCount > 1 ? `删除 ${selectedCount} 项` : "删除",
            action: deleteSelectedItems,
          });
        }
        showTreeContextMenu(event, items);
      });
    } else {
      card.addEventListener("contextmenu", () => {
        if (!state.selectedItems.has(entry.id)) selectOnlyItem(selectionItem);
      });
    }
    fragment.append(card);
  });
  elements.galleryGrid.append(fragment);
  syncSelectionUI();
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
  const button = elements.directoryRefreshButton;
  button.disabled = true;
  button.classList.add("refreshing");
  clearSelection();
  try {
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
    await loadDirectoryNode(node, true);
    state.readyThumbnails.clear();
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
    button.disabled = false;
    button.classList.remove("refreshing");
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
  if (["mp4", "webm", "mov", "m4v", "ogv", "ogg", "avi", "mkv"].includes(extension)) {
    return "video";
  }
  if (["docx", "xlsx", "pptx"].includes(extension)) return extension;
  if (["doc", "xls", "ppt"].includes(extension)) return "office-legacy";
  if (KNOWN_BINARY_EXTENSIONS.has(extension)) return "binary";
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

function isTextPreviewKind(kind) {
  return ["markdown", "json", "code", "html", "generic"].includes(kind);
}

function previewLimitForKind(kind) {
  return isTextPreviewKind(kind)
    ? state.maxTextPreviewBytes
    : state.maxPreviewBytes;
}

function exceedsPreviewLimit(size, limit) {
  return Number.isFinite(size) && limit > 0 && size > limit;
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
  if (kind === "binary") return "BINARY";
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
      delimiters: ["dollars", "brackets", "beg_end"],
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

function setCurrentFileText(content, truncated = false) {
  state.currentFileText = content;
  state.currentFileTextTruncated = truncated;
  elements.copyFileTextButton.textContent =
    truncated ? "⧉ 复制已显示内容" : "⧉ 复制全文";
  elements.copyFileTextButton.classList.remove("hidden");
  const descriptor = state.currentFileEntry
    ? decodeEntryDescriptor(state.currentFileEntry.id)
    : null;
  elements.textEditControls.classList.toggle(
    "hidden",
    !descriptor ||
      descriptor.kind === "archive" ||
      (!state.currentFileWritable && !state.currentFileReadOnlyView),
  );
  elements.editTextButton.textContent = state.currentFileReadOnlyView
    ? "只读编辑"
    : "编辑";
  updateTextSaveControls();
}

function clearTextAutoSave() {
  clearTimeout(state.textAutoSaveTimer);
  state.textAutoSaveTimer = null;
}

function setTextSaveStatus(message = "", type = "") {
  elements.textSaveStatus.textContent = message;
  elements.textSaveStatus.className = `text-save-status${type ? ` ${type}` : ""}`;
}

function updateTextEditorLineNumbers() {
  const lines = elements.textEditorInput.value.split(/\r\n|\r|\n/).length;
  elements.textEditorLineNumbers.textContent = Array.from(
    { length: lines },
    (_, index) => index + 1,
  ).join("\n");
}

function updateTextSaveControls() {
  elements.textEditorInput.readOnly = !state.currentFileWritable;
  elements.textSaveMode.classList.toggle("hidden", !state.currentFileWritable);
  elements.saveTextButton.classList.toggle(
    "hidden",
    !state.currentFileWritable || (!state.textEditMode && !state.textDirty),
  );
  elements.textSaveStatus.classList.toggle(
    "hidden",
    !state.currentFileWritable && !state.currentFileReadOnlyView,
  );
  elements.saveTextButton.disabled = state.textSaving || !state.textDirty;
  elements.saveTextButton.textContent = state.textSaving ? "保存中…" : "保存";
  if (state.currentFileReadOnlyView) setTextSaveStatus("只读");
  else if (state.textSaving) setTextSaveStatus("正在保存…");
  else if (state.textDirty) {
    setTextSaveStatus(
      state.textSaveMode === "auto" ? "等待自动保存" : "有未保存修改",
      "dirty",
    );
  }
}

function scheduleTextAutoSave() {
  clearTextAutoSave();
  if (
    state.textSaveMode !== "auto" ||
    !state.textDirty ||
    state.textSaving
  ) return;
  state.textAutoSaveTimer = setTimeout(() => saveCurrentText(), 1000);
}

function textContentType(entry) {
  const extension = entry?.name?.split(".").at(-1)?.toLocaleLowerCase();
  if (extension === "html" || extension === "htm") return "text/html; charset=utf-8";
  if (extension === "json") return "application/json; charset=utf-8";
  if (extension === "md" || extension === "markdown") {
    return "text/markdown; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function putCurrentText(entry, content, retry = true) {
  let response;
  try {
    response = await fetch(apiUrl("/api/file/save", { id: entry.id }), {
      method: "PUT",
      headers: { "Content-Type": textContentType(entry) },
      body: content,
    });
  } catch (error) {
    if (retry && IS_EXTENSION && await connectServer(true)) {
      return putCurrentText(entry, content, false);
    }
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.error || `保存失败 (${response.status})`;
    if (
      retry &&
      IS_EXTENSION &&
      isRetryableApiError(response.status, message) &&
      await connectServer(true)
    ) {
      return putCurrentText(entry, content, false);
    }
    throw new Error(message);
  }
  return result;
}

async function saveCurrentText() {
  if (
    !state.currentFileWritable ||
    !state.textDirty ||
    state.textSaving ||
    !state.currentFileEntry
  ) return;
  clearTextAutoSave();
  const entry = state.currentFileEntry;
  const content = elements.textEditorInput.value;
  const version = state.textEditVersion;
  state.textSaving = true;
  let saveError = null;
  updateTextSaveControls();
  try {
    const result = await putCurrentText(entry, content);
    if (state.currentFileEntry !== entry) return;
    if (result.id) {
      entry.id = result.id;
      state.currentTreeFileId = result.id;
      elements.downloadFileButton.href = apiUrl("/api/file", {
        id: result.id,
        download: "1",
      });
      if (Number.isFinite(result.size)) entry.size = result.size;
      if (Number.isFinite(result.modified)) entry.modified = result.modified;
      if (state.directoryRoot) renderDirectoryTree();
    }
    state.currentFileText = content;
    state.currentFileTextTruncated = false;
    if (version === state.textEditVersion) {
      state.textDirty = false;
      setTextSaveStatus("已保存", "saved");
    }
  } catch (error) {
    saveError = error;
    showToast(`保存失败：${error.message}`);
  } finally {
    state.textSaving = false;
    updateTextSaveControls();
    if (saveError) setTextSaveStatus("保存失败", "error");
    else if (state.textDirty && state.textSaveMode === "auto") scheduleTextAutoSave();
  }
}

async function loadFullTextForEditing() {
  if (!state.currentFileEntry || !state.currentFileTextTruncated) return;
  setTextSaveStatus("正在读取全文…");
  const response = await fetch(apiUrl("/api/file", { id: state.currentFileEntry.id }));
  if (!response.ok) throw new Error(`文件读取失败 (${response.status})`);
  const declaredSize = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredSize) && declaredSize > 64 * 1024 * 1024) {
    throw new Error("文本文件超过 64 MB，不能在页面内编辑");
  }
  const content = await response.arrayBuffer();
  if (content.byteLength > 64 * 1024 * 1024) {
    throw new Error("文本文件超过 64 MB，不能在页面内编辑");
  }
  const text = decodeGenericText(content);
  if (text === null) throw new Error("该文件包含二进制内容，不能作为文本编辑");
  setCurrentFileText(text, false);
}

async function renderEditedTextPreview() {
  const entry = state.currentFileEntry;
  if (!entry) return;
  const content = elements.textEditorInput.value;
  const kind = formattedFileKind(entry);
  state.currentFileText = content;
  elements.markdownPreview.classList.add("hidden");
  elements.jsonPreview.classList.add("hidden");
  elements.codePreview.classList.add("hidden");
  elements.formattedFileError.classList.add("hidden");
  if (kind === "markdown") {
    await renderMarkdown(content, entry);
    elements.markdownPreview.classList.remove("hidden");
  } else if (kind === "json") {
    try {
      elements.jsonPreview.querySelector("code").innerHTML = highlightedJson(content);
    } catch (error) {
      elements.jsonPreview.querySelector("code").textContent = content;
      elements.formattedFileError.textContent = `JSON 格式有误：${error.message}`;
      elements.formattedFileError.classList.remove("hidden");
    }
    elements.jsonPreview.classList.remove("hidden");
  } else {
    renderCodeContent(
      entry,
      content,
      kind === "html" ? "xml" : kind === "code" ? codeLanguage(entry) : "plaintext",
    );
    if (kind === "html") {
      state.htmlViewMode = "source";
      elements.htmlSourceButton.classList.add("active");
      elements.htmlRenderedButton.classList.remove("active");
    }
  }
}

async function setTextEditMode(editing) {
  if (!state.currentFileEntry || state.currentFileText === null) return;
  if (editing && state.currentFileTextTruncated) await loadFullTextForEditing();
  state.textEditMode = editing;
  elements.editTextButton.textContent = editing
    ? "预览"
    : state.currentFileReadOnlyView
      ? "只读编辑"
      : "编辑";
  elements.textEditor.classList.toggle("hidden", !editing);
  elements.htmlViewControls.classList.toggle(
    "hidden",
    editing || formattedFileKind(state.currentFileEntry) !== "html",
  );
  if (editing) {
    elements.fileFrame.classList.add("hidden");
    elements.formattedFilePreview.classList.remove("hidden");
    elements.markdownPreview.classList.add("hidden");
    elements.jsonPreview.classList.add("hidden");
    elements.codePreview.classList.add("hidden");
    elements.officePreview.classList.add("hidden");
    elements.textEditorInput.value = state.currentFileText;
    updateTextEditorLineNumbers();
    elements.textEditorInput.focus();
    updateTextSaveControls();
  } else {
    await renderEditedTextPreview();
  }
  updateTextSaveControls();
}

async function copyCurrentFileText() {
  if (state.currentFileText === null) return;
  try {
    await navigator.clipboard.writeText(state.currentFileText);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = state.currentFileText;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast(state.currentFileTextTruncated ? "已复制当前显示内容" : "已复制文件全文");
}

function visibleFileTextElement() {
  if (!elements.codePreview.classList.contains("hidden")) {
    return elements.codePreview.querySelector(".code-source code");
  }
  if (!elements.jsonPreview.classList.contains("hidden")) {
    return elements.jsonPreview.querySelector("code");
  }
  if (!elements.markdownPreview.classList.contains("hidden")) {
    return elements.markdownPreview;
  }
  return null;
}

function selectVisibleFileText() {
  const target = visibleFileTextElement();
  if (!target) return false;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function inspectGenericFile(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Range: "bytes=0-65535" },
  });
  if (!response.ok) throw new Error(`文件类型检测失败 (${response.status})`);
  const rangeSize = Number(
    response.headers.get("Content-Range")?.match(/\/(\d+)$/)?.[1],
  );
  const contentLengthHeader = response.headers.get("Content-Length");
  const contentLength = contentLengthHeader === null
    ? undefined
    : Number(contentLengthHeader);
  const totalSize = Number.isFinite(rangeSize)
    ? rangeSize
    : Number.isFinite(contentLength)
      ? contentLength
      : undefined;
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    return {
      binary: decodeGenericText(buffer.slice(0, 64 * 1024)) === null,
      size: Number.isFinite(totalSize) ? totalSize : buffer.byteLength,
    };
  }
  const chunks = [];
  let length = 0;
  while (length < 64 * 1024) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = 64 * 1024 - length;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  await reader.cancel().catch(() => {});
  const sample = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    sample.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    binary: decodeGenericText(sample.buffer) === null,
    size: Number.isFinite(totalSize) ? totalSize : undefined,
  };
}

function showUnsupportedBinary(entry) {
  const notice = document.createElement("div");
  notice.className = "office-legacy-notice";
  const title = document.createElement("strong");
  title.textContent = "此二进制文件不支持页面预览";
  const detail = document.createElement("span");
  detail.textContent =
    `${entry.name || "该文件"} 不是可直接显示的文本格式。` +
    "文件不会自动下载，如需保存请点击右上角“下载文件”。";
  notice.append(title, detail);
  elements.officePreview.replaceChildren(notice);
  elements.officePreview.classList.remove("hidden");
}

function showLargeFileNotice(entry, limit, textFile) {
  const notice = document.createElement("div");
  notice.className = "office-legacy-notice";
  const title = document.createElement("strong");
  title.textContent = "文件过大，已停止自动预览";
  const detail = document.createElement("span");
  detail.textContent =
    `${entry.name || "该文件"} 的大小为 ${formatBytes(entry.size)}，` +
    `超过${textFile ? "文本" : "通用"}预览上限 ${formatBytes(limit)}。` +
    "可在通用设置调整限制，或使用右上角“下载文件”获取原文件。";
  notice.append(title, detail);
  elements.officePreview.replaceChildren(notice);
  elements.officePreview.classList.remove("hidden");
}

async function openFileViewer(entry) {
  clearTextAutoSave();
  state.textEditMode = false;
  state.textDirty = false;
  state.textSaving = false;
  state.textEditVersion = 0;
  state.currentFileEntry = entry;
  state.currentFileText = null;
  state.currentFileTextTruncated = false;
  state.currentFileWritable = false;
  state.currentFileReadOnlyView = false;
  elements.copyFileTextButton.classList.add("hidden");
  elements.textEditControls.classList.add("hidden");
  elements.textEditor.classList.add("hidden");
  elements.saveTextButton.classList.add("hidden");
  elements.editTextButton.textContent = "编辑";
  setTextSaveStatus();
  state.currentTreeFileId = entry.id;
  if (state.directoryRoot) renderDirectoryTree();
  state.filePreviewController?.abort();
  const controller = new AbortController();
  state.filePreviewController = controller;
  const url = apiUrl("/api/file", { id: entry.id });
  let kind = formattedFileKind(entry);
  if (kind === "generic") {
    try {
      const inspection = await inspectGenericFile(url, controller.signal);
      if (Number.isFinite(inspection.size)) entry.size = inspection.size;
      if (inspection.binary) kind = "binary";
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  const editableText = isTextPreviewKind(kind);
  const capabilitiesPromise = editableText
    ? api("/api/file-capabilities", { id: entry.id }).catch(() => ({ writable: false }))
    : Promise.resolve({ writable: false });
  const directFile = state.targetType === "file";
  elements.closeFileButton.textContent = directFile ? "← 返回主页" : "← 返回目录";
  elements.fileHomeButton.classList.toggle("hidden", directFile);
  elements.fileView.classList.toggle("with-directory", !directFile);
  elements.fileViewName.textContent = entry.relativePath || entry.name;
  elements.copyFilePathButton.title = `复制文件路径：${entryPathForCopy(entry)}`;
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
  elements.textEditor.classList.add("hidden");
  elements.markdownPreview.classList.add("hidden");
  elements.jsonPreview.classList.add("hidden");
  elements.codePreview.classList.add("hidden");
  elements.officePreview.classList.add("hidden");
  elements.videoPreview.classList.add("hidden");
  stopVideoPlayback();
  elements.formattedFileError.classList.add("hidden");

  const previewLimit = previewLimitForKind(kind);
  if (exceedsPreviewLimit(entry.size, previewLimit)) {
    elements.fileFrame.src = "about:blank";
    elements.fileFrame.classList.add("hidden");
    elements.formattedFilePreview.classList.remove("hidden");
    elements.formattedFilePreview.classList.remove("video-mode");
    elements.markdownLayoutControls.classList.add("hidden");
    elements.htmlViewControls.classList.add("hidden");
    elements.formattedFileLoading.classList.add("hidden");
    showLargeFileNotice(entry, previewLimit, editableText);
    return;
  }

  if (browserPreview) {
    elements.fileFrame.removeAttribute("sandbox");
    delete elements.fileFrame.dataset.renderEntry;
    elements.fileFrame.src = url;
    return;
  }

  elements.fileFrame.src = "about:blank";
  delete elements.fileFrame.dataset.renderEntry;
  if (kind === "html") await setHtmlViewMode(state.htmlDefaultViewMode);
  if (kind === "video") {
    openVideoPreview(entry);
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
  if (kind === "binary") {
    showUnsupportedBinary(entry);
    elements.formattedFileLoading.classList.add("hidden");
    return;
  }
  elements.formattedFileLoading.classList.remove("hidden");
  try {
    const genericPreview = kind === "generic";
    const response = await fetch(url, {
      signal: controller.signal,
      ...(genericPreview
        ? {
          headers: {
            Range: `bytes=0-${Math.max(0, state.maxTextPreviewBytes - 1)}`,
          },
        }
        : {}),
    });
    if (!response.ok) throw new Error(`文件读取失败 (${response.status})`);
    const contentRangeTotal = Number(
      response.headers.get("Content-Range")?.match(/\/(\d+)$/)?.[1],
    );
    const responseSize = Number.isFinite(contentRangeTotal)
      ? contentRangeTotal
      : Number(response.headers.get("Content-Length"));
    if (exceedsPreviewLimit(responseSize, previewLimit)) {
      await response.body?.cancel().catch(() => {});
      entry.size = responseSize;
      showLargeFileNotice(entry, previewLimit, editableText);
      elements.formattedFileLoading.classList.add("hidden");
      return;
    }
    const isOffice = ["docx", "xlsx", "pptx"].includes(kind);
    const content = isOffice || genericPreview
      ? await response.arrayBuffer()
      : await response.text();
    if (controller.signal.aborted) return;
    const capabilities = await capabilitiesPromise;
    state.currentFileWritable = capabilities.writable === true;
    state.currentFileReadOnlyView =
      kind === "markdown" &&
      capabilities.readOnly === true;
    if (controller.signal.aborted || state.currentFileEntry !== entry) return;

    if (kind === "markdown") {
      setCurrentFileText(content);
      await renderMarkdown(content, entry);
      if (controller.signal.aborted) return;
      elements.markdownPreview.classList.remove("hidden");
    } else if (kind === "json") {
      setCurrentFileText(content);
      try {
        elements.jsonPreview.querySelector("code").innerHTML = highlightedJson(content);
      } catch (error) {
        elements.jsonPreview.querySelector("code").textContent = content;
        elements.formattedFileError.textContent = `JSON 格式有误，已按原文显示：${error.message}`;
        elements.formattedFileError.classList.remove("hidden");
      }
      elements.jsonPreview.classList.remove("hidden");
    } else if (kind === "code" || kind === "html") {
      setCurrentFileText(content);
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
        setCurrentFileText(text, Boolean(truncated));
        renderCodeContent(
          entry,
          text,
          "plaintext",
          truncated
            ? `文件较大，仅显示前 ${formatBytes(state.maxTextPreviewBytes)}；` +
              "可使用右上角下载完整文件。"
            : "",
        );
      }
    } else if (isOffice) {
      await renderOfficePreview(kind, content);
      elements.officePreview.classList.remove("hidden");
    }
    if (
      state.currentFileText !== null &&
      state.currentFileWritable &&
      state.textDefaultMode === "edit" &&
      !["markdown", "html"].includes(kind)
    ) {
      await setTextEditMode(true);
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

function stopVideoCacheWatch() {
  state.videoCacheToken += 1;
  clearTimeout(state.videoCacheTimer);
  state.videoCacheTimer = null;
}

function stopVideoPlayback() {
  stopVideoCacheWatch();
  releaseVideoHold();
  state.videoFastPlayback = false;
  state.videoUsingCache = false;
  state.videoCache = null;
  state.videoScrubbing = false;
  state.videoShownFrame = null;
  state.videoFpsLocked = false;
  state.videoTiming = null;
  state.videoTimingResolved = false;
  state.videoTimingSource = null;
  state.videoFallbackAttempted = false;
  state.videoUsingCompatible = false;
  state.videoRequestedTime = null;
  state.videoSourceTransition = "";
  resetVideoZoom();
  if (videoFullscreenElement() === elements.videoPreview) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(document)).catch(() => {});
  }
  elements.videoPlayer.playbackRate = 1;
  elements.videoPlayer.pause();
  elements.videoPlayer.removeAttribute("src");
  elements.videoPlayer.load();
}

const VIDEO_ZOOM_MAX = 8;
let videoStagePointer = null;
let videoStageClickTimer = null;

function applyVideoZoom() {
  const video = elements.videoPlayer;
  const zoom = state.videoZoom;
  video.style.transform =
    zoom === 1
      ? ""
      : `translate(${state.videoPanX}px, ${state.videoPanY}px) scale(${zoom})`;
  elements.videoStage.classList.toggle("zoomed", zoom > 1);
  elements.videoZoomReset.textContent = `${zoom.toFixed(zoom >= 10 ? 0 : 1)}×`;
}

function clampVideoPan() {
  if (state.videoZoom <= 1) {
    state.videoZoom = 1;
    state.videoPanX = 0;
    state.videoPanY = 0;
    return;
  }
  const rect = elements.videoStage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  state.videoPanX = Math.min(
    0,
    Math.max(rect.width * (1 - state.videoZoom), state.videoPanX),
  );
  state.videoPanY = Math.min(
    0,
    Math.max(rect.height * (1 - state.videoZoom), state.videoPanY),
  );
}

function resetVideoZoom() {
  state.videoZoom = 1;
  state.videoPanX = 0;
  state.videoPanY = 0;
  elements.videoStage.classList.remove("panning");
  applyVideoZoom();
}

function zoomVideoAt(clientX, clientY, nextZoom) {
  const rect = elements.videoStage.getBoundingClientRect();
  const previous = state.videoZoom;
  const zoom = Math.min(VIDEO_ZOOM_MAX, Math.max(1, nextZoom));
  const pointX = clientX - rect.left;
  const pointY = clientY - rect.top;
  const contentX = (pointX - state.videoPanX) / previous;
  const contentY = (pointY - state.videoPanY) / previous;
  state.videoZoom = zoom;
  state.videoPanX = pointX - contentX * zoom;
  state.videoPanY = pointY - contentY * zoom;
  clampVideoPan();
  applyVideoZoom();
}

function zoomVideoBy(factor) {
  const rect = elements.videoStage.getBoundingClientRect();
  zoomVideoAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state.videoZoom * factor);
}

function formatVideoFps(fps) {
  return String(Math.round(fps * 1000) / 1000);
}

function activeVideoTiming() {
  if (state.videoFpsLocked) {
    const fps = Number(elements.videoFps.value);
    const duration = elements.videoPlayer.duration;
    if (!(fps > 0) || !Number.isFinite(duration) || duration <= 0) return null;
    const frameCount = Math.max(1, Math.round(duration * fps));
    return {
      fps,
      frameCount,
      timescale: 1000000,
      runs: [{ count: frameCount, delta: 1000000 / fps }],
    };
  }
  return state.videoTiming?.frameCount > 0 ? state.videoTiming : null;
}

function currentVideoFps() {
  return activeVideoTiming()?.fps || 0;
}

function timeAtFrame(frame) {
  const timing = activeVideoTiming();
  if (!timing) return 0;
  let remaining = Math.max(0, frame);
  let ticks = 0;
  for (const run of timing.runs) {
    const take = Math.min(remaining, run.count);
    ticks += take * run.delta;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return ticks / timing.timescale;
}

function frameIndexAtTime(time) {
  const timing = activeVideoTiming();
  if (!timing) return 0;
  const target = Math.max(0, time) * timing.timescale;
  let ticks = 0;
  let frame = 0;
  for (const run of timing.runs) {
    const span = run.count * run.delta;
    if (target < ticks + span) {
      return frame + Math.min(
        run.count - 1,
        Math.max(0, Math.floor((target - ticks) / run.delta + 1e-4)),
      );
    }
    ticks += span;
    frame += run.count;
  }
  return Math.max(0, frame - 1);
}

function ensureVideoFpsOption(fps) {
  const label = formatVideoFps(fps);
  let option = [...elements.videoFps.options].find((item) => item.value === label);
  if (!option) {
    option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    elements.videoFps.append(option);
  }
  elements.videoFps.value = label;
}

function applyVideoTiming(info) {
  if (state.videoFpsLocked || !(info?.fps > 0)) return;
  state.videoTimingSource = info;
  const duration = elements.videoPlayer.duration;
  let frameCount = info.frameCount;
  let runs = info.runs;
  if (!(frameCount > 0) && Number.isFinite(duration) && duration > 0) {
    frameCount = Math.max(1, Math.round(duration * info.fps));
    runs = [{ count: frameCount, delta: (info.timescale || 1000000) / info.fps }];
  }
  if (!(frameCount > 0) || !runs?.length) return;
  state.videoTiming = {
    fps: info.fps,
    frameCount,
    timescale: info.timescale || 1000000,
    runs,
    estimated: Boolean(info.estimated),
  };
  ensureVideoFpsOption(info.fps);
  updateVideoHud();
}

async function loadVideoTiming(entry, token) {
  try {
    const info = await api("/api/video-info", { id: entry.id }, 0, 0);
    if (token !== state.videoCacheToken || state.currentFileEntry?.id !== entry.id) return;
    if (info?.pending) {
      if (info.fps > 0) {
        state.videoTimingResolved = true;
        applyVideoTiming(info);
      }
      return;
    }
    state.videoTimingResolved = true;
    if (info?.needsTranscode) {
      applyVideoTiming(info);
      switchToCompatibleVideo(entry);
      return;
    }
    applyVideoTiming(info);
    if (!state.videoTiming && !elements.videoPlayer.paused) observeVideoFrameRate();
  } catch {
    // 保持“检测中”，避免把暂时性的读取失败误报为估算帧率。
  }
}

function formatVideoClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--.---";
  const milliseconds = Math.floor((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const secondsPart = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const body = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`
    : `${minutes}:${String(secondsPart).padStart(2, "0")}`;
  return `${body}.${String(milliseconds).padStart(3, "0")}`;
}

function videoHudTime() {
  const video = elements.videoPlayer;
  if (video.paused && Number.isFinite(state.videoShownFrame)) return timeAtFrame(state.videoShownFrame);
  return Number.isFinite(video.currentTime) ? video.currentTime : 0;
}

function updateVideoHud() {
  const video = elements.videoPlayer;
  const timing = activeVideoTiming();
  const time = videoHudTime();
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  elements.videoTime.textContent =
    `${formatVideoClock(time)} / ${formatVideoClock(duration)}`;
  if (timing) {
    const index = Number.isFinite(state.videoShownFrame) && video.paused
      ? Math.min(timing.frameCount - 1, state.videoShownFrame)
      : frameIndexAtTime(time);
    elements.videoFrame.textContent = `帧 ${index + 1} / ${timing.frameCount}`;
  } else {
    elements.videoFrame.textContent = "帧 —";
  }
  elements.videoPlayButton.textContent = video.paused ? "播放" : "暂停";
  if (!state.videoScrubbing) {
    elements.videoTimeline.max = String(duration || 0);
    elements.videoTimeline.step = timing ? String(1 / timing.fps) : "0.001";
    elements.videoTimeline.value = String(Math.min(time, duration || time));
  }
  const cache = state.videoCache;
  if (!cache) {
    elements.videoCacheStatus.textContent = "正在准备缓存…";
  } else if (cache.transcoding) {
    elements.videoCacheStatus.textContent = "浏览器不支持原编码，正在转换为 H.264…";
  } else if (cache.compatible) {
    elements.videoCacheStatus.textContent = "已转换为 H.264 兼容格式";
  } else if (cache.local) {
    elements.videoCacheStatus.textContent = "本地文件";
  } else if (cache.cached) {
    elements.videoCacheStatus.textContent = "已缓存，可流畅逐帧";
  } else if (cache.error) {
    elements.videoCacheStatus.textContent = `缓存失败：${cache.error}`;
  } else {
    const total = Number(cache.total) || 0;
    const received = Number(cache.received) || 0;
    const percent = total > 0 ? Math.min(100, received / total * 100) : 0;
    const speed = Number(cache.speed) || 0;
    elements.videoCacheStatus.textContent =
      `正在缓存 ${formatBytes(received)}` +
      `${total ? ` / ${formatBytes(total)} (${percent.toFixed(0)}%)` : ""}` +
      `${speed > 0 ? ` · ${formatBytes(speed)}/s` : ""}`;
  }
}

function releaseVideoHold(direction = null) {
  if (direction !== null && state.videoHoldDirection !== direction) return;
  state.videoHoldDirection = 0;
}

function currentVideoFrame() {
  if (Number.isFinite(state.videoShownFrame)) return state.videoShownFrame;
  return frameIndexAtTime(elements.videoPlayer.currentTime || 0);
}

async function presentVideoFrame(frame, token) {
  const video = elements.videoPlayer;
  const timing = activeVideoTiming();
  if (!video.src || !timing || token !== state.videoStepToken) return false;
  video.pause();
  const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
  const maxFrame = timing.frameCount - 1;
  const next = Math.min(maxFrame, Math.max(0, frame));
  if (next === currentVideoFrame()) return false;
  const frameStart = timeAtFrame(next);
  const frameDuration = Math.max(0.001, timeAtFrame(next + 1) - frameStart);
  const time = Math.min(
    Math.max(0, duration - 0.001),
    frameStart + frameDuration * 0.5,
  );
  state.videoShownFrame = next;
  state.videoRequestedTime = time;
  updateVideoHud();
  if (state.videoSourceTransition && video.readyState === 0) return true;
  await new Promise((resolve) => {
    let settled = false;
    const tolerance = Math.max(0.02, frameDuration * 0.6);
    const finish = () => {
      if (settled) return;
      const landed = video.currentTime || 0;
      if (video.seeking || Math.abs(landed - time) > tolerance) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", finish);
      resolve();
    }, 300);
    video.addEventListener("seeked", finish);
    const current = video.currentTime || 0;
    if (Math.abs(current - time) <= tolerance && !video.seeking) finish();
    else video.currentTime = time;
  });
  if (token !== state.videoStepToken) return false;
  if (video.requestVideoFrameCallback) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 80);
      video.requestVideoFrameCallback(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (token !== state.videoStepToken) return false;
  state.videoShownFrame = next;
  updateVideoHud();
  return true;
}

function beginVideoFrameHold(direction) {
  const token = ++state.videoStepToken;
  state.videoHoldDirection = direction;
  const run = async () => {
    await presentVideoFrame(currentVideoFrame() + direction, token);
    if (token !== state.videoStepToken || state.videoHoldDirection !== direction) return;
    await delay(240);
    if (token !== state.videoStepToken || state.videoHoldDirection !== direction) return;
    await playVideoAtDoubleSpeed(direction, token);
  };
  run();
}

async function playVideoAtDoubleSpeed(direction, token) {
  const video = elements.videoPlayer;
  const restore = () => {
    state.videoFastPlayback = false;
    video.playbackRate = 1;
    if (!video.paused) video.pause();
    state.videoShownFrame = frameIndexAtTime(video.currentTime || 0);
    updateVideoHud();
  };
  state.videoShownFrame = null;
  state.videoFastPlayback = true;
  try {
    if (direction > 0) {
      video.playbackRate = 2;
      await video.play().catch(() => {});
      while (
        token === state.videoStepToken &&
        state.videoHoldDirection === direction &&
        !video.ended
      ) {
        await delay(50);
      }
      return;
    }
    const started = performance.now();
    const origin = video.currentTime || 0;
    while (token === state.videoStepToken && state.videoHoldDirection === direction) {
      const elapsed = (performance.now() - started) / 1000;
      const target = Math.max(0, origin - elapsed * 2);
      state.videoShownFrame = frameIndexAtTime(target);
      updateVideoHud();
      if (!video.seeking) video.currentTime = target;
      if (target <= 0) break;
      await delay(50);
    }
  } finally {
    if (token === state.videoStepToken) restore();
  }
}

async function useCachedVideo(entry, time, paused, token) {
  const video = elements.videoPlayer;
  state.videoUsingCache = true;
  state.videoRequestedTime = Number.isFinite(state.videoRequestedTime)
    ? state.videoRequestedTime
    : time;
  state.videoSourceTransition = "cache";
  try {
    await new Promise((resolve) => {
      const finish = () => {
        video.removeEventListener("loadedmetadata", finish);
        resolve();
      };
      video.addEventListener("loadedmetadata", finish);
      video.src = apiUrl("/api/file", { id: entry.id, media: "cache" });
    });
    if (token !== state.videoCacheToken || state.currentFileEntry?.id !== entry.id) return;
    const targetTime = Number(state.videoRequestedTime) || 0;
    if (targetTime > 0 && Number.isFinite(video.duration)) {
      await new Promise((resolve) => {
        const finish = () => {
          video.removeEventListener("seeked", finish);
          resolve();
        };
        video.addEventListener("seeked", finish);
        video.currentTime = Math.min(targetTime, Math.max(0, video.duration - 0.001));
      });
    }
    if (token !== state.videoCacheToken || state.currentFileEntry?.id !== entry.id) return;
    if (!paused) video.play().catch(() => {});
    updateVideoHud();
  } finally {
    if (state.videoSourceTransition === "cache") state.videoSourceTransition = "";
  }
}

function watchVideoCache(entry) {
  const token = state.videoCacheToken;
  let sample = null;
  const tick = async () => {
    if (token !== state.videoCacheToken || state.currentFileEntry?.id !== entry.id) return;
    try {
      const status = await api("/api/file-cache", { id: entry.id }, 0, 0);
      if (token !== state.videoCacheToken || state.currentFileEntry?.id !== entry.id) return;
      const now = performance.now();
      const received = Number(status.received) || 0;
      if (sample && now > sample.time && received >= sample.received) {
        status.speed = (received - sample.received) * 1000 / (now - sample.time);
      }
      sample = { received, time: now };
      state.videoCache = status;
      updateVideoHud();
      if (status.local) {
        state.videoUsingCache = true;
        return;
      }
      if (status.cached && !state.videoUsingCache) {
        const video = elements.videoPlayer;
        await useCachedVideo(entry, video.currentTime || 0, video.paused, token);
        if (!state.videoTiming || state.videoTiming.estimated) loadVideoTiming(entry, token);
        return;
      }
      if (status.cached || status.local) {
        if (!state.videoTiming || state.videoTiming.estimated) loadVideoTiming(entry, token);
      }
      if (status.cached) return;
    } catch (error) {
      if (token !== state.videoCacheToken) return;
      state.videoCache = { error: error.message || "缓存状态读取失败" };
      updateVideoHud();
    }
    state.videoCacheTimer = setTimeout(tick, 400);
  };
  tick();
}

function observeVideoFrameRate() {
  const video = elements.videoPlayer;
  if (!video.requestVideoFrameCallback || state.videoFpsLocked) return;
  if (!state.videoTimingResolved) return;
  if (state.videoTiming && !state.videoTiming.estimated) return;
  let previous = null;
  const samples = [];
  const sample = (_now, metadata) => {
    if (
      elements.videoPreview.classList.contains("hidden") ||
      state.videoFpsLocked ||
      (state.videoTiming && !state.videoTiming.estimated)
    ) return;
    const delta = previous == null ? 0 : metadata.mediaTime - previous;
    previous = metadata.mediaTime;
    if (delta >= 1 / 240 && delta <= 1) samples.push(1 / delta);
    if (samples.length < 8) {
      if (!video.paused) video.requestVideoFrameCallback(sample);
      return;
    }
    const sorted = samples.toSorted((left, right) => left - right);
    const fps = sorted[Math.floor(sorted.length / 2)];
    const duration = video.duration;
    const frameCount = Number.isFinite(duration) ? Math.max(1, Math.round(duration * fps)) : 0;
    applyVideoTiming({
      fps,
      frameCount,
      timescale: 1000000,
      runs: frameCount ? [{ count: frameCount, delta: 1000000 / fps }] : [],
      estimated: true,
    });
  };
  video.requestVideoFrameCallback(sample);
}

function switchToCompatibleVideo(entry) {
  if (state.videoFallbackAttempted || state.currentFileEntry?.id !== entry.id) return;
  state.videoFallbackAttempted = true;
  state.videoUsingCompatible = true;
  if (!Number.isFinite(state.videoRequestedTime)) {
    state.videoRequestedTime = elements.videoPlayer.currentTime || 0;
  }
  state.videoSourceTransition = "compatible";
  state.videoCache = {
    ...(state.videoCache || {}),
    transcoding: true,
    error: "",
  };
  updateVideoHud();
  elements.videoPlayer.src = apiUrl("/api/video-compatible", { id: entry.id });
  elements.videoPlayer.load();
}

function handleVideoPlaybackError() {
  if (elements.videoPreview.classList.contains("hidden")) return;
  const entry = state.currentFileEntry;
  if (!entry || formattedFileKind(entry) !== "video") return;
  if (!state.videoFallbackAttempted) {
    switchToCompatibleVideo(entry);
    return;
  }
  state.videoCache = {
    ...(state.videoCache || {}),
    transcoding: false,
    error: "原视频编码不受浏览器支持，兼容格式转换失败",
  };
  state.videoSourceTransition = "";
  updateVideoHud();
}

async function openVideoPreview(entry) {
  stopVideoPlayback();
  const token = state.videoCacheToken;
  state.videoFpsLocked = false;
  elements.videoFps.value = "";
  elements.videoPreview.classList.remove("hidden");
  elements.formattedFileLoading.classList.add("hidden");
  elements.videoPlayer.preload = "metadata";
  try {
    const status = await api("/api/file-cache", { id: entry.id }, 0, 0);
    if (token !== state.videoCacheToken || state.currentFileEntry?.id !== entry.id) return;
    state.videoCache = status;
    state.videoUsingCache = Boolean(status.cached || status.local);
    elements.videoPlayer.src = apiUrl("/api/file", {
      id: entry.id,
      ...(status.cached && !status.local ? { media: "cache" } : {}),
    });
    updateVideoHud();
    loadVideoTiming(entry, token);
    if (!state.videoUsingCache) watchVideoCache(entry);
  } catch (error) {
    if (token !== state.videoCacheToken || state.currentFileEntry?.id !== entry.id) return;
    state.videoCache = { error: error.message || "缓存状态读取失败" };
    elements.videoPlayer.src = apiUrl("/api/file", { id: entry.id });
    updateVideoHud();
  }
}

function closeFileViewer(showDirectory = true) {
  if (elements.fileView.classList.contains("hidden")) return;
  clearTextAutoSave();
  state.filePreviewController?.abort();
  state.filePreviewController = null;
  state.currentFileEntry = null;
  state.currentFileText = null;
  state.currentFileTextTruncated = false;
  state.currentFileWritable = false;
  state.currentFileReadOnlyView = false;
  state.textEditMode = false;
  state.textDirty = false;
  state.textSaving = false;
  elements.copyFileTextButton.classList.add("hidden");
  elements.textEditControls.classList.add("hidden");
  elements.textEditor.classList.add("hidden");
  elements.fileFrame.src = "about:blank";
  delete elements.fileFrame.dataset.renderEntry;
  elements.markdownPreview.replaceChildren();
  elements.jsonPreview.querySelector("code").replaceChildren();
  elements.codePreview.querySelector("code").replaceChildren();
  elements.codeLineNumbers.replaceChildren();
  elements.officePreview.replaceChildren();
  stopVideoPlayback();
  elements.fileView.classList.add("hidden");
  if (showDirectory) {
    if (state.targetType === "file") showHome();
    else showGallery();
  }
}

function hideViewerLoading() {
  clearTimeout(state.viewerLoadingTimer);
  state.viewerLoadingTimer = null;
  elements.viewerLoading.classList.add("hidden");
}

function showViewerLoadingAfterDelay(requestId, milliseconds = 180) {
  hideViewerLoading();
  state.viewerLoadingTimer = setTimeout(() => {
    state.viewerLoadingTimer = null;
    if (
      requestId === state.viewerRequestId &&
      !elements.viewerView.classList.contains("hidden")
    ) {
      elements.viewerLoading.classList.remove("hidden");
    }
  }, milliseconds);
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
    hideViewerLoading();
    if (!state.viewerImageUrl) {
      const image = state.images[state.currentIndex];
      if (image) state.readyThumbnails.add(image.id);
      elements.viewerNotice.classList.remove("hidden");
    }
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

function releaseViewerObjectUrl() {
  state.viewerFetchController?.abort();
  state.viewerFetchController = null;
  if (state.viewerObjectUrl) URL.revokeObjectURL(state.viewerObjectUrl);
  state.viewerObjectUrl = "";
}

function setViewerProgress(percent, label) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  elements.viewerProgress.style.setProperty("--progress", value.toFixed(1));
  elements.viewerProgressText.textContent = label || `${Math.round(value)}%`;
  elements.viewerNoticeProgress.style.setProperty("--progress", value.toFixed(1));
  elements.viewerNoticeProgressText.textContent = label || `${Math.round(value)}%`;
}

function setViewerProgressText(text) {
  elements.viewerLoadingText.textContent = text;
  elements.viewerNoticeText.textContent = text;
}

async function receiveViewerImage(url, requestId) {
  releaseViewerObjectUrl();
  const controller = new AbortController();
  state.viewerFetchController = controller;
  const response = await fetch(url, {
    signal: controller.signal,
    cache: "force-cache",
  });
  if (!response.ok) throw new Error(`清晰图片接收失败 (${response.status})`);
  const total = Number(response.headers.get("Content-Length")) || 0;
  if (!response.body) {
    setViewerProgress(0, "接收");
    const blob = await response.blob();
    setViewerProgress(100);
    const objectUrl = URL.createObjectURL(blob);
    state.viewerObjectUrl = objectUrl;
    return objectUrl;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let lastBytes = 0;
  let lastTime = performance.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (requestId !== state.viewerRequestId) {
      controller.abort();
      throw new DOMException("图片浏览已取消", "AbortError");
    }
    chunks.push(value);
    received += value.byteLength;
    const now = performance.now();
    if (lastBytes === 0 || now - lastTime >= 250) {
      const bytesPerSecond =
        (received - lastBytes) * 1000 / Math.max(1, now - lastTime);
      setViewerProgressText(
        `正在接收清晰图片：${formatBytes(received)}` +
        `${total ? ` / ${formatBytes(total)}` : ""} · ` +
        `${formatBytes(bytesPerSecond)}/s`,
      );
      if (total) setViewerProgress(received / total * 100);
      else setViewerProgress(0, "接收");
      lastBytes = received;
      lastTime = now;
    }
  }
  if (requestId !== state.viewerRequestId) {
    throw new DOMException("图片浏览已取消", "AbortError");
  }
  const blob = new Blob(chunks, {
    type: response.headers.get("Content-Type") || "application/octet-stream",
  });
  setViewerProgress(100);
  const objectUrl = URL.createObjectURL(blob);
  state.viewerObjectUrl = objectUrl;
  state.viewerFetchController = null;
  return objectUrl;
}

function imageProgressId() {
  return globalThis.crypto?.randomUUID?.().replaceAll("-", "") ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

async function trackBrowserImageProgress(progressId, requestId, control) {
  const startedAt = performance.now();
  let lastReceived = 0;
  let lastSampleAt = startedAt;
  while (!control.stopped && requestId === state.viewerRequestId) {
    try {
      const response = await fetch(apiUrl("/api/browser-image-progress", { progressId }), {
        cache: "no-store",
      });
      if (response.ok) {
        const progress = await response.json();
        if (control.stopped || requestId !== state.viewerRequestId) return;
        const now = performance.now();
        const elapsed = Math.max(0.1, (now - startedAt) / 1000);
        let text = `${progress.label || "正在准备图片"} · ${elapsed.toFixed(1)} 秒`;
        if (
          ["download", "resize-read"].includes(progress.phase) &&
          Number(progress.total) > 0
        ) {
          const received = Math.max(0, Number(progress.received) || 0);
          const total = Number(progress.total);
          const percent = Math.min(100, received / total * 100);
          const speed = (received - lastReceived) * 1000 /
            Math.max(1, now - lastSampleAt);
          text =
            `${progress.label}：${formatBytes(received)} / ${formatBytes(total)}` +
            ` (${percent.toFixed(1)}%)` +
            `${speed > 0 ? ` · ${formatBytes(speed)}/s` : ""}`;
          setViewerProgress(percent);
          lastReceived = received;
          lastSampleAt = now;
        } else if (progress.phase === "encode") {
          setViewerProgress(100, "编码");
        } else if (progress.phase === "metadata") {
          setViewerProgress(0, "分析");
        } else if (progress.phase === "queued") {
          setViewerProgress(0, "等待");
        } else if (progress.phase === "remote") {
          setViewerProgress(0, "远程");
        } else if (progress.phase === "ready") {
          setViewerProgress(100);
        }
        setViewerProgressText(text);
        if (progress.done) return;
      }
    } catch {
      // The primary image request owns reconnect and error handling.
    }
    await delay(250);
  }
}

async function openViewer(recoveryAttempt = 0) {
  const image = state.images[state.currentIndex];
  if (!image) return;
  const requestId = ++state.viewerRequestId;
  releaseViewerObjectUrl();
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
  showViewerLoadingAfterDelay(requestId);
  setViewerProgress(0);
  elements.viewerLoadingText.textContent = "正在打开图片…";
  elements.viewerNoticeProgress.classList.remove("hidden");
  elements.viewerNoticeText.textContent = "正在后台准备清晰浏览图…";
  elements.viewerNotice.classList.toggle(
    "hidden",
    !state.readyThumbnails.has(image.id),
  );
  elements.viewerError.classList.add("hidden");
  elements.viewerName.textContent = image.relativePath;
  elements.viewerMeta.textContent =
    `${state.currentIndex + 1} / ${state.images.length} · ${formatBytes(image.size)}`;

  const viewer = createViewer();
  if (exceedsPreviewLimit(image.size, state.maxPreviewBytes)) {
    hideViewerLoading();
    elements.viewerNotice.classList.add("hidden");
    elements.viewerError.textContent =
      `图片大小为 ${formatBytes(image.size)}，超过通用预览上限 ` +
      `${formatBytes(state.maxPreviewBytes)}。可在通用设置调整限制，` +
      "或使用右键菜单下载原图。";
    elements.viewerError.classList.remove("hidden");
    return;
  }
  viewer.open({
    type: "image",
    url: apiUrl("/api/thumbnail", { id: image.id }),
    buildPyramid: false,
  });

  try {
    const progressId = imageProgressId();
    const progressControl = { stopped: false };
    const progressTracking = trackBrowserImageProgress(
      progressId,
      requestId,
      progressControl,
    );
    const prepared = await api("/api/browser-image-info", {
      id: image.id,
      maxDimension: String(browserMaxImageDimension()),
      progressId,
    }, 0, 4, (attempt) => {
      if (requestId !== state.viewerRequestId) return;
      elements.viewerLoading.classList.remove("hidden");
      setViewerProgress(0, "重连");
      setViewerProgressText(
        `连接中断，正在自动重连（${attempt}/4）；缩略图仍可浏览。`,
      );
      elements.viewerNotice.classList.remove("hidden");
    });
    progressControl.stopped = true;
    await progressTracking;
    if (
      requestId !== state.viewerRequestId ||
      elements.viewerView.classList.contains("hidden")
    ) return;
    const imageUrl = prepared.resized
      ? apiUrl(`/api/browser-image/${prepared.key}.${prepared.format}`)
      : apiUrl("/api/file", { id: image.id });
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
    setViewerProgress(0);
    setViewerProgressText("正在接收清晰图片…");
    const receivedImageUrl = await receiveViewerImage(imageUrl, requestId);
    if (
      requestId !== state.viewerRequestId ||
      elements.viewerView.classList.contains("hidden")
    ) return;
    state.viewerImageUrl = receivedImageUrl;
    setViewerProgress(100, "解码");
    setViewerProgressText("正在解码清晰图片…");
    const removePreparedHandlers = () => {
      viewer.removeHandler("open", handlePreparedOpen);
      viewer.removeHandler("open-failed", handlePreparedFailure);
    };
    const handlePreparedOpen = () => {
      removePreparedHandlers();
      if (requestId !== state.viewerRequestId) return;
      hideViewerLoading();
      elements.viewerNoticeProgress.classList.add("hidden");
      elements.viewerNoticeText.textContent = preparedNotice;
      elements.viewerNotice.classList.toggle("hidden", !preparedNotice);
    };
    const handlePreparedFailure = async (event) => {
      removePreparedHandlers();
      if (requestId !== state.viewerRequestId) return;
      if (recoveryAttempt < 3 && IS_EXTENSION) {
        elements.viewerLoading.classList.remove("hidden");
        setViewerProgress(0, "重连");
        setViewerProgressText(
          `清晰图片连接中断，正在恢复（${recoveryAttempt + 1}/3）…`,
        );
        if (await connectServer(true)) {
          await delay(300 * (recoveryAttempt + 1));
          if (requestId === state.viewerRequestId) {
            openViewer(recoveryAttempt + 1);
          }
          return;
        }
      }
      hideViewerLoading();
      elements.viewerError.textContent =
        `清晰图片加载失败：${event?.message || "连接无法恢复"}`;
      elements.viewerError.classList.remove("hidden");
    };
    viewer.addHandler("open", handlePreparedOpen);
    viewer.addHandler("open-failed", handlePreparedFailure);
    viewer.open({
      type: "image",
      url: receivedImageUrl,
      buildPyramid: false,
    });
  } catch (error) {
    if (requestId !== state.viewerRequestId) return;
    if (error.name === "AbortError") return;
    if (recoveryAttempt < 3 && IS_EXTENSION) {
      elements.viewerLoading.classList.remove("hidden");
      setViewerProgress(0, "重连");
      setViewerProgressText(
        `图片接收中断，正在恢复（${recoveryAttempt + 1}/3）…`,
      );
      if (await connectServer(true)) {
        await delay(300 * (recoveryAttempt + 1));
        if (requestId === state.viewerRequestId) {
          openViewer(recoveryAttempt + 1);
        }
        return;
      }
    }
    hideViewerLoading();
    elements.viewerError.textContent = state.readyThumbnails.has(image.id)
      ? `清晰图片加载失败，当前显示缩略图：${error.message}`
      : error.message;
    elements.viewerError.classList.remove("hidden");
  }
}

function closeViewer(updateRoute = true) {
  if (elements.viewerView.classList.contains("hidden")) return;
  state.viewerRequestId += 1;
  hideViewerLoading();
  releaseViewerObjectUrl();
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
  location.href = globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL("options.html")
    : "/options.html";
});
elements.backButton.addEventListener("click", navigateDirectoryUp);
elements.directoryUpButton.addEventListener("click", navigateDirectoryUp);
elements.directoryRefreshButton.addEventListener("click", refreshCurrentDirectory);
elements.uploadButton.addEventListener("click", (event) => {
  event.stopPropagation();
  state.uploadPickerTarget = state.selectedDirectory;
  elements.uploadMenu.classList.toggle("hidden");
});
elements.uploadFilesButton.addEventListener("click", () => {
  elements.uploadMenu.classList.add("hidden");
  elements.uploadFilesInput.click();
});
elements.uploadDirectoryButton.addEventListener("click", () => {
  elements.uploadMenu.classList.add("hidden");
  elements.uploadDirectoryInput.click();
});
elements.uploadFilesInput.addEventListener("change", async () => {
  const target = state.uploadPickerTarget || state.selectedDirectory;
  const items = uploadItemsFromFileList(elements.uploadFilesInput.files);
  elements.uploadFilesInput.value = "";
  await uploadFilesToSshNode(target, items);
});
elements.uploadDirectoryInput.addEventListener("change", async () => {
  const target = state.uploadPickerTarget || state.selectedDirectory;
  const items = uploadItemsFromFileList(elements.uploadDirectoryInput.files);
  elements.uploadDirectoryInput.value = "";
  await uploadFilesToSshNode(target, items);
});
elements.downloadDirectoryButton.addEventListener("click", downloadSelectedItems);
elements.copySelectedPathsButton.addEventListener("click", copySelectedPaths);
elements.deleteSelectedButton.addEventListener("click", deleteSelectedItems);
elements.clearSelectionButton.addEventListener("click", clearSelection);
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
elements.copyFileTextButton.addEventListener("click", copyCurrentFileText);
elements.copyFilePathButton.addEventListener("click", () => {
  if (state.currentFileEntry) {
    copyPath(entryPathForCopy(state.currentFileEntry), "文件");
  }
});
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
elements.editTextButton.addEventListener("click", async () => {
  try {
    await setTextEditMode(!state.textEditMode);
  } catch (error) {
    showToast(`无法进入编辑模式：${error.message}`);
  }
});
elements.saveTextButton.addEventListener("click", saveCurrentText);
elements.textSaveMode.addEventListener("change", async (event) => {
  state.textSaveMode = event.currentTarget.value === "auto" ? "auto" : "manual";
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ textSaveMode: state.textSaveMode });
  } else {
    localStorage.setItem("textSaveMode", state.textSaveMode);
  }
  updateTextSaveControls();
  if (state.textSaveMode === "auto") scheduleTextAutoSave();
  else clearTextAutoSave();
});
elements.textEditorInput.addEventListener("input", () => {
  state.currentFileText = elements.textEditorInput.value;
  state.textDirty = true;
  state.textEditVersion += 1;
  updateTextEditorLineNumbers();
  updateTextSaveControls();
  scheduleTextAutoSave();
});
elements.textEditorInput.addEventListener("scroll", () => {
  elements.textEditorLineNumbers.scrollTop = elements.textEditorInput.scrollTop;
});
elements.textEditorInput.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart;
    input.setRangeText("  ", start, input.selectionEnd, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (
    event.key.toLocaleLowerCase() === "s" &&
    (event.metaKey || event.ctrlKey)
  ) {
    event.preventDefault();
    saveCurrentText();
  }
});
elements.videoPlayer.addEventListener("loadedmetadata", () => {
  if (state.videoUsingCompatible) {
    state.videoCache = {
      ...(state.videoCache || {}),
      transcoding: false,
      compatible: true,
      cached: true,
      error: "",
    };
    if (state.videoSourceTransition === "compatible") {
      const targetTime = Number(state.videoRequestedTime) || 0;
      if (targetTime > 0 && Number.isFinite(elements.videoPlayer.duration)) {
        const target = Math.min(
          targetTime,
          Math.max(0, elements.videoPlayer.duration - 0.001),
        );
        if (Math.abs((elements.videoPlayer.currentTime || 0) - target) > 0.001) {
          elements.videoPlayer.addEventListener("seeked", () => {
            if (state.videoSourceTransition === "compatible") {
              state.videoSourceTransition = "";
            }
          }, { once: true });
          elements.videoPlayer.currentTime = target;
        } else {
          state.videoSourceTransition = "";
        }
      } else {
        state.videoSourceTransition = "";
      }
    }
  }
  if (!state.videoTiming && state.videoTimingSource) {
    applyVideoTiming(state.videoTimingSource);
  }
  const entry = state.currentFileEntry;
  if (
    entry &&
    !state.videoTiming &&
    (state.videoCache?.local || state.videoCache?.cached)
  ) {
    loadVideoTiming(entry, state.videoCacheToken);
  }
  updateVideoHud();
});
elements.videoPlayer.addEventListener("error", handleVideoPlaybackError);
elements.videoPlayer.addEventListener("timeupdate", () => {
  if (!state.videoSourceTransition && !elements.videoPlayer.seeking) {
    state.videoRequestedTime = elements.videoPlayer.currentTime || 0;
  }
  updateVideoHud();
});
elements.videoPlayer.addEventListener("play", () => {
  state.videoShownFrame = null;
  if (!state.videoSourceTransition) {
    state.videoRequestedTime = elements.videoPlayer.currentTime || 0;
  }
  if (!state.videoFastPlayback) releaseVideoHold();
  updateVideoHud();
  observeVideoFrameRate();
});
elements.videoPlayer.addEventListener("pause", updateVideoHud);
elements.videoStage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  videoStagePointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: state.videoPanX,
    panY: state.videoPanY,
    moved: false,
  };
  elements.videoStage.setPointerCapture(event.pointerId);
});
elements.videoStage.addEventListener("pointermove", (event) => {
  if (!videoStagePointer || event.pointerId !== videoStagePointer.id) return;
  const dx = event.clientX - videoStagePointer.x;
  const dy = event.clientY - videoStagePointer.y;
  if (Math.hypot(dx, dy) < 4) return;
  videoStagePointer.moved = true;
  if (state.videoZoom <= 1) return;
  elements.videoStage.classList.add("panning");
  state.videoPanX = videoStagePointer.panX + dx;
  state.videoPanY = videoStagePointer.panY + dy;
  clampVideoPan();
  applyVideoZoom();
});
const finishVideoStagePointer = (event) => {
  if (!videoStagePointer || event.pointerId !== videoStagePointer.id) return;
  const moved = videoStagePointer.moved;
  videoStagePointer = null;
  elements.videoStage.classList.remove("panning");
  if (moved) return;
  clearTimeout(videoStageClickTimer);
  videoStageClickTimer = setTimeout(() => {
    videoStageClickTimer = null;
    releaseVideoHold();
    const video = elements.videoPlayer;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, 220);
};
elements.videoStage.addEventListener("pointerup", finishVideoStagePointer);
elements.videoStage.addEventListener("pointercancel", (event) => {
  if (!videoStagePointer || event.pointerId !== videoStagePointer.id) return;
  videoStagePointer = null;
  elements.videoStage.classList.remove("panning");
});
elements.videoStage.addEventListener("dblclick", (event) => {
  event.preventDefault();
  clearTimeout(videoStageClickTimer);
  videoStageClickTimer = null;
  resetVideoZoom();
});
elements.videoStage.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomVideoAt(
      event.clientX,
      event.clientY,
      state.videoZoom * Math.exp(-delta * 0.0015),
    );
  },
  { passive: false },
);
new ResizeObserver(() => {
  clampVideoPan();
  applyVideoZoom();
}).observe(elements.videoStage);

function videoFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function syncVideoFullscreenButton() {
  const active = videoFullscreenElement() === elements.videoPreview;
  elements.videoFullscreen.textContent = active ? "退出全屏" : "全屏";
  elements.videoFullscreen.title = active ? "退出全屏（F 或 Esc）" : "全屏（F）";
  elements.videoFullscreen.setAttribute("aria-pressed", String(active));
}

async function toggleVideoFullscreen() {
  const preview = elements.videoPreview;
  if (videoFullscreenElement() === preview) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) await exit.call(document);
    return;
  }
  const request = preview.requestFullscreen || preview.webkitRequestFullscreen;
  if (!request) return;
  try {
    await request.call(preview);
  } catch {
    window.parent?.postMessage({ type: "remotefs-overlay", action: "maximize" }, "*");
  }
}

elements.videoZoomIn.addEventListener("click", () => zoomVideoBy(1.25));
elements.videoZoomOut.addEventListener("click", () => zoomVideoBy(0.8));
elements.videoZoomReset.addEventListener("click", resetVideoZoom);
elements.videoFullscreen.addEventListener("click", () => {
  toggleVideoFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", syncVideoFullscreenButton);
document.addEventListener("webkitfullscreenchange", syncVideoFullscreenButton);
elements.videoPlayButton.addEventListener("click", () => {
  releaseVideoHold();
  const video = elements.videoPlayer;
  if (video.paused) video.play().catch(() => {});
  else video.pause();
});
const bindVideoFrameButton = (button, direction) => {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    beginVideoFrameHold(direction);
  });
  const release = () => releaseVideoHold(direction);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
};
bindVideoFrameButton(elements.videoPreviousFrame, -1);
bindVideoFrameButton(elements.videoNextFrame, 1);
elements.videoFps.addEventListener("change", () => {
  state.videoFpsLocked = true;
  updateVideoHud();
});
elements.videoTimeline.addEventListener("pointerdown", () => {
  state.videoScrubbing = true;
});
elements.videoTimeline.addEventListener("input", () => {
  state.videoShownFrame = null;
  releaseVideoHold();
  elements.videoPlayer.pause();
  state.videoRequestedTime = Number(elements.videoTimeline.value) || 0;
  elements.videoPlayer.currentTime = state.videoRequestedTime;
  updateVideoHud();
});
const finishVideoScrub = () => {
  state.videoScrubbing = false;
};
elements.videoTimeline.addEventListener("change", finishVideoScrub);
elements.videoTimeline.addEventListener("pointerup", finishVideoScrub);
elements.videoTimeline.addEventListener("pointercancel", finishVideoScrub);
elements.closeViewerButton.addEventListener("click", closeViewer);
elements.viewerHomeButton.addEventListener("click", showHome);
elements.previousButton.addEventListener("click", () => moveImage(-1));
elements.nextButton.addEventListener("click", () => moveImage(1));
elements.fitButton.addEventListener("click", () => state.viewer?.viewport.goHome());
elements.actualButton.addEventListener("click", () => {
  const zoom = state.viewer?.viewport.imageToViewportZoom(1);
  if (zoom) state.viewer.viewport.zoomTo(zoom);
});

document.addEventListener("click", (event) => {
  if (!elements.uploadActions.contains(event.target)) {
    elements.uploadMenu.classList.add("hidden");
  }
  if (!elements.treeContextMenu.contains(event.target)) hideTreeContextMenu();
});
document.addEventListener("contextmenu", (event) => {
  if (!elements.directoryTree.contains(event.target)) hideTreeContextMenu();
});
window.addEventListener("blur", hideTreeContextMenu);
window.addEventListener("resize", hideTreeContextMenu);
document.addEventListener("scroll", hideTreeContextMenu, true);
window.addEventListener("beforeunload", (event) => {
  if (!state.textDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

elements.fileWorkspace.addEventListener("dragover", (event) => {
  if (
    !event.dataTransfer?.types?.includes("Files") ||
    !isSshDirectoryNode(state.selectedDirectory)
  ) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  elements.uploadDropOverlay.classList.remove("hidden");
});
elements.fileWorkspace.addEventListener("dragleave", (event) => {
  if (!elements.fileWorkspace.contains(event.relatedTarget)) {
    elements.uploadDropOverlay.classList.add("hidden");
  }
});
elements.fileWorkspace.addEventListener("drop", async (event) => {
  if (!isSshDirectoryNode(state.selectedDirectory)) return;
  event.preventDefault();
  elements.uploadDropOverlay.classList.add("hidden");
  const items = await uploadItemsFromDataTransfer(event.dataTransfer);
  await uploadFilesToSshNode(state.selectedDirectory, items);
});

document.addEventListener("paste", async (event) => {
  if (
    elements.galleryView.classList.contains("hidden") ||
    !elements.fileView.classList.contains("hidden") ||
    !elements.viewerView.classList.contains("hidden") ||
    !isSshDirectoryNode(state.selectedDirectory) ||
    document.activeElement?.matches("input, textarea, [contenteditable='true']")
  ) return;
  const clipboardItem = [...(event.clipboardData?.items || [])].find(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
  if (!clipboardItem) return;
  const source = clipboardItem.getAsFile();
  if (!source) return;
  event.preventDefault();
  try {
    const jpeg = await clipboardImageAsJpeg(source);
    const name = pastedImageName();
    const file = new File([jpeg], name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    await uploadFilesToSshNode(state.selectedDirectory, [{
      file,
      relativePath: name,
    }]);
  } catch (error) {
    showUploadStatus(`粘贴图片失败：${error.message}`, true);
  }
});

function updateDirectorySelectionModifier(event) {
  elements.directoryTree.classList.toggle(
    "selection-modifier-active",
    elements.directoryTree.matches(":hover") &&
      (event.ctrlKey || event.metaKey || event.shiftKey),
  );
}

elements.directoryTree.addEventListener("pointerdown", (event) => {
  const target = event.target;
  const row = target.closest?.(".directory-row");
  if (!row) return;
  const selectionCheckbox = target.closest?.(".directory-selection-checkbox");
  const modifiedRowSelection =
    (event.ctrlKey || event.metaKey || event.shiftKey) &&
    !target.closest?.("button");
  if (
    event.button === 2 ||
    selectionCheckbox ||
    modifiedRowSelection
  ) {
    state.directorySelectionMode = true;
  }
});
document.addEventListener("keydown", updateDirectorySelectionModifier);
document.addEventListener("keyup", updateDirectorySelectionModifier);
elements.directoryTree.addEventListener("pointerenter", updateDirectorySelectionModifier);
elements.directoryTree.addEventListener("pointerleave", () => {
  elements.directoryTree.classList.remove("selection-modifier-active");
});
window.addEventListener("blur", () => {
  elements.directoryTree.classList.remove("selection-modifier-active");
});

document.addEventListener("keydown", (event) => {
  if (
    event.key.toLocaleLowerCase() !== "a" ||
    (!event.metaKey && !event.ctrlKey) ||
    elements.fileView.classList.contains("hidden") ||
    state.currentFileText === null
  ) return;
  const active = document.activeElement;
  if (
    active?.matches("input, textarea, [contenteditable='true']") ||
    !selectVisibleFileText()
  ) return;
  event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (
    elements.fileView.classList.contains("hidden") ||
    elements.videoPreview.classList.contains("hidden")
  ) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.closest("textarea, select") ||
      (target.closest("input") && target.id !== "videoTimeline"))
  ) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    beginVideoFrameHold(event.key === "ArrowLeft" ? -1 : 1);
  } else if (event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    releaseVideoHold();
    const video = elements.videoPlayer;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  } else if (
    event.key.toLowerCase() === "f" &&
    !event.repeat &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    event.stopPropagation();
    toggleVideoFullscreen().catch(() => {});
  }
}, true);

document.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft") releaseVideoHold(-1);
  if (event.key === "ArrowRight") releaseVideoHold(1);
});

window.addEventListener("blur", () => releaseVideoHold());

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
  if (area === "local" && changes.textSaveMode) {
    state.textSaveMode = changes.textSaveMode.newValue === "auto" ? "auto" : "manual";
    elements.textSaveMode.value = state.textSaveMode;
    if (state.textSaveMode === "auto") scheduleTextAutoSave();
    else clearTextAutoSave();
  }
  if (area === "local" && changes.textDefaultMode) {
    state.textDefaultMode =
      changes.textDefaultMode.newValue === "read" ? "read" : "edit";
  }
  if (area === "local" && changes.htmlDefaultViewMode) {
    state.htmlDefaultViewMode =
      changes.htmlDefaultViewMode.newValue === "source" ? "source" : "rendered";
  }
  if (area === "local" && changes.maxPreviewBytes) {
    const value = Number(changes.maxPreviewBytes.newValue);
    state.maxPreviewBytes =
      value === 0 || value >= 16 * 1024 * 1024
        ? value
        : 256 * 1024 * 1024;
  }
  if (area === "local" && changes.maxTextPreviewBytes) {
    const value = Number(changes.maxTextPreviewBytes.newValue);
    state.maxTextPreviewBytes =
      value >= 1024 * 1024 ? value : 2 * 1024 * 1024;
  }
});

setupSidebarResizer();
setupGalleryMarqueeSelection();
connectImageContextMenu();

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
