#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
NPM="$(command -v npm || true)"
HOST_NAME="com.wemchao.file_browser"
EXTENSION_ID="bbdpmlabgaoebjojgmgglldcnlllgjjd"
SUPPORT_DIR="$HOME/Library/Application Support/File Browser"
LAUNCHER="$SUPPORT_DIR/native-host"

if [[ -z "$NODE" || -z "$NPM" ]]; then
  echo "需要先安装 Node.js 20 或更高版本。" >&2
  exit 1
fi

NODE_MAJOR="$("$NODE" -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 20 )); then
  echo "当前 Node.js 版本过低，需要 Node.js 20 或更高版本。" >&2
  exit 1
fi

echo "安装本地运行依赖…"
cd "$ROOT"
"$NPM" install --omit=dev

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
  "description": "多功能文件浏览器的本地、SSH、S3 和大图处理能力",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
MANIFEST
done

echo
echo "安装完成。请在 Chrome/Edge 的扩展管理页加载："
echo "  $ROOT/extension"
