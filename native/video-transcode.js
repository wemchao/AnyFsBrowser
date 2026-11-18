const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require("ffmpeg-static");
  } catch {
    return null;
  }
}

async function probeVideo(input) {
  const executable = ffmpegPath();
  if (!executable) return { codec: "", needsTranscode: false };
  const child = spawn(executable, [
    "-hide_banner",
    "-nostdin",
    "-i", input,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const stderr = [];
  child.stderr.on("data", (chunk) => {
    if (stderr.reduce((total, item) => total + item.length, 0) < 1024 * 1024) {
      stderr.push(chunk);
    }
  });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const details = Buffer.concat(stderr).toString("utf8");
  const codec = details.match(/Video:\s*([^,\s]+)/i)?.[1]?.toLowerCase() || "";
  const extension = path.extname(input).toLowerCase();
  const compatibleCodec = new Set(["h264", "av1", "vp8", "vp9", "theora"]);
  const compatibleContainer = new Set([
    ".mp4", ".m4v", ".mov", ".webm", ".ogv", ".ogg",
  ]);
  return {
    codec,
    needsTranscode:
      !compatibleContainer.has(extension) ||
      Boolean(codec && !compatibleCodec.has(codec)),
  };
}

async function transcodeVideo(input, destination) {
  const executable = ffmpegPath();
  if (!executable) throw new Error("FFmpeg 不可用");
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp.mp4`;
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-y",
    "-i", input,
    "-map", "0:v:0",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-c:a", "aac",
    "-b:a", "128k",
    temporary,
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  const stderr = [];
  child.stderr.on("data", (chunk) => {
    if (stderr.reduce((total, item) => total + item.length, 0) < 1024 * 1024) {
      stderr.push(chunk);
    }
  });
  try {
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else {
          reject(new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
            `FFmpeg 转码失败 (${code})`,
          ));
        }
      });
    });
    const stat = await fsp.stat(temporary).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) throw new Error("FFmpeg 没有生成有效视频");
    await fsp.rename(temporary, destination);
    return destination;
  } catch (error) {
    child.kill("SIGKILL");
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

module.exports = { probeVideo, transcodeVideo };
