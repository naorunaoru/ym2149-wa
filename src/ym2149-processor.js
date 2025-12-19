/**
 * YM2149 AudioWorklet Processor
 *
 * Implements cycle-accurate mixing at audio sample rate.
 * The real YM2149 uses AND gates to combine tone and noise:
 *   gate = (tone | tone_disable) & (noise | noise_disable)
 *   output = gate ? volume : 0
 *
 * Also supports YM-file special effects:
 * - DigiDrum: Sample playback with timer-controlled pitch
 * - SID Voice: Square/sine wave amplitude gating
 * - Sync Buzzer: Timer-controlled envelope retriggering
 */

// Fixed-point precision for drum playback
const DRUM_PREC = 15;

// 17-bit LFSR noise generator (same as real YM2149)
class NoiseGenerator {
  constructor() {
    this.lfsr = 1; // Must be non-zero
    this.counter = 0;
    this.period = 16;
    this.output = 0;
    this.halfTick = false;
  }

  setPeriod(period) {
    this.period = Math.max(1, period);
  }

  tick() {
    this.halfTick = !this.halfTick;
    if (this.halfTick) {
      this.counter++;
      if (this.counter >= this.period) {
        // XOR bits 0 and 2 for feedback (same as real hardware)
        const feedback = (this.lfsr ^ (this.lfsr >> 2)) & 1;
        this.output = feedback;
        // Shift and insert feedback at bit 16
        this.lfsr = (this.lfsr >> 1) | (feedback << 16);
        this.counter = 0;
      }
    }
    return this.output;
  }
}

// Tone generator with period counter
class ToneGenerator {
  constructor() {
    this.counter = 0;
    this.period = 1;
    this.output = 0; // 0 or 1
  }

  setPeriod(period) {
    this.period = Math.max(1, period);
  }

  tick() {
    this.counter++;
    if (this.counter >= this.period) {
      this.output ^= 1; // Toggle
      this.counter = 0;
    }
    return this.output;
  }
}

// Envelope generator
class EnvelopeGenerator {
  constructor() {
    this.counter = 0;
    this.period = 1;
    this.position = -64;
    this.shape = 0;
    this.dataOffset = 0;
  }

  // Shape to envelope table mapping (same as hardware)
  static SHAPE_TO_ENV = [0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // Envelope data: 10 shapes × 128 steps
  static ENV_DATA = [
    // Shape 0: decay then hold at 0
    31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7,
    6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0,
    // Shape 1: attack then hold at 0
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    // Shape 2: continuous decay (sawtooth down)
    31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7,
    6, 5, 4, 3, 2, 1, 0, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13,
    12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19,
    18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 31, 30, 29, 28, 27, 26, 25,
    24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    // Shape 3: decay then hold at 0 (same as 0)
    31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7,
    6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0,
    // Shape 4: triangle (decay-attack loop)
    31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7,
    6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19,
    18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    // Shape 5: decay then hold at max
    31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7,
    6, 5, 4, 3, 2, 1, 0, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31,
    // Shape 6: continuous attack (sawtooth up)
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    // Shape 7: attack then hold at max
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
    31, 31, 31, 31, 31, 31,
    // Shape 8: triangle (attack-decay loop)
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14,
    13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 31, 30, 29, 28, 27, 26, 25,
    24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    // Shape 9: attack then hold at 0
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];

  setPeriod(period) {
    this.period = Math.max(1, period);
  }

  setShape(shape) {
    this.shape = shape & 0x0f;
    this.dataOffset = EnvelopeGenerator.SHAPE_TO_ENV[this.shape] * 128;
    this.position = -64;
    this.counter = 0;
  }

  // Retrigger envelope (for Sync Buzzer effect)
  trigger() {
    this.position = -64;
    this.counter = 0;
  }

  tick() {
    this.counter++;
    if (this.counter >= this.period) {
      this.position++;
      if (this.position > 63) {
        this.position = this.position & 63;
      }
      this.counter = 0;
    }
  }

  getLevel() {
    const index = this.dataOffset + this.position + 64;
    return EnvelopeGenerator.ENV_DATA[index] || 0;
  }
}

// DigiDrum sample player
class DigiDrumPlayer {
  constructor() {
    this.active = false;
    this.data = null;
    this.pos = 0; // Fixed-point position
    this.step = 0; // Position increment per sample
  }

