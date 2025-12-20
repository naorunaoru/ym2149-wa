/**
 * @ym2149/core - Standalone YM2149 PSG Audio Engine
 *
 * A framework-agnostic audio engine for playing YM chiptune files
 * using Web Audio API. Can be used with any UI framework or
 * as part of a custom application like a music tracker.
 *
 * @example High-Level API (YmReplayer)
 * ```typescript
 * import { YmReplayer, parseYmFile } from '@ym2149/core';
 *
 * const replayer = new YmReplayer();
 * const response = await fetch('song.ym');
 * const data = new Uint8Array(await response.arrayBuffer());
 * const ymFile = parseYmFile(data);
 *
 * await replayer.load(ymFile);
 * await replayer.play();
 * ```
 *
 * @example Low-Level API (YM2149)
 * ```typescript
 * import { YM2149 } from '@ym2149/core';
 *
 * const chip = new YM2149();
 * await chip.start();
 *
 * // Direct register control (for trackers)
 * chip.setChannelPeriod(0, 256);
 * chip.setChannelVolume(0, 15);
 * chip.setMixer(0b00111000);
 * ```
 */

// ============================================
// High-Level API
// ============================================

/** Abstract base class for replayers */
export { BaseReplayer } from './base-replayer';

/** High-level YM file replayer with playback controls */
export { YmReplayer } from './ym';

// ============================================
// Low-Level API
// ============================================

/** Low-level YM2149 PSG chip emulator */
export { YM2149 } from './ym2149';

/** Hardware envelope generator (internal use) */
export { EnvelopeGenerator } from './envelope';

// ============================================
// File Parsing
// ============================================

/** Parse YM file from raw bytes (auto-detects format) */
export { parseYmFile, getYmDuration, formatDuration } from './ym';

/** Parse PT3 file from raw bytes */
export { parsePt3File, isPt3File, Pt3Player, Pt3Replayer } from './pt3';

// ============================================
// Effects
// ============================================

/** YM5/YM6 special effects decoders */
export { decodeEffectsYm5, decodeEffectsYm6 } from './ym';

// ============================================
// Constants & Utilities
// ============================================

/** Lookup tables and conversion utilities */
export {
  VOLUME_TABLE,
  MASTER_CLOCK,
  CLOCK_DIVIDER,
  INTERNAL_CLOCK,
  periodToFrequency,
  frequencyToPeriod,
  SHAPE_TO_ENV,
  ENV_DATA,
  ENV_VOLUME_TABLE,
} from './tables';

// ============================================
// Types
// ============================================

/** Base replayer type definitions */
export type {
  ReplayerState as BaseReplayerState,
  BaseReplayerCallbacks,
  BaseReplayerOptions,
} from './base-replayer';

/** All public type definitions */
export type {
  // YM File types
  YmFormat,
  YmHeader,
  YmMetadata,
  YmFile,
  // YM2149 state types
  ChannelState,
  YM2149State,
  YM2149Options,
  // Replayer types
  ReplayerState,
  ReplayerCallbacks,
  YmReplayerOptions,
  // Effect types
  EffectType,
  Effect,
} from './types';

/** PT3 type definitions */
export type {
  ToneTableId,
  Pt3Version,
  Pt3File,
  Pt3Sample,
  Pt3SampleFrame,
  Pt3Ornament,
  Pt3Pattern,
  Pt3ChannelState,
  Pt3PlayerState,
  AyRegisters,
  Pt3ReplayerState,
  Pt3ReplayerCallbacks,
  Pt3ReplayerOptions,
} from './pt3';
