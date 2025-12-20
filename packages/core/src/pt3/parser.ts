/**
 * PT3 File Parser
 *
 * Parses Pro Tracker 3 binary files into structured data
 */

import {
  Pt3File,
  Pt3Sample,
  Pt3SampleFrame,
  Pt3Ornament,
  Pt3Pattern,
  Pt3Version,
  ToneTableId,
} from './types';

/** PT3 Header offsets */
const PT3_MUSIC_NAME_OFFSET = 0;
const PT3_MUSIC_NAME_LENGTH = 0x63; // 99 bytes
const PT3_TONE_TABLE_OFFSET = 0x63;
const PT3_DELAY_OFFSET = 0x64;
const PT3_POSITIONS_COUNT_OFFSET = 0x65;
const PT3_LOOP_POSITION_OFFSET = 0x66;
const PT3_PATTERNS_POINTER_OFFSET = 0x67;
const PT3_SAMPLES_POINTERS_OFFSET = 0x69;
const PT3_ORNAMENTS_POINTERS_OFFSET = 0xa9;
const PT3_POSITION_LIST_OFFSET = 0xc9;

/** Minimum PT3 file size */
const PT3_MIN_SIZE = 0xc9 + 1; // Header + at least 1 position

/**
 * Find the offset of a second PT3 module in a TurboSound file
 * Returns -1 if not found
 */
function findSecondModuleOffset(data: Uint8Array): number {
  // Search for "Vortex Tracker" or "ProTracker" header starting after the first header
  // The minimum first module size is around 256 bytes, so start searching there
  const searchStart = 256;

  for (let i = searchStart; i < data.length - PT3_MIN_SIZE; i++) {
    // Check for "Vortex" signature
    if (
      data[i] === 0x56 &&
      data[i + 1] === 0x6f &&
      data[i + 2] === 0x72 &&
      data[i + 3] === 0x74 &&
      data[i + 4] === 0x65 &&
      data[i + 5] === 0x78
    ) {
      return i;
    }
    // Check for "ProTr" signature
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x72 &&
      data[i + 2] === 0x6f &&
      data[i + 3] === 0x54 &&
      data[i + 4] === 0x72
    ) {
      return i;
    }
  }

  return -1;
}

/**
 * Parse a single PT3 module from raw bytes at given offset
 */
function parsePt3Module(data: Uint8Array, offset: number = 0, length?: number): Pt3File {
  // Create a view of just this module's data
  const moduleData = length
    ? new Uint8Array(data.buffer, data.byteOffset + offset, length)
    : new Uint8Array(data.buffer, data.byteOffset + offset);

  if (moduleData.length < PT3_MIN_SIZE) {
    throw new Error(
      `PT3 module too small: ${moduleData.length} bytes (minimum ${PT3_MIN_SIZE})`,
    );
  }

  const view = new DataView(moduleData.buffer, moduleData.byteOffset, moduleData.byteLength);

  // Parse header string to extract title, author, and version
  const headerStr = parseString(moduleData, PT3_MUSIC_NAME_OFFSET, PT3_MUSIC_NAME_LENGTH);
  const { title, author, version } = parseHeaderString(headerStr);

  // Read basic header fields
  const toneTableId = (moduleData[PT3_TONE_TABLE_OFFSET] & 0x03) as ToneTableId;
  const delay = moduleData[PT3_DELAY_OFFSET];
  const numberOfPositions = moduleData[PT3_POSITIONS_COUNT_OFFSET];
  const loopPosition = moduleData[PT3_LOOP_POSITION_OFFSET];
  const patternsPointer = view.getUint16(PT3_PATTERNS_POINTER_OFFSET, true);

  // Read sample pointers (32 samples)
  const samplePointers: number[] = [];
  for (let i = 0; i < 32; i++) {
    samplePointers.push(view.getUint16(PT3_SAMPLES_POINTERS_OFFSET + i * 2, true));
  }

  // Read ornament pointers (16 ornaments)
  const ornamentPointers: number[] = [];
  for (let i = 0; i < 16; i++) {
    ornamentPointers.push(view.getUint16(PT3_ORNAMENTS_POINTERS_OFFSET + i * 2, true));
  }

  // Read position list (terminated by 0xFF or end of reasonable range)
  const positionList: number[] = [];
  let posOffset = PT3_POSITION_LIST_OFFSET;
  while (
    posOffset < moduleData.length &&
    moduleData[posOffset] !== 0xff &&
    positionList.length < 256
  ) {
    positionList.push(moduleData[posOffset]);
    posOffset++;
  }

  // Validate position list matches expected count
  if (positionList.length !== numberOfPositions) {
    console.warn(
      `PT3 position count mismatch: header says ${numberOfPositions}, found ${positionList.length}`,
    );
  }

  // Parse patterns
  const patterns = parsePatterns(moduleData, patternsPointer, positionList);

  // Parse samples
  const samples = parseSamples(moduleData, samplePointers);

  // Parse ornaments
  const ornaments = parseOrnaments(moduleData, ornamentPointers);

  return {
    version,
    toneTableId,
    delay,
    loopPosition,
    numberOfPositions: positionList.length,
    title,
    author,
    samples,
    ornaments,
    patterns,
    positionList,
  };
}

