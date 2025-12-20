/**
 * PT3 Module - Pro Tracker 3 file parser and player
 */

// Types
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
} from './types';

export { createChannelState, createPlayerState, createAyRegisters } from './types';

// Tables
export type { ToneTable } from './tables';
export {
  PT3_TABLE_PT_33_34R,
  PT3_TABLE_PT_34_35,
  PT3_TABLE_ST,
  PT3_TABLE_ASM_34R,
  PT3_TABLE_ASM_34_35,
  PT3_TABLE_REAL_34R,
  PT3_TABLE_REAL_34_35,
  PT3_VOLUME_TABLE_33_34,
  PT3_VOLUME_TABLE_35,
  getToneTable,
  getVolumeTable,
} from './tables';

// Parser
export { parsePt3File, isPt3File } from './parser';

// Player
export { Pt3Player } from './player';

// Replayer
export { Pt3Replayer } from './replayer';
export type { Pt3ReplayerState, Pt3ReplayerCallbacks } from './replayer';
