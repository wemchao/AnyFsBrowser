#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="wemchao/RemoteFsExplorer"
ASSET_URL="https://github.com/$REPOSITORY/releases/latest/download/RemoteFsExplorer-lite.zip"
OLD_SUPPORT_DIR="$HOME/Library/Application Support/AnyFs Browser"
SUPPORT_DIR="$HOME/Library/Application Support/RemoteFs Explorer"
INSTALL_DIR="$SUPPORT_DIR/app"
TEMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "需要先安装 Node.js 20 或更高版本：https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 20 )); then
  echo "当前 Node.js 版本过低，需要 Node.js 20 或更高版本。" >&2
  exit 1
fi

echo "正在从 GitHub 下载 RemoteFs Explorer…"
if ! curl --fail --location --silent --show-error \
  --retry 3 \
  "$ASSET_URL" \
  --output "$TEMP_DIR/release.zip"
then
  echo "代理连接失败，正在尝试直连 GitHub…"
  env \
    -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    -u http_proxy -u https_proxy -u all_proxy \
    curl --fail --location --silent --show-error \
      --retry 3 \
      "$ASSET_URL" \
      --output "$TEMP_DIR/release.zip"
fi
unzip -q "$TEMP_DIR/release.zip" -d "$TEMP_DIR/release"

SOURCE_DIR="$TEMP_DIR/release/RemoteFsExplorer-lite"
if [[ ! -f "$SOURCE_DIR/install-macos.sh" ]]; then
  echo "安装包内容不完整。" >&2
  exit 1
fi

if [[ -d "$OLD_SUPPORT_DIR" && ! -e "$SUPPORT_DIR" ]]; then
  mv "$OLD_SUPPORT_DIR" "$SUPPORT_DIR"
fi
mkdir -p "$SUPPORT_DIR"
NEXT_DIR="$SUPPORT_DIR/app.next.$$"
rm -rf "$NEXT_DIR"
cp -R "$SOURCE_DIR" "$NEXT_DIR"
rm -rf "$INSTALL_DIR"
mv "$NEXT_DIR" "$INSTALL_DIR"

echo "正在安装本地能力…"
bash "$INSTALL_DIR/install-macos.sh"

echo
echo "安装完成。回到扩展安装引导页，点击“重新检测”即可。"
