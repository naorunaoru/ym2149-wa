/**
 * YM file format parser
 *
 * Supports YM2, YM3, YM3b, YM5, and YM6 formats.
 * Based on the Rust implementation in ym2149-rs
 */

// Attribute flags (YM5/YM6 only)
const ATTR_INTERLEAVED = 0x01;
const ATTR_DRUM_4BIT = 0x04;

// Default values for YM2/YM3 formats
const DEFAULT_MASTER_CLOCK = 2000000; // 2MHz Atari ST
const DEFAULT_FRAME_RATE = 50; // 50Hz PAL

export type YmFormat = "YM2" | "YM3" | "YM3b" | "YM5" | "YM6";

export interface YmHeader {
  format: YmFormat;
  frameCount: number;
  attributes: number;
  digidrumCount: number;
  masterClock: number;
  frameRate: number;
  loopFrame: number;
  extraDataSize: number;
}

export interface YmMetadata {
  songName: string;
  author: string;
  comment: string;
}

export interface YmFile {
  header: YmHeader;
  metadata: YmMetadata;
  frames: Uint8Array[]; // Array of 16-byte register frames
  digidrums: Uint8Array[]; // DigiDrum sample data (8-bit unsigned)
}

/**
 * Logarithmic lookup table for 4-bit DigiDrum expansion (matches ST-Sound reference)
 * Maps 4-bit values (0-15) to 8-bit amplitude values with logarithmic curve
 */
const DIGIDRUM_4BIT_TABLE = [
  0, 1, 2, 2, 4, 6, 9, 12, 17, 24, 35, 48, 72, 103, 165, 255,
];

/**
 * Decode 4-bit digidrum samples to 8-bit using logarithmic lookup table
 * In YM format, 4-bit samples store the value in the low nibble only (not packed two-per-byte)
 */
function decode4BitDigidrum(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    // Use low nibble as index into logarithmic lookup table
    result[i] = DIGIDRUM_4BIT_TABLE[data[i] & 0x0f];
  }
  return result;
}

/**
 * Parse a YM file from raw bytes (auto-detects format)
 */
export function parseYmFile(data: Uint8Array): YmFile {
  // Check magic number
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);

  // Dispatch to appropriate parser based on format
  if (magic === "YM2!" || magic === "YM3!") {
    return parseYm2Ym3(data, magic === "YM2!" ? "YM2" : "YM3");
  }

  // Check for YM3b (different magic - 4 chars)
  if (magic === "YM3b") {
    return parseYm2Ym3(data, "YM3b");
  }

  if (magic !== "YM5!" && magic !== "YM6!") {
    throw new Error(
      "Invalid YM magic number: " +
        magic +
        ". Expected YM2!, YM3!, YM3b, YM5! or YM6!"
    );
  }

  return parseYm5Ym6(data, magic === "YM6!" ? "YM6" : "YM5");
}

/**
 * Parse YM2/YM3/YM3b format (simple format with 14 registers per frame)
 */
function parseYm2Ym3(data: Uint8Array, format: "YM2" | "YM3" | "YM3b"): YmFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // YM2/YM3 have minimal structure:
  // - 4 bytes magic
  // - Frame data (14 registers per frame, interleaved)
  // - For YM3b: 4 bytes loop frame at the end

  const headerSize = 4;
  let dataSize = data.length - headerSize;
  let loopFrame = 0;

  // YM3b has loop frame at the end
  if (format === "YM3b") {
    dataSize -= 4;
    loopFrame = view.getUint32(data.length - 4, false); // big-endian
  }

  // Calculate frame count (14 registers per frame, interleaved)
  const frameCount = Math.floor(dataSize / 14);

  if (frameCount === 0) {
    throw new Error("YM file has zero frames");
  }
  if (frameCount > 100000) {
    throw new Error("YM frame count exceeds limit: " + frameCount);
  }

  const header: YmHeader = {
    format,
    frameCount,
    attributes: ATTR_INTERLEAVED, // YM2/YM3 are always interleaved
    digidrumCount: 0,
    masterClock: DEFAULT_MASTER_CLOCK,
    frameRate: DEFAULT_FRAME_RATE,
    loopFrame,
    extraDataSize: 0,
  };

  // Parse interleaved register data (14 registers)
  const registerBytes = data.slice(headerSize, headerSize + frameCount * 14);
  const frames: Uint8Array[] = [];

  for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
    const frame = new Uint8Array(16); // Pad to 16 bytes
    for (let regIdx = 0; regIdx < 14; regIdx++) {
      frame[regIdx] = registerBytes[regIdx * frameCount + frameIdx];
    }
    // R14 and R15 default to 0 (no effects)
    frames.push(frame);
  }

  const metadata: YmMetadata = {
    songName: "",
    author: "",
    comment: `${format} format`,
  };

  return { header, metadata, frames, digidrums: [] };
}

