/**
 * The engine's only source of randomness. `Math.random()` must never appear
 * anywhere in this package — every match is reproducible from its seed.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** How many values have been drawn — lets a match resume mid-stream. */
  calls: number;
}

function hashSeed(seed: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for shuffling, fully deterministic. */
export function createRng(seed: string, skip = 0): Rng {
  let a = hashSeed(seed);
  const rng: Rng = {
    calls: 0,
    next() {
      rng.calls++;
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(maxExclusive: number) {
      return Math.floor(rng.next() * maxExclusive);
    },
  };
  for (let i = 0; i < skip; i++) rng.next();
  return rng;
}

/** Fisher-Yates, in place. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const a = items[i]!;
    const b = items[j]!;
    items[i] = b;
    items[j] = a;
  }
  return items;
}
