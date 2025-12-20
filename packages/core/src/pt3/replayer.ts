/**
 * PT3 Replayer - Plays PT3 files using the YM2149 emulator
 * Extends BaseReplayer for common playback functionality
 */

import { YM2149 } from '../ym2149';
import { Pt3File } from './types';
import { parsePt3File } from './parser';
import { Pt3Player } from './player';
import {
  BaseReplayer,
  BaseReplayerCallbacks,
  BaseReplayerOptions,
  ReplayerState,
} from '../base-replayer';

export type Pt3ReplayerState = ReplayerState;
export type Pt3ReplayerOptions = BaseReplayerOptions;

export interface Pt3ReplayerCallbacks extends BaseReplayerCallbacks {
  onPositionChange?: (position: number, total: number) => void;
}

/** Default frame rate for PT3 files (50Hz PAL) */
const DEFAULT_FRAME_RATE = 50;

/** Default master clock for ZX Spectrum (1.7734MHz) */
const ZX_SPECTRUM_CLOCK = 1773400;

/**
 * PT3 Replayer - plays Pro Tracker 3 files through YM2149 emulator
 * Supports both single-chip and TurboSound (dual-chip) PT3 files
 */
export class Pt3Replayer extends BaseReplayer<Pt3File, Pt3ReplayerCallbacks> {
  private player: Pt3Player | null = null;
  private estimatedTotalFrames = 0;

  // TurboSound support
  private isTurboSound = false;
  private ym2: YM2149 | null = null;
  private player2: Pt3Player | null = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract property implementations
  // ─────────────────────────────────────────────────────────────────────────────

  protected get frameRate(): number {
    return DEFAULT_FRAME_RATE;
  }

  protected get totalFrames(): number {
    return this.estimatedTotalFrames;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract method implementations
  // ─────────────────────────────────────────────────────────────────────────────

  protected async onLoad(pt3File: Pt3File): Promise<void> {
    // Clean up any previous TurboSound resources
    if (this.ym2) {
      this.ym2.dispose();
      this.ym2 = null;
    }
    this.player2 = null;
    this.isTurboSound = false;

    this.player = new Pt3Player(pt3File);

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
    } else {
      // Single chip mode
      const internalClock = ZX_SPECTRUM_CLOCK / 8;
      this.ym.setInternalClock(internalClock);
    }

    // Calculate exact total frames by simulating playback
    this.estimatedTotalFrames = this.calculateTotalFrames(pt3File);
  }

  protected async onPlay(): Promise<void> {
    // Re-configure chip after start (worklet may have been recreated after stop)
    const internalClock = ZX_SPECTRUM_CLOCK / 8;
    this.ym.setInternalClock(internalClock);

    // Start second chip if TurboSound
    if (this.isTurboSound && this.ym2) {
      await this.ym2.start();
      this.ym2.setInternalClock(internalClock);
    }
  }

  protected processFrame(): boolean {
    if (!this.player) return false;

    // Check if song finished (check both players for TurboSound)
    const player1Finished = this.player.isFinished();
    const player2Finished = this.player2 ? this.player2.isFinished() : true;

    if (player1Finished && player2Finished) {
      // Signal to reset and loop
      return false;
    }

    // Get register values from first player and apply to first chip
    const regs1 = this.player.tick();
    this.applyRegisters(this.ym, regs1);

    // Process second player if TurboSound
    if (this.isTurboSound && this.player2 && this.ym2) {
      const regs2 = this.player2.tick();
      this.applyRegisters(this.ym2, regs2);
    }

    return true;
  }

  protected onSeek(targetFrame: number): void {
    if (!this.player) return;

    // Reset and fast-forward both players
    this.player.reset();
    this.player2?.reset();

    // Fast-forward to target frame (without audio output)
    for (let i = 0; i < targetFrame && !this.player.isFinished(); i++) {
      this.player.tick();
      this.player2?.tick();
    }
  }

  protected onReset(): void {
    this.player?.reset();
    this.player2?.reset();
  }

  protected silenceChip(): void {
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
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PT3-specific public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Load a PT3 file from raw bytes
   */
  async loadFromData(data: Uint8Array): Promise<Pt3File> {
    const pt3File = parsePt3File(data);
    await this.load(pt3File);
    return pt3File;
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
   * Override getChannelLevels to combine TurboSound levels
   */
  override getChannelLevels(): [number, number, number] {
    const levels1 = this.ym.getChannelLevels();
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
   * Override stop to handle TurboSound cleanup
   */
  override async stop(): Promise<void> {
    await super.stop();

    // Stop second chip if TurboSound
    if (this.ym2) {
      await this.ym2.stop();
    }
  }

  /**
   * Override dispose to clean up TurboSound resources
   */
  override dispose(): void {
    // Clean up second chip if TurboSound
    if (this.ym2) {
      this.ym2.dispose();
      this.ym2 = null;
    }

    super.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Protected overrides
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Override notifyFrameChange to include position changes
   */
  protected override notifyFrameChange(): void {
    super.notifyFrameChange();
    this.callbacks.onPositionChange?.(
      this.player?.getCurrentPosition() ?? 0,
      this.player?.getTotalPositions() ?? 0,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Calculate exact total frames by simulating playback until the song loops.
   * This accounts for variable delays (tempo changes), pattern lengths, and B1 effects.
   */
  private calculateTotalFrames(pt3: Pt3File): number {
    const player = new Pt3Player(pt3);
    let frameCount = 0;

    // Safety limit: 30 minutes at 50fps
    const MAX_FRAMES = 50 * 60 * 30;

    // Run until the song loops or hits an error
    while (player.getLoopCount() === 0 && !player.isFinished() && frameCount < MAX_FRAMES) {
      player.tick();
      frameCount++;
    }

    return frameCount;
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
}
