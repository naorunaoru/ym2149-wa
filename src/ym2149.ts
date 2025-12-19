/**
 * YM2149 PSG emulation using Web Audio API
 * 
 * This implementation prioritizes using native Web Audio nodes where possible,
 * trading some accuracy for simplicity and performance.
 */

import { VOLUME_TABLE, periodToFrequency } from './tables';

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
 * A single tone channel using OscillatorNode
 *
 * Supports hardware envelope modulation via a separate LFO oscillator
 * that modulates the gain at audio rate.
 */
class ToneChannel {
  private oscillator: OscillatorNode;
  private gainNode: GainNode;
  private envelopeGain: GainNode;  // Separate gain for envelope modulation
  private envelopeLfo: OscillatorNode | null = null;
  private envelopeLfoGain: GainNode;  // Controls LFO depth
  private _enabled = true;
  private _period = 284; // ~440Hz
  private _volume = 15;
  private _useEnvelope = false;

  constructor(private ctx: AudioContext, destination: AudioNode) {
    this.oscillator = new OscillatorNode(ctx, {
      type: 'square',
      frequency: periodToFrequency(this._period),
    });

    // Main volume gain (for non-envelope mode)
    this.gainNode = new GainNode(ctx, {
      gain: VOLUME_TABLE[this._volume],
    });

    // Envelope modulation gain (multiplied with main gain)
    this.envelopeGain = new GainNode(ctx, { gain: 1 });

    // LFO gain node (controls envelope depth, connected to envelopeGain.gain)
    this.envelopeLfoGain = new GainNode(ctx, { gain: 0 });

    // Signal chain: oscillator -> gainNode -> envelopeGain -> destination
    this.oscillator.connect(this.gainNode);
    this.gainNode.connect(this.envelopeGain);
    this.envelopeGain.connect(destination);

    // LFO modulates the envelope gain
    this.envelopeLfoGain.connect(this.envelopeGain.gain);

    this.oscillator.start();
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.updateGain();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set period(value: number) {
    this._period = Math.max(1, Math.min(4095, value));
    const freq = periodToFrequency(this._period);
    this.oscillator.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.001);
  }

  get period(): number {
    return this._period;
  }

  set volume(value: number) {
    this._volume = Math.max(0, Math.min(15, value));
    this.updateGain();
  }

  get volume(): number {
    return this._volume;
  }

  private updateGain(): void {
    const targetGain = this._enabled ? VOLUME_TABLE[this._volume] : 0;
    this.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.005);
  }

  /**
   * Set volume directly as a 0-1 value (for envelope output)
   * Used when envelope is updated at frame rate (fallback mode)
   */
  setVolumeRaw(value: number): void {
    const targetGain = this._enabled ? Math.max(0, Math.min(1, value)) : 0;
    this.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.005);
  }

  /**
   * Enable/disable envelope LFO modulation for this channel
   * When enabled, the envelope oscillator modulates the gain at audio rate
   */
  setEnvelopeEnabled(enabled: boolean): void {
    this._useEnvelope = enabled;
    if (enabled) {
      // Set base gain to max, let envelope modulate
      this.gainNode.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.005);
      // Envelope gain will be controlled by LFO
      this.envelopeGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.001);
      this.envelopeLfoGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.001);
    } else {
      // Disable LFO modulation
      this.envelopeLfoGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.001);
      this.envelopeGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.001);
      this.updateGain();
    }
  }

  /**
   * Configure the envelope LFO oscillator
   * @param frequency - envelope cycle frequency in Hz
   * @param waveform - 'sawtooth' for shapes 2,6 (ramp), 'triangle' for shapes 4,8,10,14
   */
  setEnvelopeLfo(frequency: number, waveform: OscillatorType): void {
    // Stop existing LFO if any
    if (this.envelopeLfo) {
      this.envelopeLfo.stop();
      this.envelopeLfo.disconnect();
    }

    // Create new LFO at the envelope frequency
    this.envelopeLfo = new OscillatorNode(this.ctx, {
      type: waveform,
      frequency: frequency,
    });

    this.envelopeLfo.connect(this.envelopeLfoGain);
    this.envelopeLfo.start();
  }

  disconnect(): void {
    this.oscillator.stop();
    this.oscillator.disconnect();
    this.gainNode.disconnect();
    this.envelopeGain.disconnect();
    this.envelopeLfoGain.disconnect();
    if (this.envelopeLfo) {
      this.envelopeLfo.stop();
      this.envelopeLfo.disconnect();
    }
  }
}

/**
 * Noise generator using a looped buffer of white noise
 * 
 * Note: This doesn't replicate the exact 17-bit LFSR behavior,
 * but provides a similar sonic character.
 */
class NoiseGenerator {
  private bufferSource: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer;
  private gainNode: GainNode;
  private filterNode: BiquadFilterNode;
  private _enabled = false;
  private _period = 16;
  private _volume = 15;

