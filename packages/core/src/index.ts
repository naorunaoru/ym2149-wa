/**
 * @ym2149/core - YM2149 PSG Audio Engine
 *
 * @example Playing YM files
 * ```typescript
 * import { YmReplayer, parseYmFile } from '@ym2149/core';
 *
 * const replayer = new YmReplayer({ audioContext });
 * const ymFile = parseYmFile(data);
 * await replayer.load(ymFile);
 * await replayer.play();
 * ```
 *
 * @example Playing PT3 files
 * ```typescript
 * import { Pt3Replayer, parsePt3File } from '@ym2149/core';
 *
 * const replayer = new Pt3Replayer({ audioContext });
 * const pt3File = parsePt3File(data);
 * await replayer.load(pt3File);
 * await replayer.play();
 * ```
 */

// Emulator
export { YM2149 } from './ym2149';
export type { YM2149Options, Ym2149Registers, AyRegisters } from './ym2149';

// Replayers
export { BaseReplayer } from './base-replayer';
export type { ReplayerState, BaseReplayerCallbacks, BaseReplayerOptions } from './base-replayer';

export { YmReplayer } from './ym';
export type { YmFile, YmFormat, YmHeader, YmMetadata, ReplayerCallbacks } from './ym';

export { Pt3Replayer } from './pt3';
export type { Pt3File } from './pt3';

// Parsers
export { parseYmFile } from './ym';
export { parsePt3File, isPt3File } from './pt3';
