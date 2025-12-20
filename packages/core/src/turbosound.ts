/**
 * TurboSound - Dual YM2149 chip configuration
 *
 * Manages two YM2149 chips with combined stereo output.
 * Common in ZX Spectrum clones and some Atari ST configurations.
 */

import { YM2149 } from './ym2149';

/**
 * Configuration options for TurboSound
 */
export interface TurboSoundOptions {
  /** AudioContext to use (required) */
  audioContext: AudioContext;

  /** Final destination node for mixed output (defaults to audioContext.destination) */
  destination?: AudioNode;
}

/**
 * TurboSound - Dual YM2149 chip configuration
 *
 * Manages two YM2149 chips (A and B) with combined stereo output.
 * Both chips output to a shared master gain node for unified volume control.
 *
 * @example
 * ```typescript
 * const audioContext = new AudioContext();
 * const turboSound = new TurboSound({ audioContext });
 *
 * // Set stereo panning for each chip
 * turboSound.chipA.setChannelPan(0, -0.7);  // A left
 * turboSound.chipA.setChannelPan(1, 0.7);   // B right
 * turboSound.chipA.setChannelPan(2, 0);     // C center
 *
 * await turboSound.start();
 * turboSound.setMasterVolume(0.7);
 * ```
 */
export class TurboSound {
  /** The AudioContext this TurboSound uses */
  readonly audioContext: AudioContext;

  /** First YM2149 chip */
  readonly chipA: YM2149;

  /** Second YM2149 chip */
  readonly chipB: YM2149;

  /** Master gain node for combined volume control */
  readonly masterGain: GainNode;

  /** The final destination node */
  private readonly destination: AudioNode;

  constructor(options: TurboSoundOptions) {
    if (!options.audioContext) {
      throw new Error('TurboSound requires an AudioContext');
    }

    this.audioContext = options.audioContext;
    this.destination = options.destination ?? options.audioContext.destination;

    // Create master gain for combined volume control
    this.masterGain = new GainNode(this.audioContext, { gain: 0.5 });
    this.masterGain.connect(this.destination);

    // Create both chips connected to master gain
    this.chipA = new YM2149({
      audioContext: this.audioContext,
      destination: this.masterGain,
    });

    this.chipB = new YM2149({
      audioContext: this.audioContext,
      destination: this.masterGain,
    });
  }

  /**
   * Start both chips (initializes worklets)
   */
  async start(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    await Promise.all([this.chipA.start(), this.chipB.start()]);
  }

  /**
   * Stop both chips
   */
  async stop(): Promise<void> {
    await Promise.all([this.chipA.stop(), this.chipB.stop()]);
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.chipA.dispose();
    this.chipB.dispose();
    this.masterGain.disconnect();
  }

  /**
   * Set master volume for both chips combined (0.0 to 1.0)
   */
  setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.masterGain.gain.value = clamped;
  }

  /**
   * Get combined channel levels from both chips
   * Returns [A0, A1, A2, B0, B1, B2] with values 0-1
   */
  getChannelLevels(): [number, number, number, number, number, number] {
    const [a0, a1, a2] = this.chipA.getChannelLevels();
    const [b0, b1, b2] = this.chipB.getChannelLevels();
    return [a0, a1, a2, b0, b1, b2];
  }
}
