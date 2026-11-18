const STORAGE_URI_RE = /(?:s3|oss):\/\/[^\s<>"'`]+/gi;
const STORAGE_TRAILING_RE = /[.,;:!?，。；：、)）\]】}>»」』"']+$/u;
const seenShadows = new WeakSet();
const pendingRoots = new Set();
let scanScheduled = false;
let opening = false;

function normalizeStorageUri(raw) {
  let value = String(raw || "").trim();
  if (
    !/^(?:s3|oss):\/\//i.test(value) &&
    /^(?:s3|oss)%3A%2F%2F/i.test(value)
  ) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return "";
    }
  }
  let previous = "";
  while (value && value !== previous) {
    previous = value;
    value = value.replace(STORAGE_TRAILING_RE, "");
  }
  const match = value.match(/^(s3|oss):\/\/(.*)$/i);
  return match ? `${match[1].toLowerCase()}://${match[2]}` : "";
}

function extractStorageUris(text) {
  const matches = [];
  for (const match of String(text || "").matchAll(STORAGE_URI_RE)) {
    const uri = normalizeStorageUri(match[0]);
    if (!uri) continue;
    matches.push({
      uri,
      index: match.index,
      length: match[0].slice(0, uri.length).length,
    });
  }
  return matches;
}

function shouldSkipElement(element) {
  return Boolean(
    element.closest(
      "textarea, input, select, [contenteditable='true'], [contenteditable='']",
    ),
  );
}

function shouldSkipText(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(parent.tagName)) {
    return true;
  }
  return Boolean(
    parent.closest(
      "a, textarea, input, select, [contenteditable='true'], [contenteditable='']",
    ),
  );
}

function createStorageLink(uri, label) {
  const anchor = document.createElement("a");
  anchor.className = "multifunction-storage-link";
  anchor.dataset.multifunctionStorageUri = uri;
  anchor.href = "#";
  anchor.textContent = label;
  anchor.title = "在 RemoteFs Explorer 中打开";
  return anchor;
}

function replaceTextNode(node) {
  const matches = extractStorageUris(node.nodeValue);
  if (!matches.length || !node.parentNode) return;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    fragment.append(node.nodeValue.slice(cursor, match.index));
    const label = node.nodeValue.slice(match.index, match.index + match.length);
    fragment.append(createStorageLink(match.uri, label));
    cursor = match.index + match.length;
  }
  fragment.append(node.nodeValue.slice(cursor));
  node.parentNode.replaceChild(fragment, node);
}

function bindAnchors(root) {
  if (!root.querySelectorAll) return;
  const anchors = [
    ...(root.matches?.("a[href]") ? [root] : []),
    ...root.querySelectorAll("a[href]"),
  ];
  for (const anchor of anchors) {
    if (anchor.dataset.multifunctionStorageUri || shouldSkipElement(anchor)) continue;
    const uri = normalizeStorageUri(anchor.getAttribute("href"));
    if (!uri) continue;
    anchor.dataset.multifunctionStorageUri = uri;
    anchor.classList.add("multifunction-storage-link");
    anchor.title ||= "在 RemoteFs Explorer 中打开";
  }
}

function linkifyText(root) {
  const owner = root.nodeType === Node.TEXT_NODE
    ? root.parentNode
    : root.nodeType === Node.ELEMENT_NODE ||
        root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
      ? root
      : null;
  if (!owner) return;
  const nodes = [];
  const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !/(?:s3|oss):\/\//i.test(node.nodeValue)) {
        return NodeFilter.FILTER_REJECT;
      }
      return shouldSkipText(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) replaceTextNode(node);
}

function watchShadows(root) {
  if (!root.querySelectorAll) return;
  for (const element of root.querySelectorAll("*")) {
    const shadow = element.shadowRoot;
    if (!shadow || seenShadows.has(shadow)) continue;
    seenShadows.add(shadow);
    scanRoot(shadow);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scheduleScan(node);
          if (node.nodeType === Node.TEXT_NODE) scheduleScan(node.parentNode);
        }
      }
    }).observe(shadow, { childList: true, subtree: true });
  }
}

function scanRoot(root) {
  if (!root) return;
  bindAnchors(root);
  linkifyText(root);
  watchShadows(root);
}

function scheduleScan(root) {
  if (!root) return;
  pendingRoots.add(root);
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const node of roots) scanRoot(node);
  });
}

function uriFromElement(node) {
  if (!(node instanceof Element)) return "";
  return node.dataset?.multifunctionStorageUri ||
    normalizeStorageUri(node.getAttribute("href"));
}

function uriFromEvent(event) {
  const path = typeof event.composedPath === "function"
    ? event.composedPath()
    : [];
  for (const node of path) {
    const uri = uriFromElement(node);
    if (uri) return uri;
  }
  if (event.target instanceof Element) {
    return uriFromElement(event.target.closest("a[href]"));
  }
  return "";
}

function showStorageToast(message) {
  let toast = document.getElementById("multifunction-storage-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "multifunction-storage-toast";
    document.documentElement.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showStorageToast.timer);
  showStorageToast.timer = setTimeout(() => toast.classList.remove("visible"), 4200);
}

