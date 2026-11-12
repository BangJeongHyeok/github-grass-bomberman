import type { Hazards } from "./world.js";

export interface Reach {
  startTick: number;
  /** Earliest tick each cell can be occupied, or -1 if unreachable within the search. */
  arrival: Int32Array;
  /** Cells visited at ticks startTick..arrival[cell] (one entry per tick, waits repeat a cell). */
  path(cell: number): number[];
}

/**
 * Space-time breadth-first search.
 *
 * The hero moves one cell per tick or waits. A cell may be occupied at tick t
 * only if no flame (incl. the pre-explosion danger margin) covers it at t, and
 * the hero may not walk onto a cell holding a bomb (staying on one is fine).
 * Once every hazard is over the search degenerates into a plain BFS and stops
 * when nothing new is reached.
 *
 * Among equally fast routes it prefers continuing straight, which keeps the
 * walking lines natural instead of zig-zagging.
 */
export function reachInTime(
  neighbours: readonly number[][],
  start: number,
  startTick: number,
  hazards: Hazards,
  maxTicks = 4000,
): Reach {
  const n = neighbours.length;
  const arrival = new Int32Array(n).fill(-1);
  const layers: Int16Array[] = [];

  let layer = new Int16Array(n).fill(-1);
  layer[start] = start;
  arrival[start] = startTick;
  layers.push(layer);

  const quality = new Int8Array(n);
  for (let step = 0; step < maxTicks; step++) {
    const t = startTick + step; // tick of `layer`
    const next = new Int16Array(n).fill(-1);
    quality.fill(127);
    let occupied = 0;
    let fresh = 0;
    for (let c = 0; c < n; c++) {
      const prev = layer[c];
      if (prev < 0) continue;
      const inDir = c - prev; // 0 = waited
      // wait in place
      if (!hazards.isDeadly(c, t + 1)) {
        const q = inDir === 0 ? 0 : 2;
        if (q < quality[c]) {
          quality[c] = q;
          next[c] = c;
        }
      }
      for (const nb of neighbours[c]) {
        if (hazards.isDeadly(nb, t + 1) || hazards.hasBomb(nb, t + 1)) continue;
        const q = nb - c === inDir ? 0 : 1;
        if (q < quality[nb]) {
          quality[nb] = q;
          next[nb] = c;
        }
      }
    }
    for (let c = 0; c < n; c++) {
      if (next[c] < 0) continue;
      occupied++;
      if (arrival[c] < 0) {
        arrival[c] = t + 1;
        fresh++;
      }
    }
    if (occupied === 0) break;
    layers.push(next);
    layer = next;
    if (fresh === 0 && t + 1 >= hazards.calmFrom) break;
  }

  return {
    startTick,
    arrival,
    path(cell: number): number[] {
      const end = arrival[cell];
      if (end < 0) throw new Error(`cell ${cell} is unreachable`);
      const out: number[] = [];
      let cur = cell;
      for (let l = end - startTick; l > 0; l--) {
        out.push(cur);
        cur = layers[l][cur];
      }
      out.push(cur);
      return out.reverse();
    },
  };
}
