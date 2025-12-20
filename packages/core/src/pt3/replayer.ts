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

/** Default frame rate for PT3 files (50Hz PAL) */
const DEFAULT_FRAME_RATE = 50;

/** Default master clock for ZX Spectrum (1.7734MHz) */
const ZX_SPECTRUM_CLOCK = 1773400;

/**
 * PT3 Replayer - plays Pro Tracker 3 files through YM2149 emulator
 */
export class Pt3Replayer {
  private ym: YM2149;
  private pt3File: Pt3File | null = null;
  private player: Pt3Player | null = null;
  private currentFrame = 0;
  private totalFrames = 0;
  private state: Pt3ReplayerState = 'stopped';
  private intervalId: number | null = null;
  private callbacks: Pt3ReplayerCallbacks = {};
  private frameRate = DEFAULT_FRAME_RATE;

  constructor() {
    this.ym = new YM2149();
  }

  get audioContext(): AudioContext {
    return this.ym.audioContext;
  }

  /**
   * Set master volume (0.0 to 1.0)
   */
  setMasterVolume(volume: number): void {
    this.ym.setMasterVolume(volume);
  }

  setCallbacks(callbacks: Pt3ReplayerCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Load a PT3 file for playback (from parsed Pt3File)
   */
  async load(pt3File: Pt3File): Promise<void> {
    await this.stop();

    // Reset AudioWorklet generators
    this.ym.reset();

    this.pt3File = pt3File;
    this.player = new Pt3Player(pt3File);
    this.currentFrame = 0;

    // Estimate total frames (rough estimate based on pattern structure)
    // A more accurate count would require simulating playback
    this.totalFrames = this.estimateTotalFrames(pt3File);

    // Set internal clock for ZX Spectrum
    const internalClock = ZX_SPECTRUM_CLOCK / 8;
    this.ym.setInternalClock(internalClock);

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

    // Silence all channels
    this.ym.setChannelVolume(0, 0);
    this.ym.setChannelVolume(1, 0);
    this.ym.setChannelVolume(2, 0);

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
    this.state = 'stopped';
    this.callbacks.onStateChange?.('stopped');
    this.notifyFrameChange();

    // Silence all channels
    this.ym.setChannelVolume(0, 0);
    this.ym.setChannelVolume(1, 0);
    this.ym.setChannelVolume(2, 0);

    await this.ym.stop();
  }

  /**
   * Seek to a specific frame
   */
  seek(frame: number): void {
    if (!this.pt3File || !this.player) return;

    // Reset and fast-forward
    this.player.reset();
    this.currentFrame = 0;

    // Fast-forward to target frame (without audio output)
    const targetFrame = Math.max(0, Math.min(frame, this.totalFrames - 1));
    while (this.currentFrame < targetFrame && !this.player.isFinished()) {
      this.player.tick();
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
   */
  getChannelLevels(): [number, number, number] {
    return this.ym.getChannelLevels();
  }

  /**
   * Process one frame
   */
  private tick(): void {
    if (!this.player) return;

    // Check if song finished
    if (this.player.isFinished()) {
      // Loop back to beginning
      this.player.reset();
      this.currentFrame = 0;
    }

    // Get register values from player
    const regs = this.player.tick();

    // Apply to YM2149 emulator
    this.applyRegisters(regs);

    this.currentFrame++;
    this.notifyFrameChange();
  }

  /**
   * Apply register values to YM2149 emulator
   */
  private applyRegisters(regs: {
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
  }): void {
    // Set tone periods
    this.ym.setChannelPeriod(0, regs.toneA || 1);
    this.ym.setChannelPeriod(1, regs.toneB || 1);
    this.ym.setChannelPeriod(2, regs.toneC || 1);

    // Set noise period
    this.ym.setNoisePeriod(regs.noise || 1);

    // Set mixer
    this.ym.setMixer(regs.mixer);

    // Set volumes (with envelope flag)
    this.ym.setChannelVolumeReg(0, regs.volumeA);
    this.ym.setChannelVolumeReg(1, regs.volumeB);
    this.ym.setChannelVolumeReg(2, regs.volumeC);

    // Set envelope period
    this.ym.setEnvelopePeriod(regs.envelopePeriod || 1);

    // Set envelope shape (0xFF means don't trigger)
    if (regs.envelopeShape !== 0xff) {
      this.ym.setEnvelopeShape(regs.envelopeShape & 0x0f);
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
    this.ym.dispose();
  }
}
