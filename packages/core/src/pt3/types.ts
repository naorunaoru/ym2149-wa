/**
 * PT3 Type Definitions
 *
 * Types for parsing and playing Pro Tracker 3 files
 */

/** PT3 tone table selection (from header byte 99) */
export type ToneTableId = 0 | 1 | 2 | 3;

/** PT3 version (extracted from header string) */
export type Pt3Version = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Parsed PT3 file structure
 */
export interface Pt3File {
  /** PT3 version number */
  version: Pt3Version;
  /** Tone table selector (0-3) */
  toneTableId: ToneTableId;
  /** Initial playback speed (ticks per row) */
  delay: number;
  /** Position to loop back to */
  loopPosition: number;
  /** Total number of positions */
  numberOfPositions: number;
  /** Song title */
  title: string;
  /** Author name (if present in header) */
  author: string;

  /** Sample definitions (0-31) */
  samples: Pt3Sample[];
  /** Ornament definitions (0-15) */
  ornaments: Pt3Ornament[];
  /** Pattern data */
  patterns: Pt3Pattern[];
  /** Position list (pattern indices × 3 for transposition) */
  positionList: number[];
}

/**
 * PT3 Sample frame (4 bytes in file)
 * Samples define amplitude, tone offset, and noise/tone mixing per tick
 */
export interface Pt3SampleFrame {
  /** Amplitude level (0-15) from byte 1 bits 0-3 */
  amplitude: number;
  /** Tone offset (signed 16-bit) from bytes 2-3 */
  toneOffset: number;
  /** Whether to accumulate tone offset (byte 1 bit 6) */
  accumulateTone: boolean;
  /** Whether to accumulate noise/envelope offset (byte 1 bit 5) */
  accumulateNoise: boolean;
  /** Tone mask - if true, tone is disabled (byte 1 bit 4) */
  toneMask: boolean;
  /** Noise mask - if true, noise is disabled (byte 1 bit 7) */
  noiseMask: boolean;
  /** Noise offset from byte 0 bits 5-1 (signed 5-bit, -16 to +15) */
  noiseOffset: number;
  /** Envelope mask - if true, use envelope (byte 0 bit 0) */
  envelopeMask: boolean;
  /** Amplitude sliding value (signed) from byte 0 bits 5-1 + direction bit 6 */
  amplitudeSlide: number;
  /** Whether amplitude slide is active (byte 0 bit 7) */
  amplitudeSlideEnabled: boolean;
  /** Envelope offset from byte 0 bits 5-1 when envelope mask is set */
  envelopeOffset: number;
}

/**
 * PT3 Sample definition
 */
export interface Pt3Sample {
  /** Loop position within the sample */
  loopPosition: number;
  /** Total length of the sample */
  length: number;
  /** Sample frames */
  frames: Pt3SampleFrame[];
}

/**
 * PT3 Ornament definition
 * Ornaments apply note transposition over time
 */
export interface Pt3Ornament {
  /** Loop position within the ornament */
  loopPosition: number;
  /** Total length of the ornament */
  length: number;
  /** Signed note offsets (-128 to +127) */
  offsets: Int8Array;
}

/**
 * PT3 Pattern containing 3 channel data streams
 */
export interface Pt3Pattern {
  /** Raw pattern data for channel A */
  channelA: Uint8Array;
  /** Raw pattern data for channel B */
  channelB: Uint8Array;
  /** Raw pattern data for channel C */
  channelC: Uint8Array;
}

/**
 * Per-channel playback state
 */
export interface Pt3ChannelState {
  /** Current address within pattern data */
  addressInPattern: number;
  /** Current ornament index */
  ornamentIndex: number;
  /** Current sample index */
  sampleIndex: number;
  /** Current calculated tone period */
  tone: number;

  /** Ornament loop position */
  loopOrnamentPosition: number;
  /** Ornament length */
  ornamentLength: number;
  /** Current position within ornament */
  positionInOrnament: number;

  /** Sample loop position */
  loopSamplePosition: number;
  /** Sample length */
  sampleLength: number;
  /** Current position within sample */
  positionInSample: number;

  /** Channel volume (0-15) */
  volume: number;
  /** Number of rows to skip before next pattern read */
  numberOfNotesToSkip: number;
  /** Current note (0-95) */
  note: number;
  /** Target note for portamento */
  slideToNote: number;
  /** Calculated amplitude for output */
  amplitude: number;

  /** Whether envelope is enabled for this channel */
  envelopeEnabled: boolean;
  /** Whether channel is enabled (playing) */
  enabled: boolean;
  /** Whether using simple glissando (vs portamento) */
  simpleGliss: boolean;

