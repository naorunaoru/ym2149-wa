export { YmPlayer } from './YmPlayer';
export type { Track, YmPlayerProps, TrackMetadata } from './types';

// Re-export core types for convenience
export {
  YmReplayer,
  YM2149,
  parseYmFile,
  getYmDuration,
  formatDuration,
} from '@ym2149/core';

export type {
  YmFile,
  YmFormat,
  YmHeader,
  YmMetadata,
  ReplayerState,
  ReplayerCallbacks,
} from '@ym2149/core';