const OVERLAY_LAYOUT_KEY = "remotefs-overlay-layout";

function defaultOverlayBounds() {
  const margin = 24;
  const width = Math.min(1440, Math.max(320, window.innerWidth - margin * 2));
  const height = Math.min(920, Math.max(240, window.innerHeight - margin * 2));
  return {
    x: Math.max(0, (window.innerWidth - width) / 2),
    y: Math.max(0, (window.innerHeight - height) / 2),
    width,
    height,
    maximized: false,
  };
}

function readOverlayLayout() {
  try {
    const value = JSON.parse(sessionStorage.getItem(OVERLAY_LAYOUT_KEY) || "null");
    if (!value || typeof value !== "object") return null;
    if (![value.x, value.y, value.width, value.height].every(Number.isFinite)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function writeOverlayLayout(layout) {
  try {
    sessionStorage.setItem(OVERLAY_LAYOUT_KEY, JSON.stringify({
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      maximized: Boolean(layout.maximized),
      restore: layout.restore || null,
    }));
  } catch {
    // The host page can block storage; the current window still keeps its size.
  }
}

function clampOverlayBounds(bounds) {
  const minWidth = Math.min(420, Math.max(240, window.innerWidth));
  const minHeight = Math.min(280, Math.max(180, window.innerHeight));
  const width = Math.min(window.innerWidth, Math.max(minWidth, bounds.width));
  const height = Math.min(window.innerHeight, Math.max(minHeight, bounds.height));
  return {
    x: Math.min(Math.max(0, bounds.x), Math.max(0, window.innerWidth - width)),
    y: Math.min(Math.max(0, bounds.y), Math.max(0, window.innerHeight - height)),
    width,
    height,
    maximized: Boolean(bounds.maximized),
    restore: bounds.restore || null,
  };
}

function showStorageOverlay(url) {
  document.getElementById("remotefs-storage-overlay-host")?.remove();
  const host = document.createElement("div");
  host.id = "remotefs-storage-overlay-host";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .backdrop {
      position: fixed;
      z-index: 2147483647;
      inset: 0;
      background: rgba(3, 7, 18, .48);
      backdrop-filter: blur(3px);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .window {
      position: fixed;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 12px;
      background: #0b0f15;
      box-shadow: 0 28px 90px rgba(0, 0, 0, .58);
    }
    .window.maximized { border-radius: 0; }
    .titlebar {
      height: 42px;
      flex: 0 0 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-sizing: border-box;
      padding: 0 8px 0 15px;
      border-bottom: 1px solid rgba(255, 255, 255, .12);
      background: #151b25;
      color: #e7edf8;
      font-size: 13px;
      font-weight: 650;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    .window.maximized .titlebar,
    .window.interacting .titlebar { cursor: default; }
    .actions { display: flex; align-items: center; gap: 2px; }
    button {
      height: 30px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #b9c3d2;
      cursor: pointer;
      font: 650 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button.close {
      width: 30px;
      font-size: 22px;
      font-weight: 400;
    }
    button.resize-window { padding: 0 8px; }
    button:hover { background: rgba(255, 255, 255, .1); color: white; }
    iframe {
      width: 100%;
      min-height: 0;
      flex: 1 1 auto;
      border: 0;
      background: #0b0f15;
    }
    .window.interacting iframe { pointer-events: none; }
    .handle {
      position: absolute;
      z-index: 3;
      touch-action: none;
    }
    .handle.n { top: -4px; left: 14px; right: 14px; height: 10px; cursor: ns-resize; }
    .handle.s { bottom: -4px; left: 14px; right: 14px; height: 10px; cursor: ns-resize; }
    .handle.e { right: -4px; top: 14px; bottom: 14px; width: 10px; cursor: ew-resize; }
    .handle.w { left: -4px; top: 14px; bottom: 14px; width: 10px; cursor: ew-resize; }
    .handle.ne, .handle.nw, .handle.se, .handle.sw { width: 16px; height: 16px; }
    .handle.ne { top: -4px; right: -4px; cursor: nesw-resize; }
    .handle.nw { top: -4px; left: -4px; cursor: nwse-resize; }
    .handle.se { right: -4px; bottom: -4px; cursor: nwse-resize; }
    .handle.sw { left: -4px; bottom: -4px; cursor: nesw-resize; }
    .window.maximized .handle { display: none; }
  `;
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const panel = document.createElement("div");
  panel.className = "window";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "RemoteFs Explorer");
  const titlebar = document.createElement("div");
  titlebar.className = "titlebar";
  const title = document.createElement("span");
  title.textContent = "RemoteFs Explorer";
  const actions = document.createElement("div");
  actions.className = "actions";
  const maximizeButton = document.createElement("button");
  maximizeButton.type = "button";
  maximizeButton.className = "resize-window";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close";
  closeButton.title = "关闭";
  closeButton.setAttribute("aria-label", "关闭");
  closeButton.textContent = "×";
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "RemoteFs Explorer";
  frame.allow = "fullscreen";
  frame.allowFullscreen = true;
  let layout = clampOverlayBounds(readOverlayLayout() || defaultOverlayBounds());
  const applyBounds = () => {
    const bounds = layout.maximized
      ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
      : layout;
    panel.classList.toggle("maximized", layout.maximized);
    panel.style.left = `${bounds.x}px`;
    panel.style.top = `${bounds.y}px`;
    panel.style.width = `${bounds.width}px`;
    panel.style.height = `${bounds.height}px`;
    const label = layout.maximized ? "还原" : "放大";
    maximizeButton.textContent = label;
    maximizeButton.title = layout.maximized ? "还原窗口大小" : "放大到整个页面";
    maximizeButton.setAttribute("aria-label", maximizeButton.title);
    maximizeButton.setAttribute("aria-pressed", String(layout.maximized));
  };
  const toggleMaximize = () => {
    if (layout.maximized) {
      layout = clampOverlayBounds({
        ...(layout.restore || defaultOverlayBounds()),
        maximized: false,
        restore: null,
      });
    } else {
      layout = {
        ...layout,
        maximized: true,
        restore: {
          x: layout.x,
          y: layout.y,
          width: layout.width,
          height: layout.height,
        },
      };
    }
    applyBounds();
    writeOverlayLayout(layout);
  };
  const startDrag = (handle, mode, event) => {
    if (event.button !== 0 || layout.maximized) return;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const origin = {
      x: event.clientX,
      y: event.clientY,
      bounds: { ...layout },
    };
    panel.classList.add("interacting");
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const dx = moveEvent.clientX - origin.x;
      const dy = moveEvent.clientY - origin.y;
      const next = { ...origin.bounds, maximized: false, restore: null };
      if (mode === "move") {
        next.x += dx;
        next.y += dy;
      } else {
        if (mode.includes("e")) next.width += dx;
        if (mode.includes("s")) next.height += dy;
        if (mode.includes("w")) {
          next.x += dx;
          next.width -= dx;
        }
        if (mode.includes("n")) {
          next.y += dy;
          next.height -= dy;
        }
      }
      layout = clampOverlayBounds(next);
      applyBounds();
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      panel.classList.remove("interacting");
      writeOverlayLayout(layout);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };
  const close = () => {
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onViewportResize);
    window.removeEventListener("message", onFrameMessage);
    host.remove();
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onViewportResize = () => {
    layout = clampOverlayBounds(layout);
    applyBounds();
  };
  const onFrameMessage = (event) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type !== "remotefs-overlay" || event.data.action !== "maximize") return;
    if (!layout.maximized) toggleMaximize();
  };
  closeButton.addEventListener("click", close);
  maximizeButton.addEventListener("click", toggleMaximize);
  titlebar.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    startDrag(titlebar, "move", event);
  });
  titlebar.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    toggleMaximize();
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  frame.addEventListener("load", () => frame.focus());
  for (const mode of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    const handle = document.createElement("div");
    handle.className = `handle ${mode}`;
    handle.addEventListener("pointerdown", (event) => startDrag(handle, mode, event));
    panel.append(handle);
  }
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onViewportResize);
  window.addEventListener("message", onFrameMessage);
  actions.append(maximizeButton, closeButton);
  titlebar.append(title, actions);
  panel.append(titlebar, frame);
  backdrop.append(panel);
  shadow.append(style, backdrop);
  document.documentElement.append(host);
  applyBounds();
}

function onStorageMouseDown(event) {
  if (event.button !== 0 && event.button !== 1) return;
  if (!uriFromEvent(event)) return;
  event.preventDefault();
  event.stopPropagation();
}

async function onStorageActivate(event) {
  if (event.type === "auxclick" && event.button !== 1) return;
  if (event.type === "click" && event.button !== 0) return;
  const uri = uriFromEvent(event);
  if (!uri) return;
  event.preventDefault();
  event.stopPropagation();
  if (opening) return;
  opening = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "openObjectStorage",
      uri,
      disposition: event.type === "auxclick" ? "tab" : "default",
    });
    if (!result) {
      showStorageToast("插件后台尚未更新，请重新加载扩展并刷新当前网页");
    } else if (!result.ok) {
      showStorageToast(result.error || "无法打开 RemoteFs Explorer");
    } else if (result.overlayUrl) {
      showStorageOverlay(result.overlayUrl);
    }
  } catch (error) {
    const invalidated = /context invalidated|receiving end does not exist/i.test(
      error?.message || "",
    );
    showStorageToast(
      invalidated
        ? "插件刚刚更新，请刷新当前网页后重试"
        : `无法连接 RemoteFs Explorer：${error?.message || "未知错误"}`,
    );
  } finally {
    setTimeout(() => {
      opening = false;
    }, 600);
  }
}

scheduleScan(document.body || document.documentElement);
new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scheduleScan(node);
      if (node.nodeType === Node.TEXT_NODE) scheduleScan(node.parentNode);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("mousedown", onStorageMouseDown, true);
document.addEventListener("click", onStorageActivate, true);
document.addEventListener("auxclick", onStorageActivate, true);
