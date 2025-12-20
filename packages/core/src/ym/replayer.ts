/**
 * YM file replayer using AudioWorklet-based YM2149 emulation
 * Extends BaseReplayer for common playback functionality
 */

import { YmFile } from './parser';
import { decodeEffectsYm5, decodeEffectsYm6, Effect } from './effects';
import {
  BaseReplayer,
  BaseReplayerCallbacks,
  BaseReplayerOptions,
  ReplayerState,
} from '../base-replayer';

export type { ReplayerState };
export type YmReplayerCallbacks = BaseReplayerCallbacks;
export type ReplayerCallbacks = YmReplayerCallbacks;
export type YmReplayerOptions = BaseReplayerOptions;

/**
 * YM file replayer
 */
export class YmReplayer extends BaseReplayer<YmFile, YmReplayerCallbacks> {
  // Effect tracking state
  private activeSid: [boolean, boolean, boolean] = [false, false, false];
  private activeSyncBuzzer = false;

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract property implementations
  // ─────────────────────────────────────────────────────────────────────────────

  protected get frameRate(): number {
    return this.file?.header.frameRate ?? 50;
  }

  protected get totalFrames(): number {
    return this.file?.header.frameCount ?? 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Abstract method implementations
  // ─────────────────────────────────────────────────────────────────────────────

  protected async onLoad(ymFile: YmFile): Promise<void> {
    // Set internal clock from YM file's master clock
    const internalClock = ymFile.header.masterClock / 8;
    this.ym.setInternalClock(internalClock);

    // Load DigiDrum samples if present
    if (ymFile.digidrums.length > 0) {
      this.ym.loadDrumSamples(ymFile.digidrums);
    }

    // Reset effect tracking
    this.resetEffects();
  }

  protected async onPlay(): Promise<void> {
    if (!this.file) return;

    // Re-configure chip after start (worklet may have been recreated after stop)
    const internalClock = this.file.header.masterClock / 8;
    this.ym.setInternalClock(internalClock);

    if (this.file.digidrums.length > 0) {
      this.ym.loadDrumSamples(this.file.digidrums);
    }

    // Reset effect tracking if coming from stopped state
    if (this.state === 'stopped') {
      this.resetEffects();
    }
  }

  protected processFrame(): boolean {
    if (!this.file) return false;

    // Check for end of song
    if (this.currentFrame >= this.file.header.frameCount) {
      // Handle looping - set current frame to loop point
      this.currentFrame = this.file.header.loopFrame;
    }

    const frame = this.file.frames[this.currentFrame];
    this.applyFrame(frame);

    return true;
  }

  protected onSeek(_targetFrame: number): void {
    // YM files support direct frame access, no special handling needed
    // Just reset effect tracking since we're jumping to a new position
    this.resetEffects();
  }

  protected onReset(): void {
    this.resetEffects();
  }

  protected silenceChip(): void {
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
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private resetEffects(): void {
    this.activeSid = [false, false, false];
    this.activeSyncBuzzer = false;
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
    if (!this.file) return;

    // YM2/YM3 formats don't have special effects
    const format = this.file.header.format;
    if (format === 'YM2' || format === 'YM3' || format === 'YM3b') {
      return;
    }

    // Decode effects based on format (YM5 or YM6)
    const effects: Effect[] =
      format === 'YM6' ? [...decodeEffectsYm6(frame)] : decodeEffectsYm5(frame);

    // Track which effects are active this frame
    const sidActiveThisFrame: [boolean, boolean, boolean] = [false, false, false];
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
          // Drums play to completion, no tracking needed
          if (
            effect.voice !== undefined &&
            effect.drumNum !== undefined &&
            effect.freq &&
            this.file.digidrums.length > 0
          ) {
            this.ym.startDrum(effect.voice, effect.drumNum, effect.freq);
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
      // Don't stop drum mid-playback - let it finish naturally
    }

    if (this.activeSyncBuzzer && !syncBuzzerActiveThisFrame) {
      this.ym.stopSyncBuzzer();
    }

    // Update tracking state
    this.activeSid = sidActiveThisFrame;
    this.activeSyncBuzzer = syncBuzzerActiveThisFrame;
  }
}
