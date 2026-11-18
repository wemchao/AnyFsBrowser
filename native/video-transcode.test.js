const assert = require("node:assert/strict");
const { readFile, mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const ffmpeg = require("ffmpeg-static");
const { probeVideo, transcodeVideo } = require("./video-transcode");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(stderr).toString("utf8")));
    });
  });
}

test("converts an OpenCV-style MPEG-4 video to browser-compatible H.264", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "remotefs-video-transcode-"));
  const input = path.join(temporary, "opencv-mp4v.mp4");
  const output = path.join(temporary, "browser-h264.mp4");
  try {
    await run([
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "testsrc=size=96x64:rate=12",
      "-t", "0.5",
      "-c:v", "mpeg4",
      input,
    ]);
    const sourceInfo = await probeVideo(input);
    assert.equal(sourceInfo.codec, "mpeg4");
    assert.equal(sourceInfo.needsTranscode, true);

    await transcodeVideo(input, output);
    const content = await readFile(output);
    assert.ok(content.length > 0);
    assert.ok(content.includes(Buffer.from("avc1")), "output must use the H.264 avc1 codec");
    assert.ok(content.includes(Buffer.from("moov")), "output must contain MP4 metadata");
    const outputInfo = await probeVideo(output);
    assert.equal(outputInfo.codec, "h264");
    assert.equal(outputInfo.needsTranscode, false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
