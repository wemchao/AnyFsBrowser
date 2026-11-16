const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function main() {
  const root = path.resolve(__dirname, "..");
  const extension = path.join(root, "extension");
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const output = path.join(
    os.homedir(),
    "Desktop",
    `RemoteFsExplorer-extension-${manifest.version}.zip`,
  );
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "remotefs-explorer-store-"),
  );

  try {
    await fs.cp(extension, temporaryDirectory, { recursive: true });

    const storeManifestPath = path.join(temporaryDirectory, "manifest.json");
    const storeManifest = JSON.parse(
      await fs.readFile(storeManifestPath, "utf8"),
    );
    delete storeManifest.key;
    await fs.writeFile(
      storeManifestPath,
      `${JSON.stringify(storeManifest, null, 2)}\n`,
    );

    await fs.rm(output, { force: true });
    await execFileAsync("zip", ["-qr", output, "."], {
      cwd: temporaryDirectory,
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(`商店扩展包已生成：${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
