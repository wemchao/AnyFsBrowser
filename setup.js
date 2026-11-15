const statusPanel = document.querySelector("#statusPanel");
const statusTitle = document.querySelector("#statusTitle");
const statusMessage = document.querySelector("#statusMessage");
const installSteps = document.querySelector("#installSteps");
const copyCommand = document.querySelector("#copyCommand");
const recheckButton = document.querySelector("#recheckButton");
const openButton = document.querySelector("#openButton");
const copyNotice = document.querySelector("#copyNotice");
const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/wemchao/" +
  "AnyFSViewer/main/scripts/install-online-macos.sh | bash";

function setStatus(type, title, message) {
  statusPanel.className = `status-panel ${type}`;
  statusTitle.textContent = title;
  statusMessage.textContent = message;
}

async function checkNativeHost() {
  recheckButton.disabled = true;
  openButton.disabled = true;
  setStatus("checking", "正在检测本地能力…", "请稍候。");
  try {
    const result = await chrome.runtime.sendMessage({ type: "getBackend" });
    if (!result?.ok) throw new Error(result?.error || "Native Host 未安装");
    setStatus("ready", "本地能力已安装", "本地、SSH、S3 和大图功能均可使用。");
    installSteps.hidden = true;
    openButton.disabled = false;
  } catch (error) {
    setStatus(
      "missing",
      "还需要安装本地能力",
      error?.message || "请运行下方安装脚本，然后重新检测。",
    );
    installSteps.hidden = false;
  } finally {
    recheckButton.disabled = false;
  }
}

copyCommand.addEventListener("click", async () => {
  await navigator.clipboard.writeText(INSTALL_COMMAND);
  copyNotice.textContent = "安装命令已复制";
  setTimeout(() => {
    copyNotice.textContent = "";
  }, 1800);
});

recheckButton.addEventListener("click", checkNativeHost);
openButton.addEventListener("click", () => {
  location.href = chrome.runtime.getURL("app.html");
});

checkNativeHost();
