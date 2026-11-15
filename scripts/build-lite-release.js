const fs = require("node:fs/promises");
const path = require("node:path");

const RUNTIME_PACKAGE = {
  name: "anyfs-browser-runtime",
  version: "0.1.0",
  private: true,
  description: "Native runtime for multifunction file browser",
  engines: { node: ">=20" },
  dependencies: {
    "@aws-sdk/client-s3": "^3.940.0",
    "@aws-sdk/credential-providers": "^3.940.0",
    sharp: "^0.35.5",
  },
};

const README = `# AnyFs Browser（轻量发布版）

这个目录包含完整功能：

- Chrome/Edge 轻量扩展
- 本地、SSH、S3/OSS/MinIO 文件浏览
- 大图缩放、缩略图和原始图片缓存
- Markdown、JSON、代码、Office、PDF 和视频预览
- 网页 S3/OSS 链接点击打开

## 安装

要求 macOS、Node.js 20+、Chrome 或 Edge。

\`\`\`bash
bash install-macos.sh
\`\`\`

然后：

1. 打开 \`chrome://extensions\`，Edge 使用 \`edge://extensions\`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择当前目录中的 \`extension\` 文件夹。

首次安装脚本会联网下载约三项本地运行依赖。之后无需启动任何脚本，浏览器会自动启动和关闭本地辅助程序。

## 路径示例

\`\`\`text
/Users/me/data
user@host:/data
my-ssh-alias:~
s3://bucket/path
oss://bucket/path
\`\`\`

SSH 使用系统 \`~/.ssh/config\`、密钥和 ssh-agent。S3/OSS 默认读取 \`~/.aws/credentials\`，也可以在插件中配置 Endpoint、AK、SK、Region 和 Path Style。
`;

async function main() {
  const root = path.resolve(__dirname, "..");
  const destination = path.resolve(root, "..", "AnyFsBrowser-lite");

  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(
    path.join(root, "extension"),
    path.join(destination, "extension"),
    { recursive: true },
  );
  await fs.cp(
    path.join(root, "native"),
    path.join(destination, "native"),
    { recursive: true },
  );
  await fs.copyFile(
    path.join(root, "scripts", "install-lite-macos.sh"),
    path.join(destination, "install-macos.sh"),
  );
  await fs.chmod(path.join(destination, "install-macos.sh"), 0o755);
  await fs.writeFile(
    path.join(destination, "package.json"),
    `${JSON.stringify(RUNTIME_PACKAGE, null, 2)}\n`,
  );
  await fs.writeFile(path.join(destination, "README.md"), README);

  console.log(`完整轻量发布目录已生成：${destination}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
