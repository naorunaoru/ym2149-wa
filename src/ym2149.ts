/**
 * YM2149 PSG emulation using AudioWorklet
 *
 * This implementation uses an AudioWorklet processor for cycle-accurate
 * sample-level mixing with proper AND gate logic like real hardware.
 */

export interface ChannelState {
  toneEnabled: boolean;
  noiseEnabled: boolean;
  period: number;
  volume: number;
  useEnvelope: boolean;
}

export interface YM2149State {
  channels: [ChannelState, ChannelState, ChannelState];
  noisePeriod: number;
  envelopePeriod: number;
  envelopeShape: number;
}

/**
 * Main YM2149 emulator class using AudioWorklet
 */
export class YM2149 {
  private ctx: AudioContext;
  private workletNode: AudioWorkletNode | null = null;
  private masterGain: GainNode;
  private workletReady = false;
  private pendingMessages: Array<Record<string, unknown>> = [];

  // SharedArrayBuffer for real-time channel levels (visualization)
  private levelsBuffer: SharedArrayBuffer | null = null;
  private levelsView: Float32Array | null = null;

  constructor() {
    this.ctx = new AudioContext();

    // Master volume
    this.masterGain = new GainNode(this.ctx, { gain: 0.5 });
    this.masterGain.connect(this.ctx.destination);
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  /**
   * Set master volume (0.0 to 1.0)
   */
  setMasterVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  /**
   * Initialize the AudioWorklet processor
   */
  private async initWorklet(): Promise<void> {
    if (this.workletReady) return;

    // Load worklet from separate file (Vite handles the URL correctly)
    const workletUrl = new URL('./ym2149-processor.js', import.meta.url);
    await this.ctx.audioWorklet.addModule(workletUrl);

    this.workletNode = new AudioWorkletNode(this.ctx, 'ym2149-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    this.workletNode.connect(this.masterGain);
    this.workletReady = true;

    // Initialize SharedArrayBuffer for real-time channel levels
    // 3 floats (12 bytes) for channels A, B, C
    if (typeof SharedArrayBuffer !== 'undefined') {
      this.levelsBuffer = new SharedArrayBuffer(3 * Float32Array.BYTES_PER_ELEMENT);
      this.levelsView = new Float32Array(this.levelsBuffer);
      this.workletNode.port.postMessage({ type: 'setLevelsBuffer', buffer: this.levelsBuffer });
    }

    // Send any pending messages
    for (const msg of this.pendingMessages) {
      this.workletNode.port.postMessage(msg);
    }
    this.pendingMessages = [];
  }

  /**
   * Send a message to the worklet processor
   */
  private postMessage(msg: Record<string, unknown>): void {
    if (this.workletNode && this.workletReady) {
      this.workletNode.port.postMessage(msg);
    } else {
      this.pendingMessages.push(msg);
    }
  }

  async start(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    await this.initWorklet();
  }

  async stop(): Promise<void> {
    if (this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  /**
   * Set the internal clock rate (master clock / 8)
   * Typically 250kHz for a 2MHz master clock
   */
  setInternalClock(clock: number): void {
    this.postMessage({ type: 'setInternalClock', value: clock });
  }

  /**
   * Reset all generators to initial state
   * Call this when loading a new song to prevent audio artifacts
   */
  reset(): void {
    this.postMessage({ type: 'reset' });
  }

  // Channel A (index 0)
  setChannelATone(enabled: boolean): void {
    this.setChannelTone(0, enabled);
  }

  setChannelAPeriod(period: number): void {
    this.setChannelPeriod(0, period);
  }

  setChannelAVolume(volume: number): void {
    this.setChannelVolume(0, volume);
  }

  // Channel B (index 1)
  setChannelBTone(enabled: boolean): void {
    this.setChannelTone(1, enabled);
  }

  setChannelBPeriod(period: number): void {
    this.setChannelPeriod(1, period);
  }

  setChannelBVolume(volume: number): void {
    this.setChannelVolume(1, volume);
  }

  // Channel C (index 2)
  setChannelCTone(enabled: boolean): void {
    this.setChannelTone(2, enabled);
  }

  setChannelCPeriod(period: number): void {
    this.setChannelPeriod(2, period);
  }

  setChannelCVolume(volume: number): void {
    this.setChannelVolume(2, volume);
  }

  // Noise
  setNoiseEnabled(_enabled: boolean): void {
    // Noise enable is now controlled per-channel via mixer register
    // This method is kept for API compatibility but does nothing
  }

  setNoisePeriod(period: number): void {
    this.postMessage({ type: 'setNoisePeriod', value: period });
  }

  // Generic channel access
  setChannelTone(_channel: number, _enabled: boolean): void {
    // Tone enable is controlled via mixer register
    // This method is kept for API compatibility but does nothing directly
    // The replayer should call setMixer instead
  }

  setChannelPeriod(channel: number, period: number): void {
    if (channel >= 0 && channel < 3) {
      this.postMessage({ type: 'setTonePeriod', channel, value: period });
    }
  }

  setChannelVolume(channel: number, volume: number): void {
    if (channel >= 0 && channel < 3) {
      // Volume 0-15, bit 4 = 0 means fixed volume
      this.postMessage({ type: 'setVolume', channel, value: volume & 0x0f });
    }
  }

  /**
   * Set channel volume with envelope enable flag
   * @param channel - channel index (0-2)
   * @param volume - volume register value (bits 0-3 = volume, bit 4 = envelope enable)
   */
  setChannelVolumeReg(channel: number, volume: number): void {
    if (channel >= 0 && channel < 3) {
      this.postMessage({ type: 'setVolume', channel, value: volume });
    }
  }

  /**
   * Set volume directly as a 0-1 value (for legacy envelope output)
   * Note: With AudioWorklet, envelope is handled internally, so this maps to fixed volume
   */
  setChannelVolumeRaw(channel: number, volume: number): void {
    if (channel >= 0 && channel < 3) {
      // Convert 0-1 to 0-15 and set as fixed volume
      const level = Math.round(volume * 15);
      this.postMessage({ type: 'setVolume', channel, value: level & 0x0f });
    }
  }

  /**
   * Set mixer register (R7)
   * Bits 0-2: Tone disable for channels A, B, C (0 = enabled)
   * Bits 3-5: Noise disable for channels A, B, C (0 = enabled)
   */
  setMixer(value: number): void {
    this.postMessage({ type: 'setMixer', value });
  }

  /**
   * Set envelope period (R11-R12)
   */
  setEnvelopePeriod(period: number): void {
    this.postMessage({ type: 'setEnvelopePeriod', value: period });
  }

  /**
   * Set envelope shape (R13)
   * Writing to this register also triggers envelope restart
   */
  setEnvelopeShape(shape: number): void {
    this.postMessage({ type: 'setEnvelopeShape', value: shape });
  }

  /**
   * Legacy: Enable/disable envelope LFO for a channel
   * With AudioWorklet, envelope is handled internally
   */
  setChannelEnvelopeEnabled(_channel: number, _enabled: boolean): void {
    // No-op - envelope is handled by the worklet
  }

  /**
   * Legacy: Configure envelope LFO for a channel
   * With AudioWorklet, envelope is handled internally
   */
  setChannelEnvelopeLfo(_channel: number, _frequency: number, _waveform: OscillatorType): void {
    // No-op - envelope is handled by the worklet
  }

  // ========================================
  // DigiDrum Support
  // ========================================

  /**
   * Load DigiDrum samples into the worklet
   * @param samples - Array of Uint8Array sample data (8-bit unsigned)
   */
  loadDrumSamples(samples: Uint8Array[]): void {
    // Convert Uint8Array to regular arrays for postMessage
    const samplesData = samples.map((s) => Array.from(s));
    this.postMessage({ type: 'loadDrumSamples', samples: samplesData });
  }

  /**
   * Start playing a DigiDrum sample on a channel
   * @param channel - Channel index (0-2)
   * @param drumNum - Sample index
   * @param freq - Playback frequency in Hz
   */
  startDrum(channel: number, drumNum: number, freq: number): void {
    if (channel >= 0 && channel < 3) {
      this.postMessage({ type: 'startDrum', channel, drumNum, freq });
    }
  }

  /**
   * Stop DigiDrum playback on a channel
   */
  stopDrum(channel: number): void {
    if (channel >= 0 && channel < 3) {
      this.postMessage({ type: 'stopDrum', channel });
    }
  }

  // ========================================
  // SID Voice Effect Support
  // ========================================

  /**
   * Start SID voice effect (amplitude gating) on a channel
   * @param channel - Channel index (0-2)
   * @param freq - Gating frequency in Hz
   * @param volume - Maximum volume (0-15)
   * @param isSinus - Use sinusoidal modulation instead of square wave
   */
  startSid(channel: number, freq: number, volume: number, isSinus = false): void {
    if (channel >= 0 && channel < 3) {
      this.postMessage({ type: 'startSid', channel, freq, volume, isSinus });
    }
  }

  /**
   * Stop SID voice effect on a channel
   */
  stopSid(channel: number): void {
    if (channel >= 0 && channel < 3) {
      this.postMessage({ type: 'stopSid', channel });
    }
  }

  // ========================================
  // Sync Buzzer Effect Support
  // ========================================

  /**
   * Start Sync Buzzer effect (timer-controlled envelope retriggering)
   * @param freq - Retriggering frequency in Hz
   */
  startSyncBuzzer(freq: number): void {
    this.postMessage({ type: 'startSyncBuzzer', freq });
  }

  /**
   * Stop Sync Buzzer effect
   */
  stopSyncBuzzer(): void {
    this.postMessage({ type: 'stopSyncBuzzer' });
  }

  // ========================================
  // Real-time Visualization Support
  // ========================================

  /**
   * Get current channel output levels for visualization.
   * Returns [channelA, channelB, channelC] with values 0-1.
   * Updates in real-time via SharedArrayBuffer.
   * Returns [0, 0, 0] if SharedArrayBuffer is not available.
   */
  getChannelLevels(): [number, number, number] {
    if (this.levelsView) {
      return [this.levelsView[0], this.levelsView[1], this.levelsView[2]];
    }
    return [0, 0, 0];
  }

  dispose(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.masterGain.disconnect();
    this.ctx.close();
  }
}
