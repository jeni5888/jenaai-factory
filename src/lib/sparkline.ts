/**
 * Braille-based sparklines for the Expertenmodus header (v0.3).
 *
 * Uses the 8-level block approximation via a curated subset of Braille
 * patterns, so every character is the same width (narrow) and visually
 * tall enough to read at 200-column headers:
 *
 *   ⠀  ⡀  ⣀  ⣄  ⣤  ⣦  ⣶  ⣾  ⣿
 *   (empty → full)
 *
 * Pure stdlib, no runtime deps.
 */

export const BRAILLE_LEVELS = ['⠀', '⡀', '⣀', '⣄', '⣤', '⣦', '⣶', '⣾', '⣿'] as const;

/**
 * Map an array of numeric samples to a sparkline string of the same length.
 *
 * - Empty input → empty string.
 * - All equal values → middle level so the line still prints visible.
 * - NaN / negative / non-finite inputs are clamped to 0.
 */
export function sparkline(samples: readonly number[]): string {
  if (samples.length === 0) return '';
  const safe = samples.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const max = Math.max(...safe);
  const min = Math.min(...safe);
  const levels = BRAILLE_LEVELS.length - 1; // 8

  if (max === min) {
    const flat = max === 0 ? BRAILLE_LEVELS[0]! : BRAILLE_LEVELS[Math.floor(levels / 2)]!;
    return flat.repeat(samples.length);
  }

  const range = max - min;
  return safe
    .map((v) => {
      const normalized = (v - min) / range; // 0..1
      const idx = Math.min(levels, Math.max(0, Math.round(normalized * levels)));
      return BRAILLE_LEVELS[idx]!;
    })
    .join('');
}

/**
 * Fixed-capacity ring buffer for rolling sparkline windows (e.g. last N
 * iteration token counts). Cheap push, no allocations after construction.
 */
export class RingBuffer<T> {
  private readonly data: Array<T | undefined>;
  private head = 0;
  private count = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be > 0');
    this.data = new Array<T | undefined>(capacity);
  }

  /** Append one value; oldest gets dropped when full. */
  push(value: T): void {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  /** Oldest-first view of the current contents. */
  toArray(): T[] {
    if (this.count === 0) return [];
    const out: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const v = this.data[idx];
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  /** Current number of items (≤ capacity). */
  get size(): number {
    return this.count;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.data[i] = undefined;
    this.head = 0;
    this.count = 0;
  }
}

/** Convenience: sparkline directly off a RingBuffer<number>. */
export function sparkOf(buf: RingBuffer<number>): string {
  return sparkline(buf.toArray());
}
