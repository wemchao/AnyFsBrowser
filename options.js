const inputs = [...document.querySelectorAll('input[name="interfaceStyle"]')];
const markdownLayoutInputs = [
  ...document.querySelectorAll('input[name="markdownDefaultLayout"]'),
];
const homeButton = document.querySelector("#settingsHomeButton");
const notice = document.querySelector("#savedNotice");

function storageGet() {
  if (globalThis.chrome?.storage?.local) {
    return chrome.storage.local.get(["interfaceStyle", "markdownDefaultLayout"]);
  }
  return Promise.resolve({
    interfaceStyle: localStorage.getItem("interfaceStyle"),
    markdownDefaultLayout: localStorage.getItem("markdownDefaultLayout"),
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

async function init() {
  const result = await storageGet();
  selectStyle(result.interfaceStyle);
  selectMarkdownLayout(result.markdownDefaultLayout);
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

homeButton.addEventListener("click", () => {
  location.href = globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL("app.html")
    : "/";
});

init();
