/**
 * YM2149 Hardware Envelope Generator
 *
 * The envelope runs at the internal clock rate (masterClock / 8 = 250kHz).
 * Each time the counter reaches the period, the position advances by 1.
 * Position ranges from -64 to +63, giving 128 steps through the waveform.
 */

import { ENV_DATA, ENV_VOLUME_TABLE, SHAPE_TO_ENV } from './tables';

export class EnvelopeGenerator {
  private counter = 0;
  private period = 0;
  private position = 0;  // -64 to 63
  private dataOffset = 0;
  private lastShape = -1;  // Track shape changes

  /**
   * Set the envelope period from registers R11 (low) and R12 (high)
   */
  setPeriod(period: number): void {
    this.period = Math.max(1, period);  // Avoid division by zero
  }

  /**
   * Set the envelope shape from register R13
   * Writing to R13 always triggers an envelope restart
   */
  setShape(shape: number): void {
    const shapeIndex = shape & 0x0f;
    this.dataOffset = SHAPE_TO_ENV[shapeIndex] * 128;
    this.position = -64;
    this.counter = 0;
    this.lastShape = shape;
  }

  /**
   * Check if shape changed (for detecting R13 writes in YM files)
   */
  hasShapeChanged(newShape: number): boolean {
    return this.lastShape !== newShape && this.lastShape !== -1;
  }

  /**
   * Advance the envelope by a number of internal clock ticks
   * At 50Hz frame rate with 250kHz internal clock, that's 5000 ticks per frame
   */
  tick(ticks: number): void {
    if (this.period === 0) return;

    this.counter += ticks;

    // How many steps to advance?
    const steps = Math.floor(this.counter / this.period);
    this.counter %= this.period;

    if (steps > 0) {
      this.position += steps;

      // Envelope has two phases:
      // 1. Attack/decay: position -64 to 0 (indices 0-64)
      // 2. Sustain/loop: position 0 to 63 (indices 64-127), cycling forever
      // After position exceeds 63, wrap to cycle in the 0-63 sustain range
      if (this.position > 63) {
        // Use modulo to properly cycle through 0-63 range
        // position 64 → 0, position 127 → 63, position 128 → 0, etc.
        this.position = (this.position - 64) % 64;
      }
    }
  }

  /**
   * Get the current envelope level (0-31)
   */
  getLevel(): number {
    const index = this.dataOffset + this.position + 64;
    return ENV_DATA[index] ?? 0;
  }

  /**
   * Get the current envelope level as a normalized volume (0-1)
   */
  getVolume(): number {
    const level = this.getLevel();
    return ENV_VOLUME_TABLE[level] ?? 0;
  }

  /**
   * Reset the envelope to initial state
   */
  reset(): void {
    this.counter = 0;
    this.position = -64;  // Start at beginning of waveform
    this.dataOffset = 0;
    this.lastShape = -1;
  }

  /**
   * Calculate how many internal clock ticks occur per frame
   * @param frameRate - typically 50Hz
   * @param masterClock - chip master clock from YM file (e.g., 2000000 for Atari ST)
   */
  static ticksPerFrame(frameRate: number, masterClock: number = 2_000_000): number {
    const internalClock = masterClock / 8;  // YM2149 divides master clock by 8
    return Math.floor(internalClock / frameRate);
  }
}
