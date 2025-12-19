/**
 * YM file replayer using Web Audio API
 */

import { YmFile } from './ym-parser';
import { YM2149 } from './ym2149';
import { EnvelopeGenerator } from './envelope';

export type ReplayerState = 'stopped' | 'playing' | 'paused';

export interface ReplayerCallbacks {
  onStateChange?: (state: ReplayerState) => void;
  onFrameChange?: (frame: number, total: number) => void;
  onError?: (error: Error) => void;
}

/**
 * YM file replayer
 */
export class YmReplayer {
  private ym: YM2149;
  private envelope: EnvelopeGenerator;
  private ymFile: YmFile | null = null;
  private currentFrame = 0;
  private state: ReplayerState = 'stopped';
  private intervalId: number | null = null;
  private callbacks: ReplayerCallbacks = {};
  private ticksPerFrame = 5000;  // Will be recalculated on load
  private internalClock = 250000;  // Will be recalculated on load
  private currentEnvShape = 0;
  private currentEnvPeriod = 0;

  constructor() {
    this.ym = new YM2149();
    this.envelope = new EnvelopeGenerator();
  }

  get audioContext(): AudioContext {
    return this.ym.audioContext;
  }

  setCallbacks(callbacks: ReplayerCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Load a YM file for playback
   */
  load(ymFile: YmFile): void {
    this.stop();
    this.ymFile = ymFile;
    this.currentFrame = 0;
    this.envelope.reset();

    // Calculate internal clock from master clock
    this.internalClock = ymFile.header.masterClock / 8;

    // Calculate internal clock ticks per frame based on file's frame rate and master clock
    this.ticksPerFrame = EnvelopeGenerator.ticksPerFrame(
      ymFile.header.frameRate,
      ymFile.header.masterClock
    );

    // Reset envelope state
    this.currentEnvShape = 0;
    this.currentEnvPeriod = 0;

    // Debug: Analyze R13 retrigger pattern
    this.analyzeEnvelopePattern(ymFile);

    this.notifyFrameChange();
  }

  /**
   * Debug: Analyze envelope retrigger pattern in the YM file
   */
  private analyzeEnvelopePattern(ymFile: YmFile): void {
    let r13Writes = 0;
    let r13Values: Record<number, number> = {};

    for (let i = 0; i < Math.min(ymFile.header.frameCount, 500); i++) {
      const r13 = ymFile.frames[i][13];
      r13Values[r13] = (r13Values[r13] || 0) + 1;
      if (r13 !== 0xff) {
        r13Writes++;
      }
    }

    const frameRate = ymFile.header.frameRate;
    const retriggersPerSec = (r13Writes / 500) * frameRate;

    console.log('=== Envelope Analysis (first 500 frames) ===');
    console.log('Master clock:', ymFile.header.masterClock);
    console.log('Frame rate:', frameRate);
    console.log('Ticks per frame:', this.ticksPerFrame);
    console.log('R13 writes (non-0xFF):', r13Writes, '/', 500);
    console.log('Estimated retrigger rate:', retriggersPerSec.toFixed(1), 'Hz');
    console.log('R13 value distribution:', r13Values);

    // Also check envelope period values
    const periods: number[] = [];
    for (let i = 0; i < Math.min(ymFile.header.frameCount, 100); i++) {
      const period = ymFile.frames[i][11] | (ymFile.frames[i][12] << 8);
      if (period > 0) periods.push(period);
    }
    if (periods.length > 0) {
      const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
      const internalClock = ymFile.header.masterClock / 8;
      const envCycleFreq = internalClock / (avgPeriod * 64);
      console.log('Average envelope period:', avgPeriod.toFixed(0));
      console.log('Envelope cycle frequency:', envCycleFreq.toFixed(1), 'Hz');
    }
    console.log('============================================');

    // Analyze channel usage patterns for first 100 frames
    console.log('=== Channel Analysis (first 100 frames) ===');
    const channelInfo: { periods: number[], volumes: number[], envEnabled: boolean[] }[] = [
      { periods: [], volumes: [], envEnabled: [] },
      { periods: [], volumes: [], envEnabled: [] },
      { periods: [], volumes: [], envEnabled: [] },
    ];

    for (let i = 0; i < Math.min(ymFile.header.frameCount, 100); i++) {
      const frame = ymFile.frames[i];
      for (let ch = 0; ch < 3; ch++) {
        const period = frame[ch * 2] | ((frame[ch * 2 + 1] & 0x0f) << 8);
        const vol = frame[8 + ch] & 0x0f;
        const envEnabled = (frame[8 + ch] & 0x10) !== 0;
        if (period > 0) channelInfo[ch].periods.push(period);
        channelInfo[ch].volumes.push(vol);
        channelInfo[ch].envEnabled.push(envEnabled);
      }
    }

    for (let ch = 0; ch < 3; ch++) {
      const periods = channelInfo[ch].periods;
      const envCount = channelInfo[ch].envEnabled.filter(e => e).length;
      if (periods.length > 0) {
        const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
        const minPeriod = Math.min(...periods);
        const maxPeriod = Math.max(...periods);
        const uniquePeriods = new Set(periods).size;
        console.log(`Channel ${ch}: periods ${minPeriod}-${maxPeriod} (avg ${avgPeriod.toFixed(0)}), ` +
          `${uniquePeriods} unique values, env enabled ${envCount}/${periods.length} frames`);
      }
    }

    // Check for dual-channel patterns (similar periods on multiple channels)
    const frame50 = ymFile.frames[Math.min(50, ymFile.header.frameCount - 1)];
    const frame50Periods = [
      frame50[0] | ((frame50[1] & 0x0f) << 8),
      frame50[2] | ((frame50[3] & 0x0f) << 8),
      frame50[4] | ((frame50[5] & 0x0f) << 8),
    ];
    console.log('Frame 50 periods:', frame50Periods);
    console.log('============================================');
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

    // Reset envelope
    this.envelope.reset();

    // Silence all channels
    this.ym.setChannelVolume(0, 0);
    this.ym.setChannelVolume(1, 0);
    this.ym.setChannelVolume(2, 0);
    this.ym.setNoiseEnabled(false);

    await this.ym.stop();
  }

  /**
   * Seek to a specific frame
   */
  seek(frame: number): void {
    if (!this.ymFile) return;
    this.currentFrame = Math.max(0, Math.min(frame, this.ymFile.header.frameCount - 1));
    // Reset envelope on seek since we don't know the envelope state at arbitrary frames
    this.envelope.reset();
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
   * Process one frame
   */
  private tick(): void {
    if (!this.ymFile) return;

    const frame = this.ymFile.frames[this.currentFrame];
    this.applyFrame(frame);

    // Advance envelope by one frame's worth of internal clock ticks
    this.envelope.tick(this.ticksPerFrame);

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

    // R7: Mixer control (inverted logic: 0 = enabled)
    const mixer = frame[7];
    const toneA = (mixer & 0x01) === 0;
    const toneB = (mixer & 0x02) === 0;
    const toneC = (mixer & 0x04) === 0;
    const noiseA = (mixer & 0x08) === 0;
    const noiseB = (mixer & 0x10) === 0;
    const noiseC = (mixer & 0x20) === 0;

    this.ym.setChannelTone(0, toneA);
    this.ym.setChannelTone(1, toneB);
    this.ym.setChannelTone(2, toneC);

    // Enable noise if any channel has noise enabled
    this.ym.setNoiseEnabled(noiseA || noiseB || noiseC);

    // R11-R12: Envelope period (16-bit)
    const envPeriod = frame[11] | (frame[12] << 8);
    this.envelope.setPeriod(envPeriod);

    // R13: Envelope shape (writing triggers restart on real hardware)
    // In YM files, 0xFF typically means "don't write to R13" (no trigger)
    // Any other value triggers envelope restart
    const envShapeRaw = frame[13];
    if (envShapeRaw !== 0xff) {
      const envShape = envShapeRaw & 0x0f;
      // Always trigger restart when R13 is written (not 0xFF)
      // This is how real hardware works - any write to R13 restarts envelope
      this.envelope.setShape(envShape);
      this.currentEnvShape = envShape;
    }

    // Track envelope period changes
    if (envPeriod !== this.currentEnvPeriod) {
      this.currentEnvPeriod = envPeriod;
    }

    // Calculate envelope frequency for LFO
    // Envelope cycles through 64 steps (sustain loop), so freq = internalClock / (period * 64)
    const envFrequency = this.currentEnvPeriod > 0
      ? this.internalClock / (this.currentEnvPeriod * 64)
      : 0;

    // Map envelope shape to Web Audio waveform
    // Shapes 2, 6: sawtooth (continuous ramp)
    // Shapes 4, 8, 10, 14: triangle (continuous alternating)
    // Other shapes decay/attack and hold - use triangle as approximation
    const isLoopingShape = [2, 4, 6, 8, 10, 14].includes(this.currentEnvShape);
    const waveform: OscillatorType = [2, 6].includes(this.currentEnvShape) ? 'sawtooth' : 'triangle';

    // R8-R10: Channel volumes (4-bit, bit 4 = envelope mode)
    const volA = frame[8] & 0x0f;
    const volB = frame[9] & 0x0f;
    const volC = frame[10] & 0x0f;

    const useEnvA = (frame[8] & 0x10) !== 0;
    const useEnvB = (frame[9] & 0x10) !== 0;
    const useEnvC = (frame[10] & 0x10) !== 0;

    // Apply volumes - use LFO-based envelope for audio-rate modulation
    // This allows envelope frequencies above frame rate (50Hz)
    if (useEnvA && isLoopingShape && envFrequency > 0) {
      this.ym.setChannelEnvelopeLfo(0, envFrequency, waveform);
      this.ym.setChannelEnvelopeEnabled(0, true);
    } else if (useEnvA) {
      // Non-looping shape or zero period - use frame-rate envelope
      this.ym.setChannelEnvelopeEnabled(0, false);
      this.ym.setChannelVolumeRaw(0, this.envelope.getVolume());
    } else {
      this.ym.setChannelEnvelopeEnabled(0, false);
      this.ym.setChannelVolume(0, volA);
    }

    if (useEnvB && isLoopingShape && envFrequency > 0) {
      this.ym.setChannelEnvelopeLfo(1, envFrequency, waveform);
      this.ym.setChannelEnvelopeEnabled(1, true);
    } else if (useEnvB) {
      this.ym.setChannelEnvelopeEnabled(1, false);
      this.ym.setChannelVolumeRaw(1, this.envelope.getVolume());
    } else {
      this.ym.setChannelEnvelopeEnabled(1, false);
      this.ym.setChannelVolume(1, volB);
    }

    if (useEnvC && isLoopingShape && envFrequency > 0) {
      this.ym.setChannelEnvelopeLfo(2, envFrequency, waveform);
      this.ym.setChannelEnvelopeEnabled(2, true);
    } else if (useEnvC) {
      this.ym.setChannelEnvelopeEnabled(2, false);
      this.ym.setChannelVolumeRaw(2, this.envelope.getVolume());
    } else {
      this.ym.setChannelEnvelopeEnabled(2, false);
      this.ym.setChannelVolume(2, volC);
    }
  }

  private notifyFrameChange(): void {
    this.callbacks.onFrameChange?.(
      this.currentFrame,
      this.ymFile?.header.frameCount ?? 0
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
