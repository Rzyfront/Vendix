/**
 * Deterministic RNG and helper functions for reproducible fake data.
 *
 * Uses mulberry32 — a tiny seedable PRNG. Same seed → same data.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number; // [0, 1)
  int(min: number, max: number): number; // inclusive
  intExclusive(min: number, max: number): number; // exclusive
  pick<T>(arr: readonly T[] | T[] | null | undefined): T;
  pickMany<T>(arr: readonly T[] | T[] | null | undefined, n: number): T[];
  weighted<T>(items: ReadonlyArray<readonly [T, number]> | null | undefined): T;
  bool(probabilityTrue?: number): boolean;
  gaussian(mean: number, stdev: number): number;
  shuffle<T>(arr: T[] | null | undefined): T[];
  chance(p: number): boolean;
  uuid(): string; // v4-shaped but deterministic
  decimal(min: number, max: number, places?: number): number;
  pesos(min: number, max: number): number;
}

export function makeRng(seed: number): Rng {
  const r = mulberry32(seed);
  const next = r;

  const int = (min: number, max: number): number => {
    return Math.floor(r() * (max - min + 1)) + min;
  };
  const intExclusive = (min: number, max: number): number => {
    return Math.floor(r() * (max - min)) + min;
  };
  const pick = <T,>(arr: readonly T[] | T[] | null | undefined): T => {
    const a = (arr ?? []) as readonly T[];
    return a[intExclusive(0, a.length)] as T;
  };
  const pickMany = <T,>(arr: readonly T[] | T[] | null | undefined, n: number): T[] => {
    const a = (arr ?? []) as readonly T[];
    const copy = a.slice();
    shuffle(copy);
    return copy.slice(0, Math.min(n, copy.length));
  };
  const weighted = <T,>(
    items: ReadonlyArray<readonly [T, number]> | null | undefined,
  ): T => {
    const it = (items ?? []) as ReadonlyArray<readonly [T, number]>;
    if (it.length === 0) return null as any;
    const total = it.reduce((a, [, w]) => a + w, 0);
    let p = r() * total;
    for (const [v, w] of it) {
      p -= w;
      if (p <= 0) return v;
    }
    return it[it.length - 1]![0];
  };
  const bool = (p: number = 0.5): boolean => r() < p;
  const gaussian = (mean: number, stdev: number): number => {
    // Box-Muller
    const u1 = Math.max(1e-9, r());
    const u2 = r();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdev;
  };
  const shuffle = <T,>(arr: T[] | null | undefined): T[] => {
    const a = arr ?? [];
    for (let i = a.length - 1; i > 0; i--) {
      const j = intExclusive(0, i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const chance = (p: number): boolean => r() < p;
  const uuid = (): string => {
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    const bytes: string[] = [];
    for (let i = 0; i < 16; i++) {
      bytes.push(hex(int(0, 255)));
    }
    bytes[6] = hex((int(0, 15) & 0x0f) | 0x40);
    bytes[8] = hex((int(0, 15) & 0x0f) | 0x80);
    return [
      bytes.slice(0, 4).join(''),
      bytes.slice(4, 6).join(''),
      bytes.slice(6, 8).join(''),
      bytes.slice(8, 10).join(''),
      bytes.slice(10, 16).join(''),
    ].join('-');
  };
  const decimal = (min: number, max: number, places: number): number => {
    const v = min + r() * (max - min);
    const m = 10 ** places;
    return Math.round(v * m) / m;
  };
  const pesos = (min: number, max: number): number => {
    // Round to nearest 100 COP
    return Math.round((min + r() * (max - min)) / 100) * 100;
  };

  return { next, int, intExclusive, pick, pickMany, weighted, bool, gaussian, shuffle, chance, uuid, decimal, pesos };
}
