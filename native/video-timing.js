const fsp = require("node:fs/promises");
const path = require("node:path");

const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_TIMING_RUNS = 2048;

function timingResult(fps, frameCount, timescale, runs) {
  if (!(fps >= 0.1 && fps <= 960) || !(frameCount > 0) || !(timescale > 0)) return null;
  const compact = runs.length > MAX_TIMING_RUNS
    ? [{ count: frameCount, delta: runs.reduce((sum, run) => sum + run.count * run.delta, 0) / frameCount }]
    : runs;
  return {
    fps,
    frameCount,
    timescale,
    runs: compact,
  };
}

function* boxes(buffer, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < header || offset + size > end) return;
    yield { type, start: offset + header, end: offset + size };
    offset += size;
  }
}

function parseMdhd(buffer, start, end) {
  if (start >= end) return null;
  const version = buffer[start];
  if (version === 1) {
    if (start + 32 > end) return null;
    return {
      timescale: buffer.readUInt32BE(start + 20),
      duration: Number(buffer.readBigUInt64BE(start + 24)),
    };
  }
  if (start + 20 > end) return null;
  return {
    timescale: buffer.readUInt32BE(start + 12),
    duration: buffer.readUInt32BE(start + 16),
  };
}

function parseStts(buffer, start, end) {
  if (start + 8 > end) return null;
  const entryCount = buffer.readUInt32BE(start + 4);
  const runs = [];
  let offset = start + 8;
  let frames = 0;
  let ticks = 0;
  for (let index = 0; index < entryCount && offset + 8 <= end; index += 1) {
    const count = buffer.readUInt32BE(offset);
    const delta = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (count === 0) continue;
    runs.push({ count, delta });
    frames += count;
    ticks += count * delta;
  }
  if (!frames || !ticks) return null;
  return { runs, frames, ticks };
}

function parseTrak(buffer, start, end) {
  let timescale = 0;
  let video = false;
  let samples = null;
  const visit = (from, to) => {
    for (const box of boxes(buffer, from, to)) {
      if (box.type === "mdhd") {
        const parsed = parseMdhd(buffer, box.start, box.end);
        if (parsed?.timescale > 0) timescale = parsed.timescale;
      } else if (box.type === "hdlr") {
        if (
          box.start + 12 <= box.end &&
          buffer.toString("ascii", box.start + 8, box.start + 12) === "vide"
        ) video = true;
      } else if (box.type === "stts") {
        samples = parseStts(buffer, box.start, box.end) || samples;
      } else if (box.type === "mdia" || box.type === "minf" || box.type === "stbl" || box.type === "edts") {
        visit(box.start, box.end);
      }
    }
  };
  visit(start, end);
  if (!video || !samples || !(timescale > 0)) return null;
  return timingResult(
    samples.frames * timescale / samples.ticks,
    samples.frames,
    timescale,
    samples.runs,
  );
}

function parseMoov(buffer) {
  let selected = null;
  for (const box of boxes(buffer, 0, buffer.length)) {
    if (box.type !== "trak") continue;
    const timing = parseTrak(buffer, box.start, box.end);
    if (timing && (!selected || timing.frameCount > selected.frameCount)) selected = timing;
  }
  return selected;
}

async function readExact(file, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return offset === length ? buffer : null;
}

async function readIsoTimingFromReader(size, readRange) {
  let position = 0;
  while (position + 8 <= size) {
    const header = await readRange(position, Math.min(16, size - position));
    if (!header || header.length < 8) return null;
    let boxSize = header.readUInt32BE(0);
    const type = header.toString("ascii", 4, 8);
    let headerSize = 8;
    if (boxSize === 1) {
      if (header.length < 16) return null;
      boxSize = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - position;
    }
    if (!Number.isFinite(boxSize) || boxSize < headerSize) return null;
    if (type === "moov") {
      const payloadLength = boxSize - headerSize;
      if (payloadLength <= 0 || payloadLength > MAX_INDEX_BYTES) return null;
      const payload = await readRange(position + headerSize, payloadLength);
      return payload ? parseMoov(payload) : null;
    }
    position += boxSize;
  }
  return null;
}

async function readIsoTiming(filePath) {
  const file = await fsp.open(filePath, "r");
  try {
    const { size } = await file.stat();
    return await readIsoTimingFromReader(
      size,
      (position, length) => readExact(file, position, length),
    );
  } finally {
    await file.close();
  }
}

function readEbmlId(buffer, offset) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (!first || offset + length > buffer.length) return null;
  let id = 0;
  for (let index = 0; index < length; index += 1) id = id * 256 + buffer[offset + index];
  return { id, next: offset + length };
}

function readEbmlSize(buffer, offset) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (!first || offset + length > buffer.length) return null;
  let value = first & (mask - 1);
  for (let index = 1; index < length; index += 1) value = value * 256 + buffer[offset + index];
  const unknown = value === (2 ** (7 * length)) - 1;
  return { value, next: offset + length, unknown };
}

