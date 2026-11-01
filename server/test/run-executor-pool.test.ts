/** runPool: bounded concurrency for the review executor (hermetic). */
import { describe, expect, it } from 'vitest';
import { runPool } from '../src/modules/reviews/run-executor.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe('runPool', () => {
  it('never has more than `limit` items in flight and runs them all', async () => {
    let inFlight = 0;
    let max = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await tick();
      inFlight--;
      done.push(n);
    });
    expect(max).toBe(3);
    expect(done).toHaveLength(7);
  });

  it('limit 1 (and anything below) keeps target order', async () => {
    for (const limit of [1, 0, -2]) {
      const order: number[] = [];
      await runPool([1, 2, 3, 4], limit, async (n) => {
        await tick();
        order.push(n);
      });
      expect(order).toEqual([1, 2, 3, 4]);
    }
  });

  it('one rejection does not stop the others', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 3]);
  });
});