  /** Current amplitude sliding accumulator */
  currentAmplitudeSliding: number;
  /** Current noise sliding accumulator */
  currentNoiseSliding: number;
  /** Current envelope sliding accumulator */
  currentEnvelopeSliding: number;
  /** Countdown for tone slide */
  tonSlideCount: number;
  /** Current on/off state for vibrato */
  currentOnOff: number;
  /** On duration for vibrato */
  onOffDelay: number;
  /** Off duration for vibrato */
  offOnDelay: number;
  /** Delay before tone slide starts */
  tonSlideDelay: number;
  /** Current tone sliding accumulator */
  currentTonSliding: number;
  /** Tone accumulator (for sample tone accumulation) */
  tonAccumulator: number;
  /** Tone slide step per tick */
  tonSlideStep: number;
  /** Total tone delta for portamento */
  tonDelta: number;
  /** Countdown to next pattern row */
  noteSkipCounter: number;
}

/**
 * Global player state
 */
export interface Pt3PlayerState {
  /** PT3 version */
  version: Pt3Version;
  /** Envelope base period */
  envBaseLo: number;
  envBaseHi: number;
  /** Current envelope slide accumulator */
  curEnvSlide: number;
  /** Envelope slide step */
  envSlideAdd: number;
  /** Current envelope delay countdown */
  curEnvDelay: number;
  /** Envelope delay period */
  envDelay: number;
  /** Pending envelope shape to write (0xFF = none pending) */
  newEnvelopeShape: number;
  /** Noise base value */
  noiseBase: number;
  /** Current playback speed */
  delay: number;
  /** Additional noise offset */
  addToNoise: number;
  /** Delay countdown to next row */
  delayCounter: number;
  /** Current position in song */
  currentPosition: number;

  /** Per-channel states */
  channels: [Pt3ChannelState, Pt3ChannelState, Pt3ChannelState];
}

/**
 * AY register values for one frame
 */
export interface AyRegisters {
  /** Channel A tone period (12-bit, R0-R1) */
  toneA: number;
  /** Channel B tone period (12-bit, R2-R3) */
  toneB: number;
  /** Channel C tone period (12-bit, R4-R5) */
  toneC: number;
  /** Noise period (5-bit, R6) */
  noise: number;
  /** Mixer control (R7) */
  mixer: number;
  /** Channel A amplitude (5-bit with envelope flag, R8) */
  volumeA: number;
  /** Channel B amplitude (5-bit with envelope flag, R9) */
  volumeB: number;
  /** Channel C amplitude (5-bit with envelope flag, R10) */
  volumeC: number;
  /** Envelope period (16-bit, R11-R12) */
  envelopePeriod: number;
  /** Envelope shape (4-bit, R13). 0xFF means don't write */
  envelopeShape: number;
}

/**
 * Create initial channel state
 */
export function createChannelState(): Pt3ChannelState {
  return {
    addressInPattern: 0,
    ornamentIndex: 0,
    sampleIndex: 0,
    tone: 0,
    loopOrnamentPosition: 0,
    ornamentLength: 0,
    positionInOrnament: 0,
    loopSamplePosition: 0,
    sampleLength: 0,
    positionInSample: 0,
    volume: 15, // PT3 channels start at maximum volume
    numberOfNotesToSkip: 0,
    note: 0,
    slideToNote: 0,
    amplitude: 0,
    envelopeEnabled: false,
    enabled: false,
    simpleGliss: false,
    currentAmplitudeSliding: 0,
    currentNoiseSliding: 0,
    currentEnvelopeSliding: 0,
    tonSlideCount: 0,
    currentOnOff: 0,
    onOffDelay: 0,
    offOnDelay: 0,
    tonSlideDelay: 0,
    currentTonSliding: 0,
    tonAccumulator: 0,
    tonSlideStep: 0,
    tonDelta: 0,
    noteSkipCounter: 1,
  };
}

/**
 * Create initial player state
 */
export function createPlayerState(version: Pt3Version, delay: number): Pt3PlayerState {
  return {
    version,
    envBaseLo: 0,
    envBaseHi: 0,
    curEnvSlide: 0,
    envSlideAdd: 0,
    curEnvDelay: 0,
    envDelay: 0,
    newEnvelopeShape: 0xff,
    noiseBase: 0,
    delay,
    addToNoise: 0,
    delayCounter: 1,
    currentPosition: 0,
    channels: [createChannelState(), createChannelState(), createChannelState()],
  };
}

/**
 * Create empty AY registers
 */
export function createAyRegisters(): AyRegisters {
  return {
    toneA: 0,
    toneB: 0,
    toneC: 0,
    noise: 0,
    mixer: 0x3f, // All channels off by default
    volumeA: 0,
    volumeB: 0,
    volumeC: 0,
    envelopePeriod: 0,
    envelopeShape: 0xff, // Don't write
  };
}
