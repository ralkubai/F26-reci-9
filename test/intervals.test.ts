import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeIntervals, type Interval } from '../src/intervals';

// A valid interval: pick a start and a LENGTH, never two independent endpoints.
// (The starter generator produced [5, 2], which violates start <= end.)
const interval: fc.Arbitrary<Interval> = fc
  .tuple(fc.integer({ min: -20, max: 20 }), fc.nat(5))
  .map(([start, len]) => [start, start + len] as Interval);

// Intervals that touch exactly at an endpoint ([1,3] and [3,5]).
// Random generation almost never produces these, so build them on purpose.
const touchingChain: fc.Arbitrary<Interval[]> = fc
  .tuple(
    fc.integer({ min: -20, max: 20 }),
    fc.array(fc.nat(4), { minLength: 2, maxLength: 5 }),
  )
  .map(([start, lens]) => {
    let cursor = start;
    return lens.map((len) => {
      const iv: Interval = [cursor, cursor + len];
      cursor += len;
      return iv;
    });
  });

const intervalList: fc.Arbitrary<Interval[]> = fc.oneof(
  fc.array(interval, { maxLength: 6 }),
  touchingChain,
);

// Already sorted, disjoint and non-touching: each starts at least one past the
// previous end, so nothing in the list may legally be merged.
const disjointList: fc.Arbitrary<Interval[]> = fc
  .tuple(
    fc.integer({ min: -20, max: 20 }),
    fc.array(fc.tuple(fc.nat(3), fc.nat(4)), { minLength: 1, maxLength: 5 }),
  )
  .map(([start, pairs]) => {
    let cursor = start;
    return pairs.map(([gap, len]) => {
      const s = cursor + gap + 1;
      const e = s + len;
      cursor = e;
      return [s, e] as Interval;
    });
  });

// Tiny, obviously correct oracle: is point p covered by any of these intervals?
const covers = (xs: readonly Interval[], p: number) =>
  xs.some(([s, e]) => s <= p && p <= e);

describe('mergeIntervals', () => {
  // Pattern: invariant. Every input interval lies inside some output interval.
  it('every input interval lies inside some output interval', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        const uncovered = xs.filter(([s, e]) => !out.some(([a, b]) => a <= s && e <= b));
        expect(uncovered).toEqual([]);
      }),
    );
  });

  // Pattern: invariant. The output is sorted, and consecutive intervals neither overlap nor touch.
  it('output is sorted, disjoint and non-touching', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const [s, e] of out) expect(s).toBeLessThanOrEqual(e);
        for (let i = 1; i < out.length; i++) {
          expect(out[i - 1][1]).toBeLessThan(out[i][0]);
        }
      }),
    );
  });

  // Pattern: invariant. The input array and the intervals in it are not modified.
  it('does not modify its input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const before = xs.map(([s, e]) => [s, e]);
        mergeIntervals(xs);
        expect(xs.map(([s, e]) => [s, e])).toEqual(before);
      }),
    );
  });

  // Pattern: differential. The output covers exactly the same points as the input.
  // Points are all reals, so half-integers matter: [1,2] and [3,4] must stay apart.
  it('covers exactly the same points as the input', () => {
    fc.assert(
      fc.property(intervalList, fc.integer({ min: -60, max: 60 }), (xs, half) => {
        const p = half / 2;
        expect(covers(mergeIntervals(xs), p)).toBe(covers(xs, p));
      }),
    );
  });

  // Pattern: metamorphic. Reordering the input does not change the output.
  it('is independent of input order', () => {
    fc.assert(
      fc.property(
        intervalList.chain(xs =>
          fc.tuple(
            fc.constant(xs),
            fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length }),
          ),
        ),
        ([xs, shuffled]) => {
          expect(mergeIntervals(shuffled)).toEqual(mergeIntervals(xs));
        },
      ),
    );
  });

  // Pattern: algebraic. Merging is idempotent.
  it('merging an already-merged list changes nothing', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const once = mergeIntervals(xs);
        expect(mergeIntervals(once)).toEqual(once);
      }),
    );
  });

  // Pattern: conditional. If the input is already disjoint and non-touching,
  // the output is exactly the input.
  it('leaves an already-disjoint list alone', () => {
    fc.assert(
      fc.property(disjointList, xs => {
        expect(mergeIntervals(xs)).toEqual(xs);
      }),
    );
  });
});