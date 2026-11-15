const fs = require("node:fs/promises");
const path = require("node:path");

const FILES = [
  "manifest.json",
  "background.js",
  "app.html",
  "app.js",
  "styles.css",
  "options.html",
  "options.js",
  "options.css",
  "object-storage-links.js",
  "object-storage-links.css",
  "setup.html",
  "setup.js",
  "setup.css",
];

async function main() {
  const root = path.resolve(__dirname, "..");
  const destination = path.join(root, "extension");
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  await Promise.all(FILES.map((file) => (
    fs.copyFile(path.join(root, file), path.join(destination, file))
  )));
  await fs.cp(
    path.join(root, "vendor"),
    path.join(destination, "vendor"),
    { recursive: true },
  );

  console.log(`轻量扩展已生成：${destination}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
