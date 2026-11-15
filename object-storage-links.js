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
  anchor.title = "在 AnyFs Browser 中打开";
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
    anchor.title ||= "在 AnyFs Browser 中打开";
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
    });
    if (!result) {
      showStorageToast("插件后台尚未更新，请重新加载扩展并刷新当前网页");
    } else if (!result.ok) {
      showStorageToast(result.error || "无法打开 AnyFs Browser");
    }
  } catch (error) {
    const invalidated = /context invalidated|receiving end does not exist/i.test(
      error?.message || "",
    );
    showStorageToast(
      invalidated
        ? "插件刚刚更新，请刷新当前网页后重试"
        : `无法连接 AnyFs Browser：${error?.message || "未知错误"}`,
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
