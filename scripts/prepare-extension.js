const fs = require("node:fs/promises");
const path = require("node:path");
const { build } = require("esbuild");

async function main() {
  const root = path.resolve(__dirname, "..");
  const source = require.resolve("openseadragon/build/openseadragon/openseadragon.min.js");
  const vendor = path.join(root, "vendor");
  await fs.mkdir(vendor, { recursive: true });
  await fs.copyFile(source, path.join(vendor, "openseadragon.min.js"));

  const imagesSource = path.join(path.dirname(source), "images");
  const imagesDestination = path.join(vendor, "images");
  await fs.rm(imagesDestination, { recursive: true, force: true });
  await fs.cp(imagesSource, imagesDestination, { recursive: true });

  const markdownItSource = require.resolve("markdown-it/dist/markdown-it.min.js");
  await fs.copyFile(markdownItSource, path.join(vendor, "markdown-it.min.js"));
  await fs.copyFile(
    require.resolve("mammoth/mammoth.browser.min.js"),
    path.join(vendor, "mammoth.min.js"),
  );
  await fs.copyFile(
    require.resolve("jszip/dist/jszip.min.js"),
    path.join(vendor, "jszip.min.js"),
  );
  await fs.copyFile(
    require.resolve("highlight.js/styles/github-dark.min.css"),
    path.join(vendor, "code-highlight.css"),
  );
  await build({
    entryPoints: [path.join(__dirname, "code-highlighter-entry.js")],
    outfile: path.join(vendor, "code-highlighter.min.js"),
    bundle: true,
    minify: true,
    platform: "browser",
    format: "iife",
  });
  await build({
    entryPoints: [path.join(__dirname, "markdown-enhanced-entry.js")],
    outfile: path.join(vendor, "markdown-enhanced.min.js"),
    bundle: true,
    minify: true,
    platform: "browser",
    format: "iife",
  });
  const katexCss = require.resolve("katex/dist/katex.min.css");
  await fs.copyFile(katexCss, path.join(vendor, "katex.min.css"));
  const katexFontsDestination = path.join(vendor, "fonts");
  await fs.rm(katexFontsDestination, { recursive: true, force: true });
  await fs.cp(
    path.join(path.dirname(katexCss), "fonts"),
    katexFontsDestination,
    { recursive: true },
  );
  console.log("图片、Markdown Enhanced、代码和 Office 预览资源已复制到 vendor");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