  start(sampleData, freq, sampleRate) {
    this.active = true;
    this.data = sampleData;
    this.pos = 0;
    // Calculate step: samples to advance per output sample
    this.step = Math.floor((freq << DRUM_PREC) / sampleRate);
  }

  stop() {
    this.active = false;
    this.data = null;
    this.pos = 0;
    this.step = 0;
  }

  // Get current sample value (0-1 range) or null if not playing
  getSample() {
    if (!this.active || !this.data) return null;

    const idx = this.pos >> DRUM_PREC;
    if (idx >= this.data.length) {
      this.active = false;
      return null;
    }

    // DigiDrum samples are volume levels (0-255), not signed PCM waveforms
    // Scale to 0-1 range matching YM volume output levels
    return (this.data[idx] / 255) * 0.85;
  }

  advance() {
    if (this.active) {
      this.pos += this.step;
      if ((this.pos >> DRUM_PREC) >= this.data.length) {
        this.active = false;
      }
    }
  }
}

// SID voice effect (amplitude gating)
class SidVoice {
  constructor() {
    this.active = false;
    this.pos = 0; // Phase accumulator (32-bit)
    this.step = 0; // Phase increment per sample
    this.volume = 0; // 0-15
    this.isSinus = false;
  }

  start(freq, volume, sampleRate, isSinus = false) {
    // Cap frequency to Nyquist/2 to prevent aliasing artifacts
    // Very high timer frequencies (>10kHz) are typically encoding errors
    const cappedFreq = Math.min(freq, sampleRate / 4);
    this.step = Math.floor((cappedFreq * 0x80000000) / sampleRate);
    this.volume = volume & 0x0f;
    this.isSinus = isSinus;
    if (!this.active) {
      this.pos = 0;
    }
    this.active = true;
  }

  stop() {
    this.active = false;
    this.pos = 0;
    this.step = 0;
  }

  // Get volume level (0-15) based on gating
  getVolumeLevel() {
    if (!this.active) return null;

    if (this.isSinus) {
      // Sinusoidal amplitude modulation
      const phase = (this.pos / 0xffffffff) * Math.PI * 2;
      const s = 0.5 * (1 + Math.sin(phase));
      return Math.round(s * this.volume);
    } else {
      // Square wave gating
      return this.pos & 0x80000000 ? this.volume : 0;
    }
  }

  advance() {
    if (this.active) {
      this.pos = (this.pos + this.step) >>> 0; // Keep as 32-bit unsigned
    }
  }
}

// 32-level logarithmic volume table (same as YM2149 DAC)
const VOLUME_TABLE = [
  0.0, 0.0046, 0.0055, 0.0066, 0.0078, 0.0093, 0.0111, 0.0132, 0.0156, 0.0186, 0.0221, 0.0263,
  0.0313, 0.0372, 0.0443, 0.0527, 0.0626, 0.0745, 0.0886, 0.1054, 0.1253, 0.149, 0.1772, 0.2107,
  0.2506, 0.298, 0.3544, 0.4215, 0.5013, 0.5962, 0.709, 1.0,
];

class YM2149Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Internal clock rate (will be set from main thread)
    this.internalClock = 250000; // 2MHz / 8
    this.ticksPerSample = this.internalClock / sampleRate;
    this.tickAccumulator = 0;

    // Generators
    this.tones = [new ToneGenerator(), new ToneGenerator(), new ToneGenerator()];
    this.noise = new NoiseGenerator();
    this.envelope = new EnvelopeGenerator();

    // Mixer state (from R7)
    this.toneEnabled = [true, true, true];
    this.noiseEnabled = [false, false, false];

    // Volume registers (R8-R10)
    this.volumes = [15, 15, 15];
    this.useEnvelope = [false, false, false];