function readUnsigned(buffer, start, end) {
  const size = end - start;
  if (size <= 0 || size > 8) return null;
  let value = 0;
  for (let index = 0; index < size; index += 1) value = value * 256 + buffer[start + index];
  return value;
}

function readFloat(buffer, start, end) {
  const size = end - start;
  if (size === 8) return buffer.readDoubleBE(start);
  if (size === 4) return buffer.readFloatBE(start);
  return null;
}

function parseMatroska(buffer) {
  const segment = 0x18538067;
  const info = 0x1549A966;
  const tracks = 0x1654AE6B;
  const trackEntry = 0xAE;
  const containers = new Set([segment, info, tracks, trackEntry]);
  let timecodeScale = 1000000;
  let duration = null;
  let defaultDuration = null;

  const visit = (start, end) => {
    let offset = start;
    while (offset + 2 < end) {
      const id = readEbmlId(buffer, offset);
      if (!id) return;
      const size = readEbmlSize(buffer, id.next);
      if (!size || size.unknown) return;
      const contentEnd = size.next + size.value;
      if (contentEnd > end) return;
      if (id.id === 0x2AD7B1) timecodeScale = readUnsigned(buffer, size.next, contentEnd) || timecodeScale;
      else if (id.id === 0x4489) duration = readFloat(buffer, size.next, contentEnd);
      else if (id.id === 0x1F43B675) return;
      else if (id.id === trackEntry) {
        let video = false;
        let frameDuration = null;
        const trackEnd = contentEnd;
        let trackOffset = size.next;
        while (trackOffset + 2 < trackEnd) {
          const childId = readEbmlId(buffer, trackOffset);
          if (!childId) break;
          const childSize = readEbmlSize(buffer, childId.next);
          if (!childSize || childSize.unknown) break;
          const childEnd = childSize.next + childSize.value;
          if (childEnd > trackEnd) break;
          if (childId.id === 0x83 && readUnsigned(buffer, childSize.next, childEnd) === 1) video = true;
          if (childId.id === 0x23E383) frameDuration = readUnsigned(buffer, childSize.next, childEnd);
          trackOffset = childEnd;
        }
        if (video && frameDuration > 0) defaultDuration = frameDuration;
      } else if (containers.has(id.id)) {
        visit(size.next, contentEnd);
      }
      offset = contentEnd;
    }
  };
  visit(0, buffer.length);
  if (!(defaultDuration > 0)) return null;
  const fps = 1e9 / defaultDuration;
  const seconds = duration > 0 ? duration * timecodeScale / 1e9 : 0;
  const frameCount = seconds > 0 ? Math.max(1, Math.round(seconds * fps)) : 0;
  if (!frameCount) return { fps, frameCount: 0, timescale: 1000000, runs: [] };
  return timingResult(fps, frameCount, 1000000, [{
    count: frameCount,
    delta: 1000000 / fps,
  }]);
}

async function readMatroskaTiming(filePath) {
  const file = await fsp.open(filePath, "r");
  try {
    const { size } = await file.stat();
    const length = Math.min(size, 8 * 1024 * 1024);
    const buffer = await readExact(file, 0, length);
    return buffer ? parseMatroska(buffer) : null;
  } finally {
    await file.close();
  }
}

function parseAvi(buffer) {
  const avih = buffer.indexOf("avih");
  if (avih < 0 || avih + 32 > buffer.length) return null;
  const microSeconds = buffer.readUInt32LE(avih + 8);
  let frames = buffer.readUInt32LE(avih + 24);
  const dmlh = buffer.indexOf("dmlh");
  if (dmlh >= 0 && dmlh + 12 <= buffer.length) {
    const extended = buffer.readUInt32LE(dmlh + 8);
    if (extended > frames) frames = extended;
  }
  if (!(microSeconds > 0) || !(frames > 0)) return null;
  const fps = 1e6 / microSeconds;
  return timingResult(fps, frames, 1000000, [{
    count: frames,
    delta: microSeconds,
  }]);
}

async function readAviTiming(filePath) {
  const file = await fsp.open(filePath, "r");
  try {
    const { size } = await file.stat();
    const buffer = await readExact(file, 0, Math.min(size, 1024 * 1024));
    return buffer ? parseAvi(buffer) : null;
  } finally {
    await file.close();
  }
}

async function readVideoTiming(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  try {
    if (extension === ".mp4" || extension === ".m4v" || extension === ".mov") {
      return await readIsoTiming(filePath);
    }
    if (extension === ".webm" || extension === ".mkv") return await readMatroskaTiming(filePath);
    if (extension === ".avi") return await readAviTiming(filePath);
  } catch {
    return null;
  }
  return null;
}

module.exports = {
  readVideoTiming,
  readIsoTimingFromReader,
  parseMoov,
};
