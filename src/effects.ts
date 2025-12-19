/**
 * YM5/YM6 Special Effects Decoder
 *
 * Decodes MFP timer-based effects from YM register frames.
 * Based on the Rust implementation in ym2149-rs.
 *
 * Effects are encoded in the upper nibbles of specific registers:
 * - Effect Slot 1: code in r1[7-4], prescaler in r6[7-5], counter in r14[7-0]
 * - Effect Slot 2: code in r3[7-4], prescaler in r8[7-5], counter in r15[7-0]
 */

// MFP timer prescaler values
const MFP_PREDIV = [0, 4, 10, 16, 50, 64, 100, 200];

// Atari ST MFP clock frequency in Hz
const MFP_CLOCK = 2457600;

export type EffectType = 'none' | 'sid' | 'sinusSid' | 'digidrum' | 'syncBuzzer';

export interface Effect {
  type: EffectType;
  voice?: number; // 0=A, 1=B, 2=C
  freq?: number; // Timer frequency in Hz
  volume?: number; // 0-15 for SID effects
  drumNum?: number; // DigiDrum sample number
  envShape?: number; // Envelope shape for Sync Buzzer
}

/**
 * Decode YM6 effects from a frame's 16 registers
 *
 * YM6 format stores effects in two independent "slots":
 * - Slot 1: controlled by r1 (code), r6 (prescaler), r14 (counter)
 * - Slot 2: controlled by r3 (code), r8 (prescaler), r15 (counter)
 */
export function decodeEffectsYm6(registers: Uint8Array): [Effect, Effect] {
  const effect1 = decodeEffectSlot(registers[1], registers[6], registers[14], registers);
  const effect2 = decodeEffectSlot(registers[3], registers[8], registers[15], registers);
  return [effect1, effect2];
}

/**
 * Decode YM5 effects from a frame (SID and DigiDrum only)
 *
 * YM5 encodes two 2-bit codes for effects:
 * - R1[5:4]: SID voice selector (1=A, 2=B, 3=C)
 *   - Timer prediv from R6[7:5], counter from R14
 * - R3[5:4]: DigiDrum voice selector (1=A, 2=B, 3=C)
 *   - Drum index from R8+voice low 5 bits
 *   - Timer prediv from R8[7:5], counter from R15
 */
export function decodeEffectsYm5(registers: Uint8Array): Effect[] {
  const effects: Effect[] = [];

  // SID effect
  const sidCode = (registers[1] >> 4) & 0x03; // 1..3 => voices A..C
  if (sidCode !== 0) {
    const voice = sidCode - 1;
    const predivIdx = (registers[6] >> 5) & 0x07;
    const count = registers[14];
    const prediv = MFP_PREDIV[predivIdx];

    if (prediv !== 0 && count !== 0) {
      const freq = Math.floor(MFP_CLOCK / (prediv * count));
      const volume = registers[8 + voice] & 0x0f;
      effects.push({ type: 'sid', voice, freq, volume });
    }
  }

  // DigiDrum effect
  const drumCode = (registers[3] >> 4) & 0x03; // 1..3 => voices A..C
  if (drumCode !== 0) {
    const voice = drumCode - 1;
    const drumNum = registers[8 + voice] & 0x1f;
    const predivIdx = (registers[8] >> 5) & 0x07;
    const count = registers[15];
    const prediv = MFP_PREDIV[predivIdx];

    if (prediv !== 0 && count !== 0) {
      const freq = Math.floor(MFP_CLOCK / (prediv * count));
      effects.push({ type: 'digidrum', voice, drumNum, freq });
    }
  }

  return effects;
}

/**
 * Decode a single effect slot (YM6 format)
 *
 * Effect Code Encoding (bits 7-4 of code register):
 * 0000: No effect
 * 0001: SID Voice A
 * 0010: SID Voice B
 * 0011: SID Voice C
 * 0100: Extended FX Voice A (reserved)
 * 0101: DigiDrum Voice A
 * 0110: DigiDrum Voice B
 * 0111: DigiDrum Voice C
 * 1000: Extended FX Voice B (reserved)
 * 1001: Sinus SID Voice A
 * 1010: Sinus SID Voice B
 * 1011: Sinus SID Voice C
 * 1100: Extended FX Voice C (reserved)
 * 1101: Sync Buzzer Voice A
 * 1110: Sync Buzzer Voice B
 * 1111: Sync Buzzer Voice C
 */
function decodeEffectSlot(
  codeReg: number,
  predivReg: number,
  countReg: number,
  registers: Uint8Array,
): Effect {
  const effectCode = (codeReg >> 4) & 0x0f;

  // No effect
  if (effectCode === 0) {
    return { type: 'none' };
  }

  // Extract prescaler and counter
  const predivIdx = (predivReg >> 5) & 0x07;
  const prediv = MFP_PREDIV[predivIdx];
  const counter = countReg;

  // Timer not configured
  if (prediv === 0 || counter === 0) {
    return { type: 'none' };
  }

  // Calculate timer frequency
  const freq = Math.floor(MFP_CLOCK / (prediv * counter));

  // Decode effect type
  switch (effectCode) {
    case 0x1:
    case 0x2:
    case 0x3: {
      // SID Voice (codes 1-3 = voices A-C)
      const voice = effectCode - 1;
      const volume = registers[8 + voice] & 0x0f;
      return { type: 'sid', voice, freq, volume };
    }

    case 0x5:
    case 0x6:
    case 0x7: {
      // DigiDrum (codes 5-7 = voices A-C)
      const voice = effectCode - 5;
      const drumNum = registers[8 + voice] & 0x1f;
      return { type: 'digidrum', voice, drumNum, freq };
    }

    case 0x9:
    case 0xa:
    case 0xb: {
      // Sinus SID (codes 9-11 = voices A-C)
      const voice = effectCode - 9;
      const volume = registers[8 + voice] & 0x0f;
      return { type: 'sinusSid', voice, freq, volume };
    }

    case 0xd:
    case 0xe:
    case 0xf: {
      // Sync Buzzer (codes 13-15)
      const envShape = registers[13] & 0x0f;
      return { type: 'syncBuzzer', freq, envShape };
    }

    default:
      return { type: 'none' };
  }
}
