/**
 * Base Replayer - Abstract base class for YM2149-based music replayers
 *
 * Provides common functionality for playing different music formats
 * (PT3 tracker files, YM register dumps, etc.) through the YM2149 emulator.
 */

import { YM2149 } from './ym2149';

export type ReplayerState = 'stopped' | 'playing' | 'paused';

/**
 * Base callback interface for replayer events
 */
export interface BaseReplayerCallbacks {
  onStateChange?: (state: ReplayerState) => void;
  onFrameChange?: (frame: number, total: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Configuration options for replayers
 */
export interface BaseReplayerOptions {
  /** AudioContext to use (required) */
  audioContext: AudioContext;

  /** Destination node for audio output (defaults to audioContext.destination) */
  destination?: AudioNode;
}

/**
 * Abstract base class for YM2149-based music replayers
 *
 * Subclasses must implement:
 * - `frameRate`: The playback rate in Hz
 * - `totalFrames`: Total number of frames in the loaded file
 * - `processFrame()`: Apply current frame to the YM2149 chip(s)
 * - `onLoad()`: Format-specific load logic
 * - `onSeek()`: Format-specific seek logic
 * - `onReset()`: Reset format-specific state
 * - `silenceChip()`: Silence the chip(s)
 */
export abstract class BaseReplayer<
  TFile,
  TCallbacks extends BaseReplayerCallbacks = BaseReplayerCallbacks,
> {
  /** The AudioContext this replayer uses */
  readonly audioContext: AudioContext;

  protected readonly ym: YM2149;
  protected readonly masterGain: GainNode;

  protected file: TFile | null = null;
  protected currentFrame = 0;
  protected state: ReplayerState = 'stopped';
  protected intervalId: number | null = null;
  protected callbacks: TCallbacks = {} as TCallbacks;

  constructor(options: BaseReplayerOptions) {
    if (!options.audioContext) {
      throw new Error('Replayer requires an AudioContext');
    }

    this.audioContext = options.audioContext;

    // Create master gain for volume control
    this.masterGain = new GainNode(this.audioContext, { gain: 0.5 });
    const destination = options.destination ?? this.audioContext.destination;
    this.masterGain.connect(destination);

    // Create the YM2149 chip
    this.ym = new YM2149({
      audioContext: this.audioContext,
      destination: this.masterGain,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract properties - must be implemented by subclasses
  // ─────────────────────────────────────────────────────────────────────────────

  /** Frame rate in Hz (e.g., 50 for PAL) */
  protected abstract get frameRate(): number;

  /** Total number of frames in the loaded file */
  protected abstract get totalFrames(): number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract methods - must be implemented by subclasses
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Process the current frame and apply it to the YM2149 chip(s)
   * Called once per frame during playback
   * @returns true if playback should continue, false if song finished
   */
  protected abstract processFrame(): boolean;

  /**
   * Format-specific load logic
   * Called after common load setup, before notifying callbacks
   */
  protected abstract onLoad(file: TFile): Promise<void>;

  /**
   * Format-specific seek logic
   * @param targetFrame The frame to seek to
   */
  protected abstract onSeek(targetFrame: number): void;

  /**
   * Reset format-specific state (players, effect tracking, etc.)
   */
  protected abstract onReset(): void;

  /**
   * Silence all chip(s) - turn off all audio output
   * Called during pause/stop
   */
  protected abstract silenceChip(): void;

  /**
   * Format-specific preparation before starting playback
   * Called after chip is started, before interval begins
   */
  protected abstract onPlay(): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Common public API
  // ─────────────────────────────────────────────────────────────────────────────

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

  /**
   * Set callback functions for replayer events
   */
  setCallbacks(callbacks: TCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Load a file for playback
   */
  async load(file: TFile): Promise<void> {
    await this.stop();

    // Reset chip state
    this.ym.reset();

    this.file = file;
    this.currentFrame = 0;

    // Let subclass do format-specific loading
    await this.onLoad(file);

    this.notifyFrameChange();
  }

  /**
   * Start or resume playback
   */
  async play(): Promise<void> {
    if (!this.file) {
      throw new Error('No file loaded');
    }

    await this.ym.start();

    // Let subclass prepare for playback
    await this.onPlay();

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

    this.silenceChip();

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
    this.onReset();

    this.state = 'stopped';
    this.callbacks.onStateChange?.('stopped');
    this.notifyFrameChange();

    this.silenceChip();

    await this.ym.stop();
  }

  /**
   * Seek to a specific frame
   */
  seek(frame: number): void {
    if (!this.file) return;

    const targetFrame = Math.max(0, Math.min(frame, this.totalFrames - 1));
    this.onSeek(targetFrame);
    this.currentFrame = targetFrame;
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

  /**
   * Get current playback state
   */
  getState(): ReplayerState {
    return this.state;
  }

  /**
   * Get current frame number
   */
  getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * Get total frame count
   */
  getFrameCount(): number {
    return this.totalFrames;
  }

  /**
   * Get current channel output levels for visualization.
   * Returns [channelA, channelB, channelC] with values 0-1.
   */
  getChannelLevels(): [number, number, number] {
    return this.ym.getChannelLevels();
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.ym.dispose();
    this.masterGain.disconnect();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Protected helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Main tick function - processes one frame
   */
  private tick(): void {
    if (!this.file) return;

    const shouldContinue = this.processFrame();

    if (!shouldContinue) {
      // Song finished - let subclass handle looping
      this.onReset();
      this.currentFrame = 0;
    } else {
      this.currentFrame++;
    }

    this.notifyFrameChange();
  }

  /**
   * Notify callbacks of frame change
   */
  protected notifyFrameChange(): void {
    this.callbacks.onFrameChange?.(this.currentFrame, this.totalFrames);
  }
}
