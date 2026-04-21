import { describe, test, expect } from 'bun:test';

import { BRAILLE_LEVELS, RingBuffer, sparkOf, sparkline } from './sparkline';

describe('sparkline', () => {
  test('empty input returns empty string', () => {
    expect(sparkline([])).toBe('');
  });

  test('output length always matches sample count', () => {
    expect(sparkline([1, 2, 3, 4, 5]).length).toBe(5);
    expect(sparkline([0]).length).toBe(1);
  });

  test('flat-zero samples render as empty braille', () => {
    const out = sparkline([0, 0, 0, 0]);
    expect(out).toBe(BRAILLE_LEVELS[0]!.repeat(4));
  });

  test('flat non-zero samples render as middle braille', () => {
    const out = sparkline([7, 7, 7]);
    expect(out).toBe(BRAILLE_LEVELS[4]!.repeat(3));
  });

  test('monotonically rising samples produce rising bars', () => {
    const out = sparkline([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out[0]).toBe(BRAILLE_LEVELS[0]!);
    expect(out[out.length - 1]).toBe(BRAILLE_LEVELS[BRAILLE_LEVELS.length - 1]!);
  });

  test('NaN / negative / non-finite inputs are clamped to zero', () => {
    const out = sparkline([1, Number.NaN, -5, Infinity, 4]);
    expect(out.length).toBe(5);
    // position 1 (NaN) and 2 (negative) should render as the lowest level
    expect(out[1]).toBe(BRAILLE_LEVELS[0]!);
    expect(out[2]).toBe(BRAILLE_LEVELS[0]!);
  });
});

describe('RingBuffer', () => {
  test('rejects non-positive capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
  });

  test('toArray is empty until something is pushed', () => {
    const b = new RingBuffer<number>(5);
    expect(b.toArray()).toEqual([]);
    expect(b.size).toBe(0);
  });

  test('push appends in insertion order while below capacity', () => {
    const b = new RingBuffer<number>(4);
    b.push(1);
    b.push(2);
    b.push(3);
    expect(b.toArray()).toEqual([1, 2, 3]);
    expect(b.size).toBe(3);
  });

  test('oldest items drop once capacity is exceeded', () => {
    const b = new RingBuffer<number>(3);
    b.push(1);
    b.push(2);
    b.push(3);
    b.push(4);
    b.push(5);
    expect(b.toArray()).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
  });

  test('clear resets size to zero', () => {
    const b = new RingBuffer<number>(3);
    b.push(1);
    b.push(2);
    b.clear();
    expect(b.size).toBe(0);
    expect(b.toArray()).toEqual([]);
  });
});

describe('sparkOf', () => {
  test('renders live from a ring buffer', () => {
    const b = new RingBuffer<number>(4);
    b.push(1);
    b.push(2);
    b.push(3);
    b.push(4);
    const out = sparkOf(b);
    expect(out.length).toBe(4);
    expect(out[0]).toBe(BRAILLE_LEVELS[0]!);
    expect(out[3]).toBe(BRAILLE_LEVELS[BRAILLE_LEVELS.length - 1]!);
  });
});