/**
 * Parse a PT3 file from raw bytes
 * Automatically detects and handles TurboSound files (two PT3 modules concatenated)
 */
export function parsePt3File(data: Uint8Array): Pt3File {
  if (data.length < PT3_MIN_SIZE) {
    throw new Error(`PT3 file too small: ${data.length} bytes (minimum ${PT3_MIN_SIZE})`);
  }

  // Check for TurboSound (two concatenated PT3 modules)
  const secondModuleOffset = findSecondModuleOffset(data);

  if (secondModuleOffset > 0) {
    // TurboSound file detected - parse both modules
    const firstModuleLength = secondModuleOffset;
    const firstModule = parsePt3Module(data, 0, firstModuleLength);
    const secondModule = parsePt3Module(data, secondModuleOffset);

    // Mark as TurboSound and attach second module
    firstModule.isTurboSound = true;
    firstModule.secondModule = secondModule;

    return firstModule;
  }

  // Single module file
  return parsePt3Module(data, 0);
}

/**
 * Parse header string to extract title, author, and version
 */
function parseHeaderString(headerStr: string): {
  title: string;
  author: string;
  version: Pt3Version;
} {
  // PT3 header format (example):
  // "ProTracker 3.6 compilation of " at offset 0
  // Title starts after header
  // Author at offset 0x42

  let version: Pt3Version = 6;
  let title = '';
  let author = '';

  // Try to extract version from "ProTracker X.Y" prefix
  const versionMatch = headerStr.match(/ProTracker\s*(\d)\.(\d)/i);
  if (versionMatch) {
    const major = parseInt(versionMatch[1], 10);
    const minor = parseInt(versionMatch[2], 10);
    // Version is encoded as major only for our purposes
    if (major === 3) {
      if (minor <= 3) version = 3;
      else if (minor === 4) version = 4;
      else if (minor === 5) version = 5;
      else version = 6;
    }
  }

  // Vortex Tracker II uses a different format
  if (headerStr.includes('Vortex Tracker')) {
    version = 6; // VT uses PT3.6 compatible format
  }

  // Title is at offset 0x1E (30) for 32 characters
  title = headerStr.substring(0x1e, 0x1e + 32).replace(/\0.*$/, '').trim();

  // Author is at offset 0x42 (66) for 32 characters
  author = headerStr.substring(0x42, 0x42 + 32).replace(/\0.*$/, '').trim();

  return { title, author, version };
}

/**
 * Parse string from data
 */
function parseString(data: Uint8Array, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length && offset + i < data.length; i++) {
    str += String.fromCharCode(data[offset + i]);
  }
  return str;
}

/**
 * Parse pattern data
 * Pattern pointer table: each pattern has 3 word pointers (A, B, C channels)
 */
function parsePatterns(
  data: Uint8Array,
  patternsPointer: number,
  positionList: number[],
): Pt3Pattern[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const patterns: Pt3Pattern[] = [];

  // Find the maximum pattern number used
  let maxPattern = 0;
  for (const pos of positionList) {
    // Position values are pattern indices × 3 in PT3
    const patternNum = Math.floor(pos / 3);
    if (patternNum > maxPattern) {
      maxPattern = patternNum;
    }
  }

  // Parse each pattern
  for (let patNum = 0; patNum <= maxPattern; patNum++) {
    const patternOffset = patternsPointer + patNum * 6;

    if (patternOffset + 6 > data.length) {
      // Missing pattern, create empty
      patterns.push({
        channelA: new Uint8Array([0]),
        channelB: new Uint8Array([0]),
        channelC: new Uint8Array([0]),
      });
      continue;
    }

    const ptrA = view.getUint16(patternOffset, true);
    const ptrB = view.getUint16(patternOffset + 2, true);
    const ptrC = view.getUint16(patternOffset + 4, true);

    patterns.push({
      channelA: extractPatternChannel(data, ptrA),
      channelB: extractPatternChannel(data, ptrB),
      channelC: extractPatternChannel(data, ptrC),
    });
  }

  return patterns;
}

