const inputs = [...document.querySelectorAll('input[name="interfaceStyle"]')];
const markdownLayoutInputs = [
  ...document.querySelectorAll('input[name="markdownDefaultLayout"]'),
];
const htmlViewModeInputs = [
  ...document.querySelectorAll('input[name="htmlDefaultViewMode"]'),
];
const textDefaultModeInputs = [
  ...document.querySelectorAll('input[name="textDefaultMode"]'),
];
const textSaveModeInputs = [
  ...document.querySelectorAll('input[name="textSaveMode"]'),
];
const maxPreviewBytes = document.querySelector("#maxPreviewBytes");
const maxTextPreviewBytes = document.querySelector("#maxTextPreviewBytes");
const homeButton = document.querySelector("#settingsHomeButton");
const backButton = document.querySelector("#settingsBackButton");
const notice = document.querySelector("#savedNotice");

function storageGet() {
  if (globalThis.chrome?.storage?.local) {
    return chrome.storage.local.get([
      "interfaceStyle",
      "markdownDefaultLayout",
      "htmlDefaultViewMode",
      "textDefaultMode",
      "textSaveMode",
      "maxPreviewBytes",
      "maxTextPreviewBytes",
    ]);
  }
  return Promise.resolve({
    interfaceStyle: localStorage.getItem("interfaceStyle"),
    markdownDefaultLayout: localStorage.getItem("markdownDefaultLayout"),
    htmlDefaultViewMode: localStorage.getItem("htmlDefaultViewMode"),
    textDefaultMode: localStorage.getItem("textDefaultMode"),
    textSaveMode: localStorage.getItem("textSaveMode"),
    maxPreviewBytes: localStorage.getItem("maxPreviewBytes"),
    maxTextPreviewBytes: localStorage.getItem("maxTextPreviewBytes"),
  });
}

async function storageSet(values) {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set(values);
  } else {
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, String(value)));
  }
}

function showSavedNotice() {
  notice.classList.add("visible");
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => notice.classList.remove("visible"), 1600);
}

function selectStyle(style) {
  const selected = style === "windows" ? "windows" : "finder";
  for (const input of inputs) input.checked = input.value === selected;
  document.documentElement.dataset.interfaceStyle = selected;
}

function selectMarkdownLayout(layout) {
  const selected = ["reading", "a4"].includes(layout) ? "reading" : "wide";
  for (const input of markdownLayoutInputs) {
    input.checked = input.value === selected;
  }
}

function selectHtmlViewMode(mode) {
  const selected = mode === "source" ? "source" : "rendered";
  for (const input of htmlViewModeInputs) {
    input.checked = input.value === selected;
  }
}

function selectTextDefaultMode(mode) {
  const selected = mode === "read" ? "read" : "edit";
  for (const input of textDefaultModeInputs) {
    input.checked = input.value === selected;
  }
}

function selectTextSaveMode(mode) {
  const selected = mode === "auto" ? "auto" : "manual";
  for (const input of textSaveModeInputs) {
    input.checked = input.value === selected;
  }
}

async function init() {
  const result = await storageGet();
  selectStyle(result.interfaceStyle);
  selectMarkdownLayout(result.markdownDefaultLayout);
  selectHtmlViewMode(result.htmlDefaultViewMode);
  selectTextDefaultMode(result.textDefaultMode);
  selectTextSaveMode(result.textSaveMode);
  maxPreviewBytes.value = String(
    result.maxPreviewBytes ?? 256 * 1024 * 1024,
  );
  maxTextPreviewBytes.value = String(
    result.maxTextPreviewBytes ?? 2 * 1024 * 1024,
  );
}

for (const input of inputs) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    selectStyle(input.value);
    await storageSet({ interfaceStyle: input.value });
    showSavedNotice();
  });
}

for (const input of markdownLayoutInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    selectMarkdownLayout(input.value);
    await storageSet({ markdownDefaultLayout: input.value });
    showSavedNotice();
  });
}

for (const input of htmlViewModeInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    selectHtmlViewMode(input.value);
    await storageSet({ htmlDefaultViewMode: input.value });
    showSavedNotice();
  });
}

for (const input of textDefaultModeInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    selectTextDefaultMode(input.value);
    await storageSet({ textDefaultMode: input.value });
    showSavedNotice();
  });
}

for (const input of textSaveModeInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    selectTextSaveMode(input.value);
    await storageSet({ textSaveMode: input.value });
    showSavedNotice();
  });
}

maxPreviewBytes.addEventListener("change", async () => {
  await storageSet({ maxPreviewBytes: Number(maxPreviewBytes.value) });
  showSavedNotice();
});

maxTextPreviewBytes.addEventListener("change", async () => {
  await storageSet({ maxTextPreviewBytes: Number(maxTextPreviewBytes.value) });
  showSavedNotice();
});

homeButton.addEventListener("click", () => {
  location.href = globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL("app.html")
    : "/";
});

backButton.addEventListener("click", () => {
  if (history.length > 1) history.back();
  else window.close();
});

init();
