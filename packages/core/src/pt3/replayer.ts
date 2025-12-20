/**
 * PT3 Replayer - Plays PT3 files using the YM2149 emulator
 *
 * Compatible interface with YmReplayer for easy integration
 */

import { YM2149 } from '../ym2149';
import { Pt3File } from './types';
import { parsePt3File } from './parser';
import { Pt3Player } from './player';

export type Pt3ReplayerState = 'stopped' | 'playing' | 'paused';

export interface Pt3ReplayerCallbacks {
  onStateChange?: (state: Pt3ReplayerState) => void;
  onFrameChange?: (frame: number, total: number) => void;
  onPositionChange?: (position: number, total: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Configuration options for Pt3Replayer
 */
export interface Pt3ReplayerOptions {
  /** AudioContext to use (required) */
  audioContext: AudioContext;

  /** Destination node for audio output (defaults to audioContext.destination) */
  destination?: AudioNode;

  /** Optional pre-configured YM2149 instance (for TurboSound scenarios) */
  chip?: YM2149;
}

/** Default frame rate for PT3 files (50Hz PAL) */
const DEFAULT_FRAME_RATE = 50;

/** Default master clock for ZX Spectrum (1.7734MHz) */
const ZX_SPECTRUM_CLOCK = 1773400;

/**
 * PT3 Replayer - plays Pro Tracker 3 files through YM2149 emulator
 * Supports both single-chip and TurboSound (dual-chip) PT3 files
 */
export class Pt3Replayer {
  /** The AudioContext this replayer uses */
  readonly audioContext: AudioContext;

  private readonly ym: YM2149;
  private readonly ownsChip: boolean;
  private readonly masterGain: GainNode;
  private pt3File: Pt3File | null = null;
  private player: Pt3Player | null = null;
  private currentFrame = 0;
  private totalFrames = 0;
  private state: Pt3ReplayerState = 'stopped';
  private intervalId: number | null = null;
  private callbacks: Pt3ReplayerCallbacks = {};
  private frameRate = DEFAULT_FRAME_RATE;

  // TurboSound support
  private isTurboSound = false;
  private ym2: YM2149 | null = null;
  private player2: Pt3Player | null = null;

  constructor(options: Pt3ReplayerOptions) {
    if (!options.audioContext) {
      throw new Error('Pt3Replayer requires an AudioContext');
    }

    this.audioContext = options.audioContext;

    // Create master gain for volume control
    this.masterGain = new GainNode(this.audioContext, { gain: 0.5 });
    const destination = options.destination ?? this.audioContext.destination;
    this.masterGain.connect(destination);

    if (options.chip) {
      // Use provided chip (e.g., from TurboSound)
      this.ym = options.chip;
      this.ownsChip = false;
    } else {
      // Create our own chip
      this.ym = new YM2149({
        audioContext: this.audioContext,
        destination: this.masterGain,
      });
      this.ownsChip = true;
    }
  }

  /**
   * Set master volume (0.0 to 1.0)
   */
  setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.masterGain.gain.value = clamped;
  }

  /**
   * Set stereo pan position for a channel
   * @param channel - Channel index (0=A, 1=B, 2=C)
   * @param pan - Pan position from -1 (left) to +1 (right), 0 = center
   */
  setChannelPan(channel: number, pan: number): void {
    this.ym.setChannelPan(channel, pan);
  }

  setCallbacks(callbacks: Pt3ReplayerCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Load a PT3 file for playback (from parsed Pt3File)
   * Automatically handles TurboSound files with two modules
   */
  async load(pt3File: Pt3File): Promise<void> {
    await this.stop();

    // Clean up any previous TurboSound resources
    if (this.ym2) {
      this.ym2.dispose();
      this.ym2 = null;
    }
    this.player2 = null;
    this.isTurboSound = false;

    // Reset AudioWorklet generators
    this.ym.reset();

    this.pt3File = pt3File;
    this.player = new Pt3Player(pt3File);
    this.currentFrame = 0;

    // Check for TurboSound (two modules in one file)
    if (pt3File.isTurboSound && pt3File.secondModule) {
      this.isTurboSound = true;

      // Create second YM2149 chip for the second module
      this.ym2 = new YM2149({
        audioContext: this.audioContext,
        destination: this.masterGain,
      });

      // Create second player for the second module
      this.player2 = new Pt3Player(pt3File.secondModule);

      // Set internal clock for both chips
      const internalClock = ZX_SPECTRUM_CLOCK / 8;
      this.ym.setInternalClock(internalClock);
      this.ym2.setInternalClock(internalClock);

      // Estimate total frames using first module (both should be similar length)
      this.totalFrames = this.estimateTotalFrames(pt3File);
    } else {
      // Single chip mode
      const internalClock = ZX_SPECTRUM_CLOCK / 8;
      this.ym.setInternalClock(internalClock);
      this.totalFrames = this.estimateTotalFrames(pt3File);
    }

    this.notifyFrameChange();
  }

  /**
   * Load a PT3 file from raw bytes
   */
  async loadFromData(data: Uint8Array): Promise<Pt3File> {
    const pt3File = parsePt3File(data);
    await this.load(pt3File);
    return pt3File;
  }

  /**
   * Estimate total frames for the song
   */
  private estimateTotalFrames(pt3: Pt3File): number {
    // Rough estimate: positions × patterns × rows × delay
    // Average pattern has ~64 rows, delay is typically 3-6
    const avgRowsPerPattern = 64;
    const avgDelay = pt3.delay || 3;
    return pt3.numberOfPositions * avgRowsPerPattern * avgDelay;
  }

  /**
   * Start or resume playback
   */
  async play(): Promise<void> {
    if (!this.pt3File || !this.player) {
      throw new Error('No PT3 file loaded');
    }

    await this.ym.start();

    // Re-configure chip after start (worklet may have been recreated after stop)
    const internalClock = ZX_SPECTRUM_CLOCK / 8;
    this.ym.setInternalClock(internalClock);

    // Start second chip if TurboSound
    if (this.isTurboSound && this.ym2) {
      await this.ym2.start();
      this.ym2.setInternalClock(internalClock);
    }

    if (this.state === 'playing') {
      return;
    }

    this.state = 'playing';
    this.callbacks.onStateChange?.('playing');

    // Calculate interval in ms from frame rate
    const intervalMs = 1000 / this.frameRate;

    this.intervalId = window.setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state !== 'playing') {
      return;
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Silence all channels on first chip
    this.ym.setChannelVolume(0, 0);
    this.ym.setChannelVolume(1, 0);
    this.ym.setChannelVolume(2, 0);

    // Silence second chip if TurboSound
    if (this.isTurboSound && this.ym2) {
      this.ym2.setChannelVolume(0, 0);
      this.ym2.setChannelVolume(1, 0);
      this.ym2.setChannelVolume(2, 0);
    }

    this.state = 'paused';
    this.callbacks.onStateChange?.('paused');
  }

  /**
   * Stop playback and reset to beginning
   */
  async stop(): Promise<void> {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.currentFrame = 0;
    this.player?.reset();
    this.player2?.reset();
    this.state = 'stopped';
    this.callbacks.onStateChange?.('stopped');
    this.notifyFrameChange();

    // Silence all channels on first chip
    this.ym.setChannelVolume(0, 0);
    this.ym.setChannelVolume(1, 0);
    this.ym.setChannelVolume(2, 0);

    // Silence and stop second chip if TurboSound
    if (this.ym2) {
      this.ym2.setChannelVolume(0, 0);
      this.ym2.setChannelVolume(1, 0);
      this.ym2.setChannelVolume(2, 0);
      await this.ym2.stop();
    }

    // Only stop the chip if we own it
    if (this.ownsChip) {
      await this.ym.stop();
    }
  }

  /**
   * Seek to a specific frame
   */
  seek(frame: number): void {
    if (!this.pt3File || !this.player) return;

    // Reset and fast-forward both players
    this.player.reset();
    this.player2?.reset();
    this.currentFrame = 0;

    // Fast-forward to target frame (without audio output)
    const targetFrame = Math.max(0, Math.min(frame, this.totalFrames - 1));
    while (this.currentFrame < targetFrame && !this.player.isFinished()) {
      this.player.tick();
      this.player2?.tick();
      this.currentFrame++;
    }

    this.notifyFrameChange();
  }

  /**
   * Seek to a specific time in seconds
   */
  seekTime(seconds: number): void {
    const frame = Math.floor(seconds * this.frameRate);
    this.seek(frame);
  }

  /**
   * Get current playback position in seconds
   */
  getCurrentTime(): number {
    return this.currentFrame / this.frameRate;
  }

  /**
   * Get total duration in seconds
   */
  getDuration(): number {
    return this.totalFrames / this.frameRate;
  }

  getState(): Pt3ReplayerState {
    return this.state;
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  getFrameCount(): number {
    return this.totalFrames;
  }

  /**
   * Get current position in song
   */
  getCurrentPosition(): number {
    return this.player?.getCurrentPosition() ?? 0;
  }

  /**
   * Get total positions in song
   */
  getTotalPositions(): number {
    return this.player?.getTotalPositions() ?? 0;
  }

  /**
   * Get current channel output levels for visualization
   * Returns 3 levels for single chip, or 6 levels for TurboSound
   */
  getChannelLevels(): [number, number, number] {
    const levels1 = this.ym.getChannelLevels();
    // For TurboSound, we combine levels from both chips
    // (averaging would reduce the visualization intensity)
    if (this.isTurboSound && this.ym2) {
      const levels2 = this.ym2.getChannelLevels();
      // Return max of each channel pair for better visualization
      return [
        Math.max(levels1[0], levels2[0]),
        Math.max(levels1[1], levels2[1]),
        Math.max(levels1[2], levels2[2]),
      ];
    }
    return levels1;
  }

  /**
   * Get all 6 channel levels for TurboSound visualization
   * Returns chip1 A/B/C followed by chip2 A/B/C
   */
  getAllChannelLevels(): [number, number, number, number, number, number] {
    const levels1 = this.ym.getChannelLevels();
    if (this.isTurboSound && this.ym2) {
      const levels2 = this.ym2.getChannelLevels();
      return [...levels1, ...levels2];
    }
    return [...levels1, 0, 0, 0];
  }

  /**
   * Check if this is a TurboSound file
   */
  isTurboSoundFile(): boolean {
    return this.isTurboSound;
  }

  /**
   * Process one frame
   */
  private tick(): void {
    if (!this.player) return;

    // Check if song finished (check both players for TurboSound)
    const player1Finished = this.player.isFinished();
    const player2Finished = this.player2 ? this.player2.isFinished() : true;

    if (player1Finished && player2Finished) {
      // Loop back to beginning
      this.player.reset();
      this.player2?.reset();
      this.currentFrame = 0;
    }

    // Get register values from first player and apply to first chip
    const regs1 = this.player.tick();
    this.applyRegisters(this.ym, regs1);

    // Process second player if TurboSound
    if (this.isTurboSound && this.player2 && this.ym2) {
      const regs2 = this.player2.tick();
      this.applyRegisters(this.ym2, regs2);
    }

    this.currentFrame++;
    this.notifyFrameChange();
  }

  /**
   * Apply register values to a YM2149 emulator
   */
  private applyRegisters(
    chip: YM2149,
    regs: {
      toneA: number;
      toneB: number;
      toneC: number;
      noise: number;
      mixer: number;
      volumeA: number;
      volumeB: number;
      volumeC: number;
      envelopePeriod: number;
      envelopeShape: number;
    },
  ): void {
    // Set tone periods
    chip.setChannelPeriod(0, regs.toneA || 1);
    chip.setChannelPeriod(1, regs.toneB || 1);
    chip.setChannelPeriod(2, regs.toneC || 1);

    // Set noise period
    chip.setNoisePeriod(regs.noise || 1);

    // Set mixer
    chip.setMixer(regs.mixer);

    // Set volumes (with envelope flag)
    chip.setChannelVolumeReg(0, regs.volumeA);
    chip.setChannelVolumeReg(1, regs.volumeB);
    chip.setChannelVolumeReg(2, regs.volumeC);

    // Set envelope period
    chip.setEnvelopePeriod(regs.envelopePeriod || 1);

    // Set envelope shape (0xFF means don't trigger)
    if (regs.envelopeShape !== 0xff) {
      chip.setEnvelopeShape(regs.envelopeShape & 0x0f);
    }
  }

  private notifyFrameChange(): void {
    this.callbacks.onFrameChange?.(this.currentFrame, this.totalFrames);
    this.callbacks.onPositionChange?.(
      this.player?.getCurrentPosition() ?? 0,
      this.player?.getTotalPositions() ?? 0,
    );
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    // Clean up second chip if TurboSound
    if (this.ym2) {
      this.ym2.dispose();
      this.ym2 = null;
    }

    if (this.ownsChip) {
      this.ym.dispose();
    }
    this.masterGain.disconnect();
  }
}
