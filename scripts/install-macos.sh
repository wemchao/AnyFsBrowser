#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
NPM="$(command -v npm)"
HOST_NAME="com.wemchao.file_browser"
EXTENSION_ID="bbdpmlabgaoebjojgmgglldcnlllgjjd"
SUPPORT_DIR="$HOME/Library/Application Support/AnyFS Viewer"
LAUNCHER="$SUPPORT_DIR/native-host"

echo "安装依赖…"
cd "$ROOT"
"$NPM" install
"$NPM" run build:extension

mkdir -p "$SUPPORT_DIR"
cat > "$LAUNCHER" <<LAUNCHER
#!/bin/sh
exec "$NODE" "$ROOT/native/server.js" --native
LAUNCHER
chmod 700 "$LAUNCHER"

for BROWSER_DIR in \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
do
  mkdir -p "$BROWSER_DIR"
  cat > "$BROWSER_DIR/$HOST_NAME.json" <<MANIFEST
{
  "name": "$HOST_NAME",
  "description": "AnyFS Viewer 的本地、SSH、S3 和大图处理能力",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
MANIFEST
done

# Remove the obsolete always-running development service, if previously installed.
launchctl bootout "gui/$(id -u)/com.wemchao.file-browser" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.wemchao.file-browser.plist"

echo
echo "原生辅助程序已注册。Chrome/Edge 会在打开插件时自动启动它，"
echo "关闭浏览器后自动退出，无需手动启动任何服务。"
echo
echo "Chrome/Edge 插件目录："
echo "  $ROOT/extension"
