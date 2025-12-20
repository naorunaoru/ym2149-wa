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
 * YM2149 register values for one frame
 * The YM2149 is the Yamaha variant of the AY-3-8910 sound chip
 */
export interface Ym2149Registers {
  /** Channel A tone period (12-bit, R0-R1) */
  toneA: number;
  /** Channel B tone period (12-bit, R2-R3) */
  toneB: number;
  /** Channel C tone period (12-bit, R4-R5) */
  toneC: number;
  /** Noise period (5-bit, R6) */
  noise: number;
  /** Mixer control (R7) */
  mixer: number;
  /** Channel A amplitude (5-bit with envelope flag, R8) */
  volumeA: number;
  /** Channel B amplitude (5-bit with envelope flag, R9) */
  volumeB: number;
  /** Channel C amplitude (5-bit with envelope flag, R10) */
  volumeC: number;
  /** Envelope period (16-bit, R11-R12) */
  envelopePeriod: number;
  /** Envelope shape (4-bit, R13). 0xFF means don't write */
  envelopeShape: number;
  /** I/O Port A (R14) */
  portA: number;
  /** I/O Port B (R15) */
  portB: number;
}

/**
 * AY-3-8912 register values for one frame
 * Subset of YM2149 registers excluding I/O ports
 */
export type AyRegisters = Omit<Ym2149Registers, 'portA' | 'portB'>;

/**
 * Configuration options for YM2149 constructor
 */
export interface YM2149Options {
  /** AudioContext to use for the worklet (required) */
  audioContext: AudioContext;

  /** Destination node to connect worklet output to (required) */
  destination: AudioNode;
}

/**
 * Main YM2149 emulator class using AudioWorklet
 *
 * Now accepts external AudioContext and destination for pluggable audio routing.
 * Outputs stereo audio with per-channel panning support.
 */
export class YM2149 {
  /** The AudioContext this chip uses */
  readonly audioContext: AudioContext;

  /** The destination node this chip connects to */
  private readonly destination: AudioNode;

  private workletNode: AudioWorkletNode | null = null;
  private workletReady = false;
  private pendingMessages: Array<Record<string, unknown>> = [];

  // SharedArrayBuffer for real-time channel levels (visualization)
  private levelsBuffer: SharedArrayBuffer | null = null;
  private levelsView: Float32Array | null = null;

  // Track which AudioContexts have loaded the worklet module
  private static loadedContexts = new WeakSet<AudioContext>();

  constructor(options: YM2149Options) {
    if (!options.audioContext) {
      throw new Error('YM2149 requires an AudioContext');
    }
    if (!options.destination) {
      throw new Error('YM2149 requires a destination AudioNode');
    }

    this.audioContext = options.audioContext;
    this.destination = options.destination;
  }

  /**
   * Initialize the AudioWorklet processor
   */
  private async initWorklet(): Promise<void> {
    if (this.workletReady) {
      return;
    }

    // Only load worklet module once per AudioContext
    if (!YM2149.loadedContexts.has(this.audioContext)) {
      const workletUrl = new URL('./processor.js', import.meta.url);
      await this.audioContext.audioWorklet.addModule(workletUrl);
      YM2149.loadedContexts.add(this.audioContext);
    }

    this.workletNode = new AudioWorkletNode(this.audioContext, 'ym2149-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2], // Stereo output
    });

    this.workletNode.connect(this.destination);
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
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    await this.initWorklet();
  }

  async stop(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.workletReady = false;
    this.levelsBuffer = null;
    this.levelsView = null;
    // Note: We do NOT close the AudioContext - we don't own it
  }

  /**
   * Set stereo pan position for a channel
   * @param channel - Channel index (0=A, 1=B, 2=C)
   * @param pan - Pan position from -1 (left) to +1 (right), 0 = center
   */
  setChannelPan(channel: number, pan: number): void {
    if (channel >= 0 && channel < 3) {
      this.postMessage({ type: 'setChannelPan', channel, pan });
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

  setNoisePeriod(period: number): void {
    this.postMessage({ type: 'setNoisePeriod', value: period });
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
    this.workletReady = false;
    this.levelsBuffer = null;
    this.levelsView = null;
    // Note: We do NOT close the AudioContext - we don't own it
  }
}