  constructor(private ctx: AudioContext, destination: AudioNode) {
    // Create noise buffer (1 second of white noise)
    const bufferSize = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Low-pass filter to simulate noise period (higher period = lower cutoff)
    this.filterNode = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: this.periodToFilterFreq(this._period),
      Q: 1,
    });

    this.gainNode = new GainNode(ctx, { gain: 0 });
    
    this.filterNode.connect(this.gainNode);
    this.gainNode.connect(destination);
    
    this.startNoiseSource();
  }

  private startNoiseSource(): void {
    if (this.bufferSource) {
      this.bufferSource.stop();
      this.bufferSource.disconnect();
    }
    
    this.bufferSource = new AudioBufferSourceNode(this.ctx, {
      buffer: this.noiseBuffer,
      loop: true,
    });
    this.bufferSource.connect(this.filterNode);
    this.bufferSource.start();
  }

  private periodToFilterFreq(period: number): number {
    // Map period 1-31 to filter frequency
    // Lower period = higher frequency noise
    // This is an approximation of how the LFSR clock affects noise timbre
    const maxFreq = 20000;
    const minFreq = 200;
    const normalized = (31 - period) / 30;
    return minFreq + normalized * (maxFreq - minFreq);
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.updateGain();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set period(value: number) {
    this._period = Math.max(1, Math.min(31, value));
    this.filterNode.frequency.setTargetAtTime(
      this.periodToFilterFreq(this._period),
      this.ctx.currentTime,
      0.01
    );
  }

  get period(): number {
    return this._period;
  }

  set volume(value: number) {
    this._volume = Math.max(0, Math.min(15, value));
    this.updateGain();
  }

  get volume(): number {
    return this._volume;
  }

  private updateGain(): void {
    const targetGain = this._enabled ? VOLUME_TABLE[this._volume] * 0.5 : 0;
    this.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.005);
  }

  disconnect(): void {
    if (this.bufferSource) {
      this.bufferSource.stop();
      this.bufferSource.disconnect();
    }
    this.filterNode.disconnect();
    this.gainNode.disconnect();
  }
}

/**
 * Main YM2149 emulator class
 */
export class YM2149 {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private dcFilter: BiquadFilterNode;
  private channels: [ToneChannel, ToneChannel, ToneChannel];
  private noise: NoiseGenerator;

  constructor() {
    this.ctx = new AudioContext();
    
    // DC offset removal filter
    this.dcFilter = new BiquadFilterNode(this.ctx, {
      type: 'highpass',
      frequency: 20,
      Q: 0.7,
    });
    
    // Master volume (divide by 3 for 3 channels + noise headroom)
    this.masterGain = new GainNode(this.ctx, { gain: 0.25 });
    
    this.dcFilter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    
    // Create 3 tone channels
    this.channels = [
      new ToneChannel(this.ctx, this.dcFilter),
      new ToneChannel(this.ctx, this.dcFilter),
      new ToneChannel(this.ctx, this.dcFilter),
    ];
    
    // Create noise generator
    this.noise = new NoiseGenerator(this.ctx, this.dcFilter);
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  async start(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  async stop(): Promise<void> {
    if (this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  // Channel A (index 0)
  setChannelATone(enabled: boolean): void {
    this.channels[0].enabled = enabled;
  }

  setChannelAPeriod(period: number): void {
    this.channels[0].period = period;
  }

  setChannelAVolume(volume: number): void {
    this.channels[0].volume = volume;
    // Also update noise volume if noise is routed through channel A
    this.noise.volume = volume;
  }

  // Channel B (index 1)
  setChannelBTone(enabled: boolean): void {
    this.channels[1].enabled = enabled;
  }

  setChannelBPeriod(period: number): void {
    this.channels[1].period = period;
  }

  setChannelBVolume(volume: number): void {
    this.channels[1].volume = volume;
  }

  // Channel C (index 2)
  setChannelCTone(enabled: boolean): void {
    this.channels[2].enabled = enabled;
  }

  setChannelCPeriod(period: number): void {
    this.channels[2].period = period;
  }

  setChannelCVolume(volume: number): void {
    this.channels[2].volume = volume;
  }

  // Noise
  setNoiseEnabled(enabled: boolean): void {
    this.noise.enabled = enabled;
  }

  setNoisePeriod(period: number): void {
    this.noise.period = period;
  }

  // Generic channel access
  setChannelTone(channel: number, enabled: boolean): void {
    if (channel >= 0 && channel < 3) {
      this.channels[channel].enabled = enabled;
    }
  }

  setChannelPeriod(channel: number, period: number): void {
    if (channel >= 0 && channel < 3) {
      this.channels[channel].period = period;
    }
  }

  setChannelVolume(channel: number, volume: number): void {
    if (channel >= 0 && channel < 3) {
      this.channels[channel].volume = volume;
    }
  }

  /**
   * Set channel volume as raw 0-1 value (for envelope output)
   */
  setChannelVolumeRaw(channel: number, volume: number): void {
    if (channel >= 0 && channel < 3) {
      this.channels[channel].setVolumeRaw(volume);
    }
  }

  /**
   * Enable/disable envelope LFO for a channel
   */
  setChannelEnvelopeEnabled(channel: number, enabled: boolean): void {
    if (channel >= 0 && channel < 3) {
      this.channels[channel].setEnvelopeEnabled(enabled);
    }
  }

  /**
   * Configure envelope LFO for a channel
   * @param channel - channel index (0-2)
   * @param frequency - envelope frequency in Hz
   * @param waveform - oscillator waveform type
   */
  setChannelEnvelopeLfo(channel: number, frequency: number, waveform: OscillatorType): void {
    if (channel >= 0 && channel < 3) {
      this.channels[channel].setEnvelopeLfo(frequency, waveform);
    }
  }

  dispose(): void {
    this.channels.forEach(ch => ch.disconnect());
    this.noise.disconnect();
    this.dcFilter.disconnect();
    this.masterGain.disconnect();
    this.ctx.close();
  }
}
