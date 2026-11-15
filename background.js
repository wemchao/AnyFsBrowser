chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("app.html");
  await chrome.windows.create({ url, type: "normal" });
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  await chrome.tabs.create({
    url: chrome.runtime.getURL("setup.html"),
    active: true,
  });
});

const OBJECT_STORAGE_TRAILING_RE = /[.,;:!?，。；：、)）\]】}>»」』"']+$/u;

function normalizeObjectStorageUri(raw) {
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
    value = value.replace(OBJECT_STORAGE_TRAILING_RE, "");
  }
  const match = value.match(/^(s3|oss):\/\/(.*)$/i);
  return match ? `s3://${match[2]}` : "";
}

function objectStorageAppUrl(raw) {
  const source = normalizeObjectStorageUri(raw);
  if (!source) throw new Error("不是有效的 S3/OSS 链接");
  const url = new URL(source);
  if (!url.hostname) throw new Error("S3/OSS 链接缺少 Bucket");
  const routePath = url.pathname
    .split("/")
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join("/");
  return `${chrome.runtime.getURL("app.html")}#/s3/` +
    `${encodeURIComponent(url.hostname)}${routePath}`;
}

async function openObjectStorageUri(uri) {
  const url = objectStorageAppUrl(uri);
  await chrome.tabs.create({ url, active: true });
}

let nativePort;
let backend;
let connectionPromise;
let recoveryPromise;
let keepBackendAlive = false;
let heartbeatFailures = 0;
const HEARTBEAT_ALARM = "file-browser-backend-heartbeat";

function connectBackend() {
  if (backend) return Promise.resolve(backend);
  if (connectionPromise) return connectionPromise;

  connectionPromise = new Promise((resolve, reject) => {
    try {
      nativePort = chrome.runtime.connectNative("com.wemchao.file_browser");
    } catch (error) {
      connectionPromise = null;
      reject(error);
      return;
    }
    const port = nativePort;

    const timeout = setTimeout(() => {
      connectionPromise = null;
      reject(new Error("本地能力启动超时"));
    }, 12000);

    port.onMessage.addListener((message) => {
      if (message?.type !== "ready") return;
      clearTimeout(timeout);
      backend = {
        url: `http://127.0.0.1:${message.port}`,
        token: message.token,
      };
      resolve(backend);
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      const detail = chrome.runtime.lastError?.message;
      const wasCurrent = nativePort === port;
      const wasConnected = wasCurrent && Boolean(backend);
      if (wasCurrent) {
        backend = null;
        nativePort = null;
        connectionPromise = null;
      }
      if (detail) reject(new Error(detail));
      if (wasConnected && keepBackendAlive) {
        setTimeout(() => recoverBackend().catch(() => {}), 500);
      }
    });

    port.postMessage({ type: "start" });
  });

  return connectionPromise;
}

async function backendIsHealthy() {
  if (!backend) return false;
  try {
    const url = new URL("/api/system", backend.url);
    url.searchParams.set("token", backend.token);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function recoverBackend() {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = (async () => {
    if (await backendIsHealthy()) return backend;
    nativePort?.disconnect();
    nativePort = null;
    backend = null;
    connectionPromise = null;
    return connectBackend();
  })().finally(() => {
    recoveryPromise = null;
  });
  return recoveryPromise;
}

chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM || !keepBackendAlive) return;
  if (await backendIsHealthy()) {
    heartbeatFailures = 0;
    try {
      nativePort?.postMessage({ type: "ping" });
    } catch {
      recoverBackend().catch(() => {});
    }
    return;
  }
  heartbeatFailures += 1;
  if (heartbeatFailures < 2) return;
  heartbeatFailures = 0;
  recoverBackend().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "openObjectStorage") {
    openObjectStorageUri(message.uri)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (!["getBackend", "recoverBackend", "restartBackend"].includes(message?.type)) {
    return false;
  }
  keepBackendAlive = true;
  if (message.type === "restartBackend") {
    nativePort?.disconnect();
    nativePort = null;
    backend = null;
    connectionPromise = null;
  }
  const connection = message.type === "recoverBackend"
    ? recoverBackend()
    : connectBackend();
  connection
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({
      ok: false,
      error: `${error.message}。请先安装 AnyFs Browser 的原生辅助程序。`,
    }));
  return true;
});
