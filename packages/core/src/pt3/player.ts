/**
 * PT3 Player - Pattern Interpreter and Register Generator
 *
 * Ported from Ay_Emul by Sergey Bulba (Formats.pas lines 8823-9090)
 */

import { getToneTable, getVolumeTable, ToneTable } from './tables';
import {
  Pt3File,
  Pt3ChannelState,
  Pt3PlayerState,
  AyRegisters,
  createPlayerState,
  createAyRegisters,
} from './types';

/**
 * PT3 Player class - interprets PT3 patterns and generates AY register frames
 */
export class Pt3Player {
  private file: Pt3File;
  private state: Pt3PlayerState;
  private toneTable: ToneTable;
  private volumeTable: readonly (readonly number[])[];
  private finished: boolean = false;

  constructor(file: Pt3File) {
    this.file = file;
    // Ensure delay is at least 1 to prevent hanging
    this.state = createPlayerState(file.version, Math.max(1, file.delay));
    this.toneTable = getToneTable(file.toneTableId, file.version);
    this.volumeTable = getVolumeTable(file.version);

    // Initialize channels with first position
    this.initPosition(0);
  }

  /**
   * Check if playback has finished
   */
  isFinished(): boolean {
    return this.finished;
  }

  /**
   * Reset player to beginning
   */
  reset(): void {
    this.state = createPlayerState(this.file.version, this.file.delay);
    this.finished = false;
    this.initPosition(0);
  }

  /**
   * Get current position
   */
  getCurrentPosition(): number {
    return this.state.currentPosition;
  }

  /**
   * Get total positions
   */
  getTotalPositions(): number {
    return this.file.numberOfPositions;
  }

  /**
   * Process one tick and return AY register values
   */
  tick(): AyRegisters {
    const regs = createAyRegisters();

    if (this.finished) {
      return regs;
    }

    // Decrement delay counter
    this.state.delayCounter--;

    if (this.state.delayCounter <= 0) {
      // First, decrement all noteSkipCounters
      for (let ch = 0; ch < 3; ch++) {
        this.state.channels[ch].noteSkipCounter--;
      }

      // Check if ANY channel has reached end-of-pattern (before processing)
      // This must be done separately to avoid mid-loop position changes
      let needsPositionChange = false;
      for (let ch = 0; ch < 3; ch++) {
        const chan = this.state.channels[ch];
        if (chan.noteSkipCounter <= 0) {
          const patternByte = this.getPatternByte(ch, chan.addressInPattern);
          if (patternByte === 0) {
            needsPositionChange = true;
            break;
          }
        }
      }

      // If any channel hit end-of-pattern, advance ALL channels to next position
      if (needsPositionChange) {
        this.state.currentPosition++;

        if (this.state.currentPosition >= this.file.numberOfPositions) {
          this.state.currentPosition = this.file.loopPosition;
        }

        this.initPosition(this.state.currentPosition);

        // Reset all noteSkipCounters to ensure all channels process the first row
        for (let ch = 0; ch < 3; ch++) {
          this.state.channels[ch].noteSkipCounter = 0;
        }
      }

      // Now process pattern rows for each channel
      for (let ch = 0; ch < 3; ch++) {
        const chan = this.state.channels[ch];

        if (chan.noteSkipCounter <= 0) {
          this.interpretPattern(ch);
        }
      }

      // Ensure delay is at least 1 to prevent hanging
      this.state.delayCounter = Math.max(1, this.state.delay);
    }

    // Generate register values
    this.generateRegisters(regs);

    return regs;
  }

  /**
   * Initialize player for a specific position
   */
  private initPosition(position: number): void {
    if (position >= this.file.numberOfPositions) {
      this.finished = true;
      return;
    }

    const posValue = this.file.positionList[position];
    const patternNum = Math.floor(posValue / 3);

    if (patternNum >= this.file.patterns.length) {
      this.finished = true;
      return;
    }

    const pattern = this.file.patterns[patternNum];

    // Reset channel addresses to pattern start
    this.state.channels[0].addressInPattern = 0;
    this.state.channels[1].addressInPattern = 0;
    this.state.channels[2].addressInPattern = 0;

    // Store pattern data references (we'll need to track them)
    // For simplicity, we store the pattern index
    (this.state.channels[0] as ChannelStateExt).patternData = pattern.channelA;
    (this.state.channels[1] as ChannelStateExt).patternData = pattern.channelB;
    (this.state.channels[2] as ChannelStateExt).patternData = pattern.channelC;
  }