    // DigiDrum players (one per channel)
    this.drums = [new DigiDrumPlayer(), new DigiDrumPlayer(), new DigiDrumPlayer()];
    this.drumSamples = []; // Stored sample data

    // SID voice effects (one per channel)
    this.sidVoices = [new SidVoice(), new SidVoice(), new SidVoice()];

    // Sync Buzzer effect
    this.syncBuzzerEnabled = false;
    this.syncBuzzerPhase = 0;
    this.syncBuzzerStep = 0;

    // SharedArrayBuffer for real-time channel levels (visualization)
    this.channelLevels = null; // Float32Array view into SharedArrayBuffer

    // Message handling
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'reset':
        // Reset all generators to initial state
        for (let i = 0; i < 3; i++) {
          this.tones[i].counter = 0;
          this.tones[i].period = 1;
          this.tones[i].output = 0;
          this.volumes[i] = 0;
          this.useEnvelope[i] = false;
          this.toneEnabled[i] = true;
          this.noiseEnabled[i] = false;
          this.drums[i].stop();
          this.sidVoices[i].stop();
        }
        this.noise.lfsr = 1;
        this.noise.counter = 0;
        this.noise.period = 16;
        this.noise.output = 0;
        this.noise.halfTick = false;
        this.envelope.counter = 0;
        this.envelope.period = 1;
        this.envelope.position = -64;
        this.envelope.shape = 0;
        this.envelope.dataOffset = 0;
        this.syncBuzzerEnabled = false;
        this.syncBuzzerPhase = 0;
        this.syncBuzzerStep = 0;
        this.tickAccumulator = 0;
        break;

      case 'setInternalClock':
        this.internalClock = msg.value;
        this.ticksPerSample = this.internalClock / sampleRate;
        break;
      case 'setTonePeriod':
        this.tones[msg.channel].setPeriod(msg.value);
        break;
      case 'setNoisePeriod':
        this.noise.setPeriod(msg.value);
        break;
      case 'setEnvelopePeriod':
        this.envelope.setPeriod(msg.value);
        break;
      case 'setEnvelopeShape':
        this.envelope.setShape(msg.value);
        break;
      case 'setMixer':
        // R7: bits 0-2 = tone disable, bits 3-5 = noise disable
        this.toneEnabled[0] = (msg.value & 0x01) === 0;
        this.toneEnabled[1] = (msg.value & 0x02) === 0;
        this.toneEnabled[2] = (msg.value & 0x04) === 0;
        this.noiseEnabled[0] = (msg.value & 0x08) === 0;
        this.noiseEnabled[1] = (msg.value & 0x10) === 0;
        this.noiseEnabled[2] = (msg.value & 0x20) === 0;
        break;
      case 'setVolume':
        this.volumes[msg.channel] = msg.value & 0x0f;
        this.useEnvelope[msg.channel] = (msg.value & 0x10) !== 0;
        break;

      // DigiDrum support
      case 'loadDrumSamples':
        // msg.samples is an array of arrays
        this.drumSamples = msg.samples;
        break;
      case 'startDrum':
        // msg: { channel, drumNum, freq }
        if (msg.drumNum < this.drumSamples.length) {
          this.drums[msg.channel].start(this.drumSamples[msg.drumNum], msg.freq, sampleRate);
        }
        break;
      case 'stopDrum':
        this.drums[msg.channel].stop();
        break;

      // SID voice support
      case 'startSid':
        // msg: { channel, freq, volume, isSinus }
        this.sidVoices[msg.channel].start(msg.freq, msg.volume, sampleRate, msg.isSinus || false);
        break;
      case 'stopSid':
        this.sidVoices[msg.channel].stop();
        break;

