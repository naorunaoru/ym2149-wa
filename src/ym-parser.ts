/**
 * YM5/YM6 file format parser
 * 
 * Based on the Rust implementation in ym2149-rs
 */

export interface YmHeader {
  format: 'YM5' | 'YM6';
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
  frames: Uint8Array[];  // Array of 16-byte register frames
}

/**
 * Parse a YM5/YM6 file from raw bytes
 */
export function parseYmFile(data: Uint8Array): YmFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  
  // Check magic number
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== 'YM5!' && magic !== 'YM6!') {
    throw new Error('Invalid YM magic number: ' + magic + '. Expected YM5! or YM6!');
  }
  
  // Check signature "LeOnArD!"
  const signature = String.fromCharCode(...data.slice(4, 12));
  if (signature !== 'LeOnArD!') {
    throw new Error('Invalid YM signature: ' + signature);
  }
  
  // Parse header (big-endian)
  const header: YmHeader = {
    format: magic === 'YM6!' ? 'YM6' : 'YM5',
    frameCount: view.getUint32(12, false),      // big-endian
    attributes: view.getUint32(16, false),
    digidrumCount: view.getUint16(20, false),
    masterClock: view.getUint32(22, false),
    frameRate: view.getUint16(26, false),
    loopFrame: view.getUint32(28, false),
    extraDataSize: view.getUint16(32, false),
  };
  
  // Validate
  if (header.frameCount === 0) {
    throw new Error('YM file has zero frames');
  }
  if (header.frameCount > 100000) {
    throw new Error('YM frame count exceeds limit: ' + header.frameCount);
  }
  
  let offset = 34;
  
  // Skip extra data
  offset += header.extraDataSize;
  
  // Skip digidrum samples if present
  for (let i = 0; i < header.digidrumCount; i++) {
    if (offset + 4 > data.length) {
      throw new Error('Incomplete digidrum sample size field');
    }
    const sampleSize = view.getUint32(offset, false);
    offset += 4 + sampleSize;
  }
  
  // Parse metadata (null-terminated strings)
  const parseNullString = (): string => {
    let str = '';
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
  const isInterleaved = (header.attributes & 1) !== 0;
  const registerDataSize = header.frameCount * 16;
  
  if (offset + registerDataSize > data.length) {
    throw new Error('Not enough data for register frames');
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
    if (endMarker !== 'End!') {
      console.warn('YM end marker not found or invalid:', endMarker);
    }
  }
  
  return { header, metadata, frames };
}

/**
 * Calculate duration in seconds
 */
export function getYmDuration(file: YmFile): number {
  return file.header.frameCount / file.header.frameRate;
}

/**
 * Format duration as MM:SS
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
}