  /**
   * Get byte from pattern data for a channel
   */
  private getPatternByte(channel: number, offset: number): number {
    const patternData = (this.state.channels[channel] as ChannelStateExt).patternData;
    if (!patternData || offset >= patternData.length) {
      return 0;
    }
    return patternData[offset];
  }

  /**
   * Interpret pattern commands for a channel
   *
   * PT3 pattern row structure: commands followed by note/terminator.
   * IMPORTANT: Effect parameters (0x01-0x09) are placed AFTER the row ends,
   * not immediately after the effect code! Multiple effects have their
   * parameters in reverse order (last effect's params first).
   */
  private interpretPattern(channel: number): void {
    const chan = this.state.channels[channel];
    let quit = false;

    // Collect effect types encountered during row parsing
    // Parameters will be read AFTER the row ends
    const effects: number[] = [];

    const prNote = chan.note;
    const prSliding = chan.currentTonSliding;

    // First pass: parse row commands, collect effect types
    let iterations = 0;
    while (!quit) {
      iterations++;
      if (iterations > 100) {
        console.error(`[PT3] INFINITE LOOP in interpretPattern ch${channel}! Breaking out.`);
        break;
      }

      const byte = this.getPatternByte(channel, chan.addressInPattern);

      if (byte === 0x00) {
        // $00: End of track - stop processing this row
        // Don't increment addressInPattern so we stay at the end marker
        quit = true;
        continue;
      } else if (byte >= 0xf0) {
        // $F0-$FF: Ornament + Sample
        const ornNum = byte - 0xf0;
        this.setOrnament(chan, ornNum);
        chan.addressInPattern++;
        const sampleByte = this.getPatternByte(channel, chan.addressInPattern);
        this.setSample(chan, Math.floor(sampleByte / 2));
        chan.envelopeEnabled = false;
        chan.positionInOrnament = 0;
      } else if (byte >= 0xd1 && byte <= 0xef) {
        // $D1-$EF: Sample 1-31
        this.setSample(chan, byte - 0xd0);
      } else if (byte === 0xd0) {
        // $D0: End of pattern row
        quit = true;
      } else if (byte >= 0xc1 && byte <= 0xcf) {
        // $C1-$CF: Volume 1-15
        chan.volume = byte - 0xc0;
      } else if (byte === 0xc0) {
        // $C0: Note off (pause)
        chan.positionInSample = 0;
        chan.currentAmplitudeSliding = 0;
        chan.currentNoiseSliding = 0;
        chan.currentEnvelopeSliding = 0;
        chan.positionInOrnament = 0;
        chan.tonSlideCount = 0;
        chan.currentTonSliding = 0;
        chan.tonAccumulator = 0;
        chan.currentOnOff = 0;
        chan.enabled = false;
        quit = true;
      } else if (byte >= 0xb2 && byte <= 0xbf) {
        // $Bx (x>=2): Enable envelope type x-1 with period (no sample change)
        chan.envelopeEnabled = true;
        this.state.newEnvelopeShape = byte - 0xb1; // $B2 = shape 1, $B8 = shape 7, etc.
        chan.addressInPattern++;
        this.state.envBaseHi = this.getPatternByte(channel, chan.addressInPattern);
        chan.addressInPattern++;
        this.state.envBaseLo = this.getPatternByte(channel, chan.addressInPattern);
        chan.positionInOrnament = 0;
        this.state.curEnvSlide = 0;
        this.state.curEnvDelay = 0;
      } else if (byte === 0xb1) {
        // $B1: Set note skip - parameter is INLINE (not after row end like 0x01-0x09)
        chan.addressInPattern++;
        chan.numberOfNotesToSkip = this.getPatternByte(channel, chan.addressInPattern);
      } else if (byte === 0xb0) {
        // $B0: Disable envelope
        chan.envelopeEnabled = false;
        chan.positionInOrnament = 0;
      } else if (byte >= 0x50 && byte <= 0xaf) {
        // $50-$AF: Note 0-95 - ends row
        chan.note = byte - 0x50;
        chan.positionInSample = 0;
        chan.currentAmplitudeSliding = 0;
        chan.currentNoiseSliding = 0;
        chan.currentEnvelopeSliding = 0;
        chan.positionInOrnament = 0;
        chan.tonSlideCount = 0;
        chan.currentTonSliding = 0;
        chan.tonAccumulator = 0;
        chan.currentOnOff = 0;
        chan.enabled = true;
        quit = true;
      } else if (byte >= 0x40 && byte <= 0x4f) {
        // $40-$4F: Ornament 0-15 only (envelope not affected)
        this.setOrnament(chan, byte - 0x40);
        chan.positionInOrnament = 0;
      } else if (byte >= 0x20 && byte <= 0x3f) {
        // $20-$3F: Noise base (only in channel B according to doc)
        this.state.noiseBase = byte - 0x20;
      } else if (byte >= 0x10 && byte <= 0x1f) {
        // $10-$1F: Envelope + Sample
        if (byte === 0x10) {
          // $10: Disable envelope, restart ornament, change sample
          chan.envelopeEnabled = false;
        } else {
          // $1x (x>=1): Enable envelope with shape x, restart ornament, change sample
          // Reference: Ay_Emul uses (byte - $10), giving $11 = shape 1, $1E = shape 14
          chan.envelopeEnabled = true;
          this.state.newEnvelopeShape = byte - 0x10;
          chan.addressInPattern++;
          this.state.envBaseHi = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          this.state.envBaseLo = this.getPatternByte(channel, chan.addressInPattern);
          chan.positionInOrnament = 0;
          this.state.curEnvSlide = 0;
          this.state.curEnvDelay = 0;
        }
        chan.addressInPattern++;
        const sampleByte = this.getPatternByte(channel, chan.addressInPattern);
        this.setSample(chan, Math.floor(sampleByte / 2));
        chan.positionInOrnament = 0;
      } else if (byte >= 0x01 && byte <= 0x09) {
        // Effects 0x01-0x09: just record the effect type
        // Parameters come AFTER the row ends!
        effects.push(byte);
      } else {
        // Unknown byte (0x0A-0x0F or other) - skip it
        // This shouldn't happen in valid PT3 files
      }

      chan.addressInPattern++;
    }

    // Second pass: read effect parameters AFTER the row end
    // Parameters are in reverse order (last effect's params first)
    for (let i = effects.length - 1; i >= 0; i--) {
      const effectType = effects[i];

      switch (effectType) {
        case 0x01: {
          // Simple glissando: delay(1) + step(2)
          chan.tonSlideDelay = this.getPatternByte(channel, chan.addressInPattern);
          chan.tonSlideCount = chan.tonSlideDelay;
          chan.addressInPattern++;
          const stepLo = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          const stepHi = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          chan.tonSlideStep = stepLo | (stepHi << 8);
          // Convert to signed
          if (chan.tonSlideStep > 32767) {
            chan.tonSlideStep -= 65536;
          }
          chan.simpleGliss = true;
          chan.currentOnOff = 0;
          break;
        }
        case 0x02: {
          // Portamento: delay(1) + maxOffset(2, unused in v3.6+) + step(2)
          chan.simpleGliss = false;
          chan.currentOnOff = 0;
          chan.tonSlideDelay = this.getPatternByte(channel, chan.addressInPattern);
          chan.tonSlideCount = chan.tonSlideDelay;
          chan.addressInPattern++;
          // Skip unused max offset bytes
          chan.addressInPattern += 2;
          const stepLo = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          const stepHi = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          let step = stepLo | (stepHi << 8);
          if (step > 32767) step -= 65536;
          chan.tonSlideStep = Math.abs(step);

          chan.tonDelta = this.toneTable[chan.note] - this.toneTable[prNote];
          chan.slideToNote = chan.note;
          chan.note = prNote;

          if (this.state.version >= 6) {
            chan.currentTonSliding = prSliding;
          }

          if (chan.tonDelta - chan.currentTonSliding < 0) {
            chan.tonSlideStep = -chan.tonSlideStep;
          }
          break;
        }
        case 0x03:
          // Set sample position: offset(1)
          chan.positionInSample = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          break;
        case 0x04:
          // Set ornament position: offset(1)
          chan.positionInOrnament = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          break;
        case 0x05: {
          // Vibrato: onTime(1) + offTime(1)
          chan.onOffDelay = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          chan.offOnDelay = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          chan.currentOnOff = chan.onOffDelay;
          chan.tonSlideCount = 0;
          chan.currentTonSliding = 0;
          break;
        }
        case 0x08: {
          // Envelope slide: delay(1) + slideValue(2)
          this.state.envDelay = this.getPatternByte(channel, chan.addressInPattern);
          this.state.curEnvDelay = this.state.envDelay;
          chan.addressInPattern++;
          const slideLo = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          const slideHi = this.getPatternByte(channel, chan.addressInPattern);
          chan.addressInPattern++;
          this.state.envSlideAdd = slideLo | (slideHi << 8);
          if (this.state.envSlideAdd > 32767) {
            this.state.envSlideAdd -= 65536;
          }
          break;
        }
        case 0x09:
          // Set speed: tempo(1) - ensure at least 1 to prevent hanging
          this.state.delay = Math.max(1, this.getPatternByte(channel, chan.addressInPattern));
          chan.addressInPattern++;
          break;
        // Note: B1 is handled inline, not here
      }
    }

    // B1 sets how many rows to skip between notes
    // noteSkipCounter is decremented then checked against <= 0
    // With numberOfNotesToSkip=0: noteSkip=0, decrement=-1, <=0 triggers, every row
    // With numberOfNotesToSkip=1: noteSkip=1, decrement=0, <=0 triggers (might need adjustment for actual B1 usage)
    chan.noteSkipCounter = chan.numberOfNotesToSkip;
  }

