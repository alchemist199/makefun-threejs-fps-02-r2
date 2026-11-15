// Deterministic randomness: one small seeded generator, so a screenshot seed replays
// the same bot jitter and spread. The live game seeds it from the clock; ?shot= seeds it
// from the URL, so a capture is reproducible frame for frame. Every simulation decision
// — bot skill, strafe timing, burst sizes, radio timing — draws from this one stream,
// never from Math.random, so the fixed-step simulation is a pure function of its seed.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

export function range(random, min, max) {
  return min + random() * (max - min);
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
