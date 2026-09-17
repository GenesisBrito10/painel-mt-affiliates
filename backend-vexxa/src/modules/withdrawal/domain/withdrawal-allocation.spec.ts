import { describe, it, expect } from 'vitest';
import { distributeProportional } from './withdrawal-allocation.js';

const sum = (m: Map<string, number>) =>
  [...m.values()].reduce((a, b) => a + b, 0);

describe('distributeProportional', () => {
  it('splits the total proportionally to gross earnings; sums to total', () => {
    const gross = new Map([
      ['superbet', 600],
      ['betnacional', 400],
    ]);
    const out = distributeProportional(gross, 500);
    expect(out.get('superbet')).toBeCloseTo(300, 6); // 500 * 0.6
    expect(out.get('betnacional')).toBeCloseTo(200, 6); // 500 * 0.4
    expect(sum(out)).toBeCloseTo(500, 6);
  });

  it('kamila case: 810 split across 5285/665/145 sums to 810', () => {
    const gross = new Map([
      ['superbet', 5285],
      ['betnacional', 665],
      ['hiperbet', 145],
    ]);
    const out = distributeProportional(gross, 810);
    expect(sum(out)).toBeCloseTo(810, 6);
    // superbet keeps the lion's share since it earned the most
    expect(out.get('superbet')!).toBeGreaterThan(out.get('betnacional')!);
  });

  it('treats negative gross as 0 weight', () => {
    const gross = new Map([
      ['a', 500],
      ['b', -100],
    ]);
    const out = distributeProportional(gross, 250);
    expect(out.get('a')).toBeCloseTo(250, 6);
    expect(out.get('b')).toBe(0);
  });

  it('returns 0 for every house when total is 0', () => {
    const out = distributeProportional(
      new Map([
        ['a', 100],
        ['b', 50],
      ]),
      0,
    );
    expect(sum(out)).toBe(0);
  });

  it('returns 0 for every house when no positive gross', () => {
    const out = distributeProportional(
      new Map([
        ['a', 0],
        ['b', 0],
      ]),
      500,
    );
    expect(sum(out)).toBe(0);
  });

  it("never exposes the 'all' sentinel", () => {
    const out = distributeProportional(
      new Map([
        ['all', 999],
        ['superbet', 100],
      ]),
      100,
    );
    expect(out.has('all')).toBe(false);
    expect(out.get('superbet')).toBeCloseTo(100, 6);
  });

  it('handles empty map', () => {
    expect(sum(distributeProportional(new Map(), 500))).toBe(0);
  });
});