/**
 * Extract pattern data for one channel until end marker (0x00)
 */
function extractPatternChannel(data: Uint8Array, pointer: number): Uint8Array {
  if (pointer >= data.length) {
    return new Uint8Array([0]);
  }

  // PT3 patterns can have up to 64 rows, each row can have multiple commands
  // plus effect parameters. 256 bytes was too small for some patterns.
  // Use 2048 bytes which should be more than enough.
  const maxLength = Math.min(2048, data.length - pointer);
  const channelData = new Uint8Array(maxLength);

  for (let i = 0; i < maxLength; i++) {
    channelData[i] = data[pointer + i];
  }

  return channelData;
}

/**
 * Parse sample definitions
 */
function parseSamples(data: Uint8Array, samplePointers: number[]): Pt3Sample[] {
  const samples: Pt3Sample[] = [];

  for (let i = 0; i < 32; i++) {
    const pointer = samplePointers[i];

    if (pointer === 0 || pointer >= data.length - 2) {
      // Empty sample
      samples.push({
        loopPosition: 0,
        length: 1,
        frames: [createEmptySampleFrame()],
      });
      continue;
    }

    // Sample header: loop position (1 byte), length (1 byte)
    const loopPosition = data[pointer];
    const length = data[pointer + 1];

    if (length === 0) {
      samples.push({
        loopPosition: 0,
        length: 1,
        frames: [createEmptySampleFrame()],
      });
      continue;
    }

    // Parse sample frames (4 bytes each)
    const frames: Pt3SampleFrame[] = [];
    const frameStart = pointer + 2;

    for (let f = 0; f < length && frameStart + f * 4 + 3 < data.length; f++) {
      const offset = frameStart + f * 4;
      frames.push(parseSampleFrame(data, offset));
    }

    // Ensure at least one frame
    if (frames.length === 0) {
      frames.push(createEmptySampleFrame());
    }

    samples.push({
      loopPosition: Math.min(loopPosition, frames.length - 1),
      length: frames.length,
      frames,
    });
  }

  return samples;
}

/**
 * Parse a single sample frame (4 bytes)
 *
 * From PT3 documentation:
 * Byte 0: sv +- N4 N3 N2 N1 N0 Em
 *   - b7 (sv): amplitude sliding enabled
 *   - b6 (+-): amplitude slide direction (1=increase)
 *   - b5-b1 (N4-N0): noise frequency OR envelope offset (5 bits)
 *   - b0 (Em): envelope mask (1=use envelope for amplitude)
 *
 * Byte 1: Nm ts ns Tm V3 V2 V1 V0
 *   - b7 (Nm): noise mask (1=noise disabled)
 *   - b6 (ts): accumulate tone offset
 *   - b5 (ns): accumulate noise/envelope offset
 *   - b4 (Tm): tone mask (1=tone disabled)
 *   - b3-b0 (V3-V0): base amplitude (0-15)
 *
 * Byte 2-3: tone offset (little-endian, signed 16-bit)
 */