      // Sync Buzzer support
      case 'startSyncBuzzer':
        // Cap frequency to prevent aliasing (same as SID)
        const cappedBuzzerFreq = Math.min(msg.freq, sampleRate / 4);
        this.syncBuzzerStep = Math.floor((cappedBuzzerFreq * 0x80000000) / sampleRate);
        this.syncBuzzerPhase = 0;
        this.syncBuzzerEnabled = true;
        break;
      case 'stopSyncBuzzer':
        this.syncBuzzerEnabled = false;
        this.syncBuzzerPhase = 0;
        this.syncBuzzerStep = 0;
        break;

      // SharedArrayBuffer for real-time visualization
      case 'setLevelsBuffer':
        // msg.buffer is a SharedArrayBuffer (3 floats = 12 bytes)
        this.channelLevels = new Float32Array(msg.buffer);
        break;
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channel = output[0];

    if (!channel) return true;

    // Track peak levels per channel for visualization
    let peakLevels = [0, 0, 0];

    for (let i = 0; i < channel.length; i++) {
      // === Handle Sync Buzzer (envelope retriggering) ===
      if (this.syncBuzzerEnabled) {
        const oldPhase = this.syncBuzzerPhase;
        this.syncBuzzerPhase = (this.syncBuzzerPhase + this.syncBuzzerStep) >>> 0;
        // Detect overflow (bit 31 transition)
        if ((oldPhase & 0x80000000) === 0 && (this.syncBuzzerPhase & 0x80000000) !== 0) {
          this.envelope.trigger();
        }
      }

      // === Handle SID voice effects (amplitude gating) ===
      for (let ch = 0; ch < 3; ch++) {
        const sidLevel = this.sidVoices[ch].getVolumeLevel();
        if (sidLevel !== null) {
          // SID overrides the normal volume
          this.volumes[ch] = sidLevel;
        }
        this.sidVoices[ch].advance();
      }

      // === Accumulate ticks for this sample ===
      this.tickAccumulator += this.ticksPerSample;
      const ticksThisSample = Math.floor(this.tickAccumulator);
      this.tickAccumulator -= ticksThisSample;

      // Run generators for each tick with OR-accumulation (like real hardware)
      // This naturally handles very high frequencies by integrating over the sample period
      let toneAccum = [0, 0, 0];
      let noiseAccum = 0;

      for (let t = 0; t < ticksThisSample; t++) {
        toneAccum[0] |= this.tones[0].tick();
        toneAccum[1] |= this.tones[1].tick();
        toneAccum[2] |= this.tones[2].tick();
        noiseAccum |= this.noise.tick();
        this.envelope.tick();
      }

      // Get envelope level
      const envLevel = this.envelope.getLevel();

      // Mix channels using AND gate logic (like real hardware)
      let mixedOutput = 0;

      for (let ch = 0; ch < 3; ch++) {
        let channelOutput = 0;

        // Check for DigiDrum override
        const drumSample = this.drums[ch].getSample();
        if (drumSample !== null) {
          // DigiDrum bypasses normal mixing
          channelOutput = drumSample;
          this.drums[ch].advance();
        } else {
          // Gate = (tone | !toneEnabled) & (noise | !noiseEnabled)
          // Uses OR-accumulated values over all ticks in this sample period
          const toneGate = toneAccum[ch] || !this.toneEnabled[ch];
          const noiseGate = noiseAccum || !this.noiseEnabled[ch];
          const gate = toneGate && noiseGate;

          if (gate) {
            // Get volume level (either fixed or from envelope)
            const level = this.useEnvelope[ch] ? envLevel : this.volumes[ch] << 1;
            channelOutput = VOLUME_TABLE[level];
          }
        }

        mixedOutput += channelOutput;

        // Track peak level for this channel
        if (channelOutput > peakLevels[ch]) {
          peakLevels[ch] = channelOutput;
        }
      }

      // Normalize (3 channels max)
      channel[i] = mixedOutput / 3;
    }

    // Write peak levels to SharedArrayBuffer for visualization
    if (this.channelLevels) {
      this.channelLevels[0] = peakLevels[0];
      this.channelLevels[1] = peakLevels[1];
      this.channelLevels[2] = peakLevels[2];
    }

    return true;
  }
}

registerProcessor('ym2149-processor', YM2149Processor);