/**
 * Parse YM5/YM6 format (full format with header, metadata, digidrums)
 */
function parseYm5Ym6(data: Uint8Array, format: "YM5" | "YM6"): YmFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check signature "LeOnArD!"
  const signature = String.fromCharCode(...data.slice(4, 12));
  if (signature !== "LeOnArD!") {
    throw new Error("Invalid YM signature: " + signature);
  }

  // Parse header (big-endian)
  const header: YmHeader = {
    format,
    frameCount: view.getUint32(12, false), // big-endian
    attributes: view.getUint32(16, false),
    digidrumCount: view.getUint16(20, false),
    masterClock: view.getUint32(22, false),
    frameRate: view.getUint16(26, false),
    loopFrame: view.getUint32(28, false),
    extraDataSize: view.getUint16(32, false),
  };

  // Validate
  if (header.frameCount === 0) {
    throw new Error("YM file has zero frames");
  }
  if (header.frameCount > 100000) {
    throw new Error("YM frame count exceeds limit: " + header.frameCount);
  }

  let offset = 34;

  // Skip extra data
  offset += header.extraDataSize;

  // Parse digidrum samples
  const is4BitPacked = (header.attributes & ATTR_DRUM_4BIT) !== 0;
  const digidrums: Uint8Array[] = [];

  for (let i = 0; i < header.digidrumCount; i++) {
    if (offset + 4 > data.length) {
      throw new Error("Incomplete digidrum sample size field");
    }
    const sampleSize = view.getUint32(offset, false);
    offset += 4;

    if (offset + sampleSize > data.length) {
      throw new Error("Incomplete digidrum sample data");
    }

    const rawSample = data.slice(offset, offset + sampleSize);
    offset += sampleSize;

    // Decode 4-bit packed samples if needed
    if (is4BitPacked) {
      digidrums.push(decode4BitDigidrum(rawSample));
    } else {
      digidrums.push(rawSample);
    }
  }

  // Parse metadata (null-terminated strings)
  const parseNullString = (): string => {
    let str = "";
    while (offset < data.length && data[offset] !== 0) {
      str += String.fromCharCode(data[offset]);
      offset++;
    }
    offset++; // Skip null terminator
    return str;
  };

  const metadata: YmMetadata = {
    songName: parseNullString(),
    author: parseNullString(),
    comment: parseNullString(),
  };

  // Parse register data
  const isInterleaved = (header.attributes & ATTR_INTERLEAVED) !== 0;
  const registerDataSize = header.frameCount * 16;

  if (offset + registerDataSize > data.length) {
    throw new Error("Not enough data for register frames");
  }

  const registerBytes = data.slice(offset, offset + registerDataSize);
  const frames: Uint8Array[] = [];

  if (isInterleaved) {
    // Interleaved format: all r0s, then all r1s, etc.
    for (let frameIdx = 0; frameIdx < header.frameCount; frameIdx++) {
      const frame = new Uint8Array(16);
      for (let regIdx = 0; regIdx < 16; regIdx++) {
        frame[regIdx] = registerBytes[regIdx * header.frameCount + frameIdx];
      }
      frames.push(frame);
    }
  } else {
    // Non-interleaved format: r0-r15 for frame 0, then r0-r15 for frame 1, etc.
    for (let frameIdx = 0; frameIdx < header.frameCount; frameIdx++) {
      const start = frameIdx * 16;
      frames.push(registerBytes.slice(start, start + 16));
    }
  }

  // Verify end marker
  const endMarkerOffset = offset + registerDataSize;
  if (endMarkerOffset + 4 <= data.length) {
    const endMarker = String.fromCharCode(
      data[endMarkerOffset],
      data[endMarkerOffset + 1],
      data[endMarkerOffset + 2],
      data[endMarkerOffset + 3]
    );
    if (endMarker !== "End!") {
      console.warn("YM end marker not found or invalid:", endMarker);
    }
  }

  return { header, metadata, frames, digidrums };
}