function parseSampleFrame(data: Uint8Array, offset: number): Pt3SampleFrame {
  const b0 = data[offset];
  const b1 = data[offset + 1];
  const toneOffsetLo = data[offset + 2];
  const toneOffsetHi = data[offset + 3];

  // Tone offset is signed 16-bit little-endian
  let toneOffset = toneOffsetLo | (toneOffsetHi << 8);
  if (toneOffset > 32767) {
    toneOffset -= 65536;
  }

  // Noise/envelope offset from b0 bits 5-1 (5 bits, interpreted as signed)
  // Values 0-15 = down, 16-31 = up (N4 is the sign bit)
  const rawNoiseOffset = (b0 >> 1) & 0x1f;
  const noiseOffset = rawNoiseOffset >= 16 ? rawNoiseOffset - 32 : rawNoiseOffset;

  // Amplitude slide value - derived from noise offset bits but only lower 4 bits
  // Sign comes from b0 bit 6 (+-), where 1 = increase
  const amplitudeSlideValue = (b0 >> 1) & 0x0f;
  const amplitudeSlideUp = (b0 & 0x40) !== 0;
  const amplitudeSlide = amplitudeSlideUp ? amplitudeSlideValue : -amplitudeSlideValue;

  return {
    amplitude: b1 & 0x0f,              // V3-V0: bits 3-0 of byte 1
    toneOffset,
    accumulateTone: (b1 & 0x40) !== 0, // ts: bit 6 of byte 1
    accumulateNoise: (b1 & 0x20) !== 0, // ns: bit 5 of byte 1
    toneMask: (b1 & 0x10) !== 0,       // Tm: bit 4 of byte 1 (1=tone disabled)
    noiseMask: (b1 & 0x80) !== 0,      // Nm: bit 7 of byte 1 (1=noise disabled)
    noiseOffset,
    envelopeMask: (b0 & 0x01) !== 0,   // Em: bit 0 of byte 0 (1=use envelope)
    amplitudeSlide,
    amplitudeSlideEnabled: (b0 & 0x80) !== 0, // sv: bit 7 of byte 0
    envelopeOffset: rawNoiseOffset,    // Same N4-N0 bits used for envelope offset
  };
}

/**
 * Create an empty sample frame
 */
function createEmptySampleFrame(): Pt3SampleFrame {
  return {
    amplitude: 0,
    toneOffset: 0,
    accumulateTone: false,
    accumulateNoise: false,
    toneMask: true, // Muted
    noiseMask: true, // Muted
    noiseOffset: 0,
    envelopeMask: false,
    amplitudeSlide: 0,
    amplitudeSlideEnabled: false,
    envelopeOffset: 0,
  };
}

/**
 * Parse ornament definitions
 */
function parseOrnaments(data: Uint8Array, ornamentPointers: number[]): Pt3Ornament[] {
  const ornaments: Pt3Ornament[] = [];

  for (let i = 0; i < 16; i++) {
    const pointer = ornamentPointers[i];

    if (pointer === 0 || pointer >= data.length - 2) {
      // Empty ornament
      ornaments.push({
        loopPosition: 0,
        length: 1,
        offsets: new Int8Array([0]),
      });
      continue;
    }

    // Ornament header: loop position (1 byte), length (1 byte)
    const loopPosition = data[pointer];
    const length = data[pointer + 1];

    if (length === 0) {
      ornaments.push({
        loopPosition: 0,
        length: 1,
        offsets: new Int8Array([0]),
      });
      continue;
    }

    // Parse ornament offsets (1 signed byte each)
    const offsets = new Int8Array(length);
    const offsetStart = pointer + 2;

    for (let o = 0; o < length && offsetStart + o < data.length; o++) {
      // Convert unsigned to signed
      const val = data[offsetStart + o];
      offsets[o] = val > 127 ? val - 256 : val;
    }

    ornaments.push({
      loopPosition: Math.min(loopPosition, length - 1),
      length,
      offsets,
    });
  }

  return ornaments;
}

/**
 * Detect if data is a valid PT3 file
 */
export function isPt3File(data: Uint8Array): boolean {
  if (data.length < PT3_MIN_SIZE) {
    return false;
  }

  // Check for common PT3 signatures in the header
  const headerStr = parseString(data, 0, 32);

  // Check for ProTracker or Vortex Tracker signature
  if (headerStr.includes('ProTracker') || headerStr.includes('Vortex Tracker')) {
    return true;
  }

  // Additional heuristic: check structure validity
  // Patterns pointer must be reasonable
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const patternsPointer = view.getUint16(PT3_PATTERNS_POINTER_OFFSET, true);

  if (patternsPointer < PT3_POSITION_LIST_OFFSET || patternsPointer >= data.length) {
    return false;
  }

  // First ornament should have reasonable header
  const ornPtr = view.getUint16(PT3_ORNAMENTS_POINTERS_OFFSET, true);
  if (ornPtr > 0 && ornPtr < data.length - 2) {
    // Check ornament structure
    const ornLoop = data[ornPtr];
    const ornLen = data[ornPtr + 1];
    if (ornLoop > ornLen) {
      return false;
    }
  }

  return true;
}
