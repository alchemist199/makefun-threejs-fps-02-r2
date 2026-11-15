// Procedural sound, no audio files: every effect is synthesised with WebAudio nodes
// built once and reused, so the game ships no samples and makes no network request.
// The context is created lazily on the first user gesture; before that every call is a
// no-op, which keeps headless captures silent instead of throwing.
// v2: the scoped rifle gets a deeper crack, the smoke grenade a soft hiss, and the
// scope a small click when it seats.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') void context.resume();
      return true;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
      const length = Math.floor(context.sampleRate * 0.5);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function burst(duration, filterType, frequency, gainValue, when = 0) {
    if (!ensure()) return;
    const start = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function tone(frequency, duration, type, gainValue, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const start = context.currentTime + when;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo > 0) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    // kind selects the weapon's voice; distance (metres) thins far shots into a crack.
    shot(kind, distance = 0) {
      const near = Math.max(0, 1 - distance / 55);
      if (kind === 'pistol') {
        burst(0.09, 'lowpass', 2600, 0.5 * near + 0.08);
        tone(190, 0.07, 'square', 0.16 * near + 0.03, 70);
      } else if (kind === 'smg') {
        burst(0.07, 'bandpass', 1800, 0.42 * near + 0.07);
        tone(240, 0.05, 'square', 0.12 * near + 0.02, 90);
      } else if (kind === 'scoped') {
        burst(0.22, 'lowpass', 1100, 0.85 * near + 0.12);
        tone(95, 0.2, 'sawtooth', 0.28 * near + 0.05, 38);
      } else if (kind === 'dmr') {
        burst(0.16, 'lowpass', 1500, 0.7 * near + 0.1);
        tone(120, 0.14, 'sawtooth', 0.22 * near + 0.04, 45);
      } else {
        burst(0.11, 'lowpass', 2100, 0.6 * near + 0.09);
        tone(160, 0.09, 'square', 0.18 * near + 0.03, 60);
      }
    },
    dryFire() {
      tone(1400, 0.03, 'square', 0.08);
    },
    reload() {
      tone(900, 0.04, 'square', 0.1);
      tone(620, 0.05, 'square', 0.1, 0, 0.16);
    },
    hit() {
      tone(1250, 0.05, 'sine', 0.16);
    },
    kill() {
      tone(1250, 0.05, 'sine', 0.16);
      tone(1660, 0.08, 'sine', 0.16, 0, 0.06);
    },
    hurt() {
      burst(0.12, 'lowpass', 500, 0.25);
      tone(110, 0.12, 'sawtooth', 0.14, 55);
    },
    plantTick() {
      tone(1750, 0.05, 'sine', 0.14);
    },
    defuseTick() {
      tone(980, 0.05, 'sine', 0.14);
    },
    explode() {
      burst(0.9, 'lowpass', 420, 0.9);
      tone(70, 0.7, 'sine', 0.5, 28);
      burst(0.25, 'highpass', 900, 0.2, 0.02);
    },
    grenadePin() {
      tone(2100, 0.03, 'square', 0.07);
    },
    smokeHiss() {
      burst(0.9, 'bandpass', 3200, 0.22);
    },
    scopeClick() {
      tone(1900, 0.02, 'square', 0.09);
    },
    radioBlip() {
      tone(1560, 0.04, 'sine', 0.07);
    },
    buy() {
      tone(880, 0.07, 'sine', 0.14);
      tone(1318, 0.09, 'sine', 0.14, 0, 0.07);
    },
    roundStart() {
      tone(523, 0.1, 'triangle', 0.16);
      tone(784, 0.14, 'triangle', 0.16, 0, 0.1);
    },
    roundWin() {
      tone(523, 0.12, 'triangle', 0.16);
      tone(659, 0.12, 'triangle', 0.16, 0, 0.1);
      tone(784, 0.2, 'triangle', 0.18, 0, 0.2);
    },
    roundLose() {
      tone(392, 0.14, 'triangle', 0.16);
      tone(311, 0.2, 'triangle', 0.16, 0, 0.12);
    },
  };
}
