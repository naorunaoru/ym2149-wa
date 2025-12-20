/**
 * YM file replayer using AudioWorklet-based YM2149 emulation
 */

import { YmFile } from './parser';
import { YM2149 } from './ym2149';
import { decodeEffectsYm5, decodeEffectsYm6, Effect } from './effects';

export type ReplayerState = 'stopped' | 'playing' | 'paused';

export interface ReplayerCallbacks {
  onStateChange?: (state: ReplayerState) => void;
  onFrameChange?: (frame: number, total: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Configuration options for YmReplayer
 */
export interface YmReplayerOptions {
  /** AudioContext to use (required) */
  audioContext: AudioContext;

  /** Destination node for audio output (defaults to audioContext.destination) */
  destination?: AudioNode;

  /** Optional pre-configured YM2149 instance (for TurboSound scenarios) */
  chip?: YM2149;
}

/**
 * YM file replayer
 */
export class YmReplayer {
  /** The AudioContext this replayer uses */
  readonly audioContext: AudioContext;

  private readonly ym: YM2149;
  private readonly ownsChip: boolean;
  private readonly masterGain: GainNode;
  private ymFile: YmFile | null = null;
  private currentFrame = 0;
  private state: ReplayerState = 'stopped';
  private intervalId: number | null = null;
  private callbacks: ReplayerCallbacks = {};

  // Effect tracking state
  private activeSid: [boolean, boolean, boolean] = [false, false, false];
  private activeDrum: [boolean, boolean, boolean] = [false, false, false];
  private activeSyncBuzzer = false;

  constructor(options: YmReplayerOptions) {
    if (!options.audioContext) {
      throw new Error('YmReplayer requires an AudioContext');
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

  setCallbacks(callbacks: ReplayerCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Load a YM file for playback
   */
  async load(ymFile: YmFile): Promise<void> {
    await this.stop();

    // Reset AudioWorklet generators to prevent audio from previous song
    this.ym.reset();

    this.ymFile = ymFile;
    this.currentFrame = 0;

    // Set internal clock from YM file's master clock
    const internalClock = ymFile.header.masterClock / 8;
    this.ym.setInternalClock(internalClock);

    // Load DigiDrum samples if present
    if (ymFile.digidrums.length > 0) {
      this.ym.loadDrumSamples(ymFile.digidrums);
    }

    // Reset effect tracking
    this.activeSid = [false, false, false];
    this.activeDrum = [false, false, false];
    this.activeSyncBuzzer = false;

    this.notifyFrameChange();
  }

  /**
   * Start or resume playback
   */
  async play(): Promise<void> {
    if (!this.ymFile) {
      throw new Error('No YM file loaded');
    }

    await this.ym.start();

    if (this.state === 'playing') {
      return;
    }

    this.state = 'playing';
    this.callbacks.onStateChange?.('playing');

    // Calculate interval in ms from frame rate (typically 50Hz)
    const intervalMs = 1000 / this.ymFile.header.frameRate;

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

    // Stop all effects
    for (let ch = 0; ch < 3; ch++) {
      this.ym.stopSid(ch);
      this.ym.stopDrum(ch);
    }
    this.ym.stopSyncBuzzer();

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
    this.state = 'stopped';
    this.callbacks.onStateChange?.('stopped');
    this.notifyFrameChange();

    // Stop all effects
    for (let ch = 0; ch < 3; ch++) {
      this.ym.stopSid(ch);
      this.ym.stopDrum(ch);
    }
    this.ym.stopSyncBuzzer();

    // Silence all channels
    this.ym.setChannelVolume(0, 0);
    this.ym.setChannelVolume(1, 0);
    this.ym.setChannelVolume(2, 0);

    // Only stop the chip if we own it
    if (this.ownsChip) {
      await this.ym.stop();
    }
  }

  /**
   * Seek to a specific frame
   */
  seek(frame: number): void {
    if (!this.ymFile) return;
    this.currentFrame = Math.max(0, Math.min(frame, this.ymFile.header.frameCount - 1));
    this.notifyFrameChange();
  }

  /**
   * Seek to a specific time in seconds
   */
  seekTime(seconds: number): void {
    if (!this.ymFile) return;
    const frame = Math.floor(seconds * this.ymFile.header.frameRate);
    this.seek(frame);
  }

  /**
   * Get current playback position in seconds
   */
  getCurrentTime(): number {
    if (!this.ymFile) return 0;
    return this.currentFrame / this.ymFile.header.frameRate;
  }

  /**
   * Get total duration in seconds
   */
  getDuration(): number {
    if (!this.ymFile) return 0;
    return this.ymFile.header.frameCount / this.ymFile.header.frameRate;
  }

  getState(): ReplayerState {
    return this.state;
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  getFrameCount(): number {
    return this.ymFile?.header.frameCount ?? 0;
  }

  /**
   * Get current channel output levels for visualization.
   * Returns [channelA, channelB, channelC] with values 0-1.
   */
  getChannelLevels(): [number, number, number] {
    return this.ym.getChannelLevels();
  }

  /**
   * Process one frame
   */
  private tick(): void {
    if (!this.ymFile) return;

    const frame = this.ymFile.frames[this.currentFrame];
    this.applyFrame(frame);

    this.currentFrame++;

    // Handle looping
    if (this.currentFrame >= this.ymFile.header.frameCount) {
      this.currentFrame = this.ymFile.header.loopFrame;
    }

    this.notifyFrameChange();
  }

  /**
   * Apply a 16-byte register frame to the YM2149 emulator
   */
  private applyFrame(frame: Uint8Array): void {
    // R0-R1: Channel A period (12-bit)
    const periodA = frame[0] | ((frame[1] & 0x0f) << 8);
    this.ym.setChannelPeriod(0, periodA || 1);

    // R2-R3: Channel B period (12-bit)
    const periodB = frame[2] | ((frame[3] & 0x0f) << 8);
    this.ym.setChannelPeriod(1, periodB || 1);

    // R4-R5: Channel C period (12-bit)
    const periodC = frame[4] | ((frame[5] & 0x0f) << 8);
    this.ym.setChannelPeriod(2, periodC || 1);

    // R6: Noise period (5-bit)
    const noisePeriod = frame[6] & 0x1f;
    this.ym.setNoisePeriod(noisePeriod || 1);

    // R7: Mixer control - send the full register to worklet
    this.ym.setMixer(frame[7]);

    // R8-R10: Channel volumes with envelope enable bit
    this.ym.setChannelVolumeReg(0, frame[8]);
    this.ym.setChannelVolumeReg(1, frame[9]);
    this.ym.setChannelVolumeReg(2, frame[10]);

    // R11-R12: Envelope period (16-bit)
    const envPeriod = frame[11] | (frame[12] << 8);
    this.ym.setEnvelopePeriod(envPeriod || 1);

    // R13: Envelope shape (writing triggers restart on real hardware)
    // In YM files, 0xFF typically means "don't write to R13" (no trigger)
    if (frame[13] !== 0xff) {
      this.ym.setEnvelopeShape(frame[13] & 0x0f);
    }

    // Decode and apply special effects
    this.applyEffects(frame);
  }

  /**
   * Decode and apply YM special effects from register frame
   */
  private applyEffects(frame: Uint8Array): void {
    if (!this.ymFile) return;

    // YM2/YM3 formats don't have special effects
    const format = this.ymFile.header.format;
    if (format === 'YM2' || format === 'YM3' || format === 'YM3b') {
      return;
    }

    // Decode effects based on format (YM5 or YM6)
    const effects: Effect[] =
      format === 'YM6' ? [...decodeEffectsYm6(frame)] : decodeEffectsYm5(frame);

    // Track which effects are active this frame
    const sidActiveThisFrame: [boolean, boolean, boolean] = [false, false, false];
    const drumActiveThisFrame: [boolean, boolean, boolean] = [false, false, false];
    let syncBuzzerActiveThisFrame = false;

    for (const effect of effects) {
      switch (effect.type) {
        case 'sid':
        case 'sinusSid':
          if (effect.voice !== undefined && effect.freq && effect.volume !== undefined) {
            this.ym.startSid(effect.voice, effect.freq, effect.volume, effect.type === 'sinusSid');
            sidActiveThisFrame[effect.voice] = true;
          }
          break;

        case 'digidrum':
          if (
            effect.voice !== undefined &&
            effect.drumNum !== undefined &&
            effect.freq &&
            this.ymFile.digidrums.length > 0
          ) {
            this.ym.startDrum(effect.voice, effect.drumNum, effect.freq);
            drumActiveThisFrame[effect.voice] = true;
          }
          break;

        case 'syncBuzzer':
          if (effect.freq) {
            this.ym.startSyncBuzzer(effect.freq);
            syncBuzzerActiveThisFrame = true;
          }
          break;
      }
    }

    // Stop effects that were active but are no longer
    for (let ch = 0; ch < 3; ch++) {
      if (this.activeSid[ch] && !sidActiveThisFrame[ch]) {
        this.ym.stopSid(ch);
      }
      if (this.activeDrum[ch] && !drumActiveThisFrame[ch]) {
        // Don't stop drum mid-playback - let it finish naturally
        // this.ym.stopDrum(ch);
      }
    }

    if (this.activeSyncBuzzer && !syncBuzzerActiveThisFrame) {
      this.ym.stopSyncBuzzer();
    }

    // Update tracking state
    this.activeSid = sidActiveThisFrame;
    this.activeSyncBuzzer = syncBuzzerActiveThisFrame;
  }

  private notifyFrameChange(): void {
    this.callbacks.onFrameChange?.(this.currentFrame, this.ymFile?.header.frameCount ?? 0);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    if (this.ownsChip) {
      this.ym.dispose();
    }
    this.masterGain.disconnect();
  }
}