  /**
   * Set sample for a channel
   */
  private setSample(chan: Pt3ChannelState, sampleNum: number): void {
    if (sampleNum >= 0 && sampleNum < this.file.samples.length) {
      const sample = this.file.samples[sampleNum];
      chan.sampleIndex = sampleNum;
      chan.loopSamplePosition = sample.loopPosition;
      chan.sampleLength = sample.length;
    }
  }

  /**
   * Set ornament for a channel
   */
  private setOrnament(chan: Pt3ChannelState, ornamentNum: number): void {
    if (ornamentNum >= 0 && ornamentNum < this.file.ornaments.length) {
      const ornament = this.file.ornaments[ornamentNum];
      chan.ornamentIndex = ornamentNum;
      chan.loopOrnamentPosition = ornament.loopPosition;
      chan.ornamentLength = ornament.length;
    }
  }

  /**
   * Generate AY register values from current state
   */
  private generateRegisters(regs: AyRegisters): void {
    let mixer = 0;
    let addToEnv = 0;
    this.state.addToNoise = 0; // Reset per tick

    for (let ch = 0; ch < 3; ch++) {
      const chan = this.state.channels[ch];

      if (chan.enabled) {
        const sample = this.file.samples[chan.sampleIndex];
        const ornament = this.file.ornaments[chan.ornamentIndex];

        if (!sample || sample.frames.length === 0) {
          mixer |= (0x09 << ch); // Mute both tone and noise
          continue;
        }

        const sampleFrame = sample.frames[Math.min(chan.positionInSample, sample.frames.length - 1)];

        // Calculate tone
        let tone = sampleFrame.toneOffset + chan.tonAccumulator;
        if (sampleFrame.accumulateTone) {
          chan.tonAccumulator = tone;
        }

        // Get note with ornament offset
        let note = chan.note;
        if (ornament && ornament.offsets.length > 0) {
          const ornOffset = ornament.offsets[Math.min(chan.positionInOrnament, ornament.offsets.length - 1)];
          note += ornOffset;
        }
        note = Math.max(0, Math.min(95, note));

        // Get base period from tone table
        const basePeriod = this.toneTable[note];
        tone = (tone + chan.currentTonSliding + basePeriod) & 0xfff;

        // Handle tone sliding
        if (chan.tonSlideCount > 0) {
          chan.tonSlideCount--;
          if (chan.tonSlideCount === 0) {
            chan.currentTonSliding += chan.tonSlideStep;
            chan.tonSlideCount = chan.tonSlideDelay;

            if (!chan.simpleGliss) {
              // Portamento - check if we've reached target
              if (
                (chan.tonSlideStep < 0 && chan.currentTonSliding <= chan.tonDelta) ||
                (chan.tonSlideStep >= 0 && chan.currentTonSliding >= chan.tonDelta)
              ) {
                chan.note = chan.slideToNote;
                chan.tonSlideCount = 0;
                chan.currentTonSliding = 0;
              }
            }
          }
        }

        // Handle vibrato (on/off) - toggles channel enabled state
        if (chan.currentOnOff > 0) {
          chan.currentOnOff--;
          if (chan.currentOnOff === 0) {
            chan.enabled = !chan.enabled;
            // Get next delay, but ensure it's at least 1 to prevent getting stuck
            const nextDelay = chan.enabled ? chan.onOffDelay : chan.offOnDelay;
            chan.currentOnOff = nextDelay > 0 ? nextDelay : 1;
          }
        }

        // Calculate amplitude
        // First get base amplitude and apply sliding (before volume scaling)
        let amplitude = sampleFrame.amplitude;

        // Apply amplitude sliding BEFORE volume scaling
        if (sampleFrame.amplitudeSlideEnabled) {
          chan.currentAmplitudeSliding += sampleFrame.amplitudeSlide;
          amplitude += chan.currentAmplitudeSliding;
        }

        // Clamp to valid range before volume table lookup
        amplitude = Math.max(0, Math.min(15, amplitude));

        // Apply volume scaling using volume table
        amplitude = this.volumeTable[chan.volume][amplitude];

        chan.amplitude = amplitude;

        // Set tone register
        if (ch === 0) regs.toneA = tone;
        else if (ch === 1) regs.toneB = tone;
        else regs.toneC = tone;

        // Set volume register
        // Reference: (b0 and 1 = 0) and Envelope_Enabled
        // Em bit (envelopeMask) = 0 means envelope can be used, = 1 masks it
        if (chan.envelopeEnabled && !sampleFrame.envelopeMask) {
          amplitude |= 0x10; // Set envelope bit
        }
        if (ch === 0) regs.volumeA = amplitude;
        else if (ch === 1) regs.volumeB = amplitude;
        else regs.volumeC = amplitude;

        // Update mixer
        if (sampleFrame.toneMask) {
          mixer |= (1 << ch); // Disable tone
        }
        if (sampleFrame.noiseMask) {
          mixer |= (8 << ch); // Disable noise
        }

        // Reference: When Nm (noiseMask) is SET, use N4-N0 for envelope offset
        // When Nm is CLEAR, use N4-N0 for noise offset
        if (sampleFrame.noiseMask) {
          // Noise disabled - use offset for envelope period adjustment
          let envValue = sampleFrame.noiseOffset; // N4-N0 as signed
          if (sampleFrame.accumulateNoise) {
            chan.currentEnvelopeSliding += envValue;
            envValue = chan.currentEnvelopeSliding;
          }
          addToEnv += envValue;
        } else {
          // Noise enabled - use offset for noise frequency
          let noiseValue = (sampleFrame.envelopeOffset) & 0x1f; // Raw N4-N0 as unsigned
          noiseValue += chan.currentNoiseSliding;
          if (sampleFrame.accumulateNoise) {
            chan.currentNoiseSliding = noiseValue;
          }
          this.state.addToNoise = noiseValue;
        }

        // Advance sample position
        chan.positionInSample++;
        if (chan.positionInSample >= chan.sampleLength) {
          chan.positionInSample = chan.loopSamplePosition;
        }

        // Advance ornament position
        chan.positionInOrnament++;
        if (chan.positionInOrnament >= chan.ornamentLength) {
          chan.positionInOrnament = chan.loopOrnamentPosition;
        }
      } else {
        // Channel disabled
        chan.amplitude = 0;
        if (ch === 0) regs.volumeA = 0;
        else if (ch === 1) regs.volumeB = 0;
        else regs.volumeC = 0;
        mixer |= (0x09 << ch); // Mute both tone and noise for this channel
      }
    }

    // Set noise register
    regs.noise = (this.state.noiseBase + this.state.addToNoise) & 0x1f;

    // Handle envelope
    let envPeriod = (this.state.envBaseHi << 8) | this.state.envBaseLo;
    envPeriod += this.state.curEnvSlide + addToEnv;
    envPeriod = Math.max(0, Math.min(0xffff, envPeriod));
    regs.envelopePeriod = envPeriod;

    // Output envelope shape if a new envelope was triggered this frame
    if (this.state.newEnvelopeShape !== 0xff) {
      regs.envelopeShape = this.state.newEnvelopeShape & 0x0f;
      this.state.newEnvelopeShape = 0xff; // Reset after outputting
    }

    // Handle envelope sliding
    if (this.state.curEnvDelay > 0) {
      this.state.curEnvDelay--;
      if (this.state.curEnvDelay === 0) {
        this.state.curEnvSlide += this.state.envSlideAdd;
        this.state.curEnvDelay = this.state.envDelay;
      }
    }

    regs.mixer = mixer;
  }
}

/**
 * Extended channel state with pattern data reference
 */
interface ChannelStateExt extends Pt3ChannelState {
  patternData?: Uint8Array;
}
