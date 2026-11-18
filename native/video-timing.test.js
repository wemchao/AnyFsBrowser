const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parseMoov,
  readIsoTimingFromReader,
  readVideoTiming,
} = require("./video-timing");

function box(type, ...parts) {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + header.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function videoTrack(timescale, runs) {
  const frameCount = runs.reduce((sum, run) => sum + run.count, 0);
  const duration = runs.reduce((sum, run) => sum + run.count * run.delta, 0);
  const mdhd = Buffer.alloc(20);
  mdhd.writeUInt32BE(timescale, 12);
  mdhd.writeUInt32BE(duration, 16);

  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8, 4, "ascii");

  const stts = Buffer.alloc(8 + runs.length * 8);
  stts.writeUInt32BE(runs.length, 4);
  runs.forEach((run, index) => {
    stts.writeUInt32BE(run.count, 8 + index * 8);
    stts.writeUInt32BE(run.delta, 12 + index * 8);
  });

  return {
    frameCount,
    payload: box(
      "trak",
      box("mdia", box("mdhd", mdhd), box("hdlr", hdlr), box("minf", box("stbl", box("stts", stts)))),
    ),
  };
}

test("reads the exact constant frame rate and frame count from MP4 timing", () => {
  const track = videoTrack(24_000, [{ count: 240, delta: 1001 }]);
  const timing = parseMoov(track.payload);

  assert.equal(timing.frameCount, 240);
  assert.equal(timing.timescale, 24_000);
  assert.ok(Math.abs(timing.fps - 23.976023976) < 1e-9);
  assert.deepEqual(timing.runs, [{ count: 240, delta: 1001 }]);
});

test("keeps variable-frame-rate timing runs for frame stepping", () => {
  const runs = [
    { count: 30, delta: 1000 },
    { count: 30, delta: 2000 },
  ];
  const timing = parseMoov(videoTrack(1000, runs).payload);

  assert.equal(timing.frameCount, 60);
  assert.equal(timing.fps, 60 / 90);
  assert.deepEqual(timing.runs, runs);
});

test("reads timing from an MP4 file through the public API", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "remotefs-video-timing-"));
  const filePath = path.join(temporary, "sample.mp4");
  try {
    const track = videoTrack(30_000, [{ count: 300, delta: 1000 }]);
    await writeFile(filePath, box("moov", track.payload));
    const timing = await readVideoTiming(filePath);
    assert.equal(timing.fps, 30);
    assert.equal(timing.frameCount, 300);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("reads a remote MP4 moov box with ranges without downloading mdat", async () => {
  const track = videoTrack(10_000, [{ count: 100, delta: 1000 }]);
  const content = Buffer.concat([
    box("ftyp", Buffer.from("isom")),
    box("mdat", Buffer.alloc(1024 * 1024)),
    box("moov", track.payload),
  ]);
  const requests = [];
  const timing = await readIsoTimingFromReader(content.length, async (position, length) => {
    requests.push({ position, length });
    return content.subarray(position, position + length);
  });

  assert.equal(timing.fps, 10);
  assert.equal(timing.frameCount, 100);
  assert.ok(requests.every((request) => request.length < 1024));
  assert.ok(
    requests.reduce((sum, request) => sum + request.length, 0) < 1024,
    "range parser must skip the video payload",
  );
});
