import type { Blast } from "./blast.js";

/** A bomb as the planner and the validator see it. Times are integer ticks. */
export interface Bomb {
  id: number;
  cell: number;
  placeTick: number;
  explodeTick: number;
  blast: Blast;
}

export interface Timing {
  /** Ticks from placement to explosion. */
  fuseTicks: number;
  /** Ticks the flame stays on screen after the explosion. */
  flameTicks: number;
  /** Extra ticks before the explosion during which the blast area already counts as deadly. */
  dangerMarginTicks: number;
}

/**
 * Time-dependent hazards: which cells are deadly / blocked at a given tick.
 * Built from the current list of bombs; cheap to query.
 */
export class Hazards {
  /** cell -> list of [from, to] tick intervals (inclusive) during which it is deadly */
  private danger = new Map<number, [number, number][]>();
  /** cell -> [from, to) tick interval during which a bomb blocks walking into it */
  private blocked = new Map<number, [number, number][]>();
  /** Last tick at which anything is dangerous (−Infinity when there is nothing). */
  readonly calmFrom: number;

  constructor(bombs: readonly Bomb[], timing: Timing) {
    let calm = -Infinity;
    for (const b of bombs) {
      const from = b.explodeTick - timing.dangerMarginTicks;
      const to = b.explodeTick + timing.flameTicks;
      for (const c of b.blast.cells) push(this.danger, c, [from, to]);
      push(this.blocked, b.cell, [b.placeTick, b.explodeTick]);
      calm = Math.max(calm, to + 1);
    }
    this.calmFrom = calm;
  }

  isDeadly(cell: number, tick: number): boolean {
    const list = this.danger.get(cell);
    if (!list) return false;
    for (const [a, b] of list) if (tick >= a && tick <= b) return true;
    return false;
  }

  /** A bomb sits on the cell at this tick (you may stay on it, but not walk onto it). */
  hasBomb(cell: number, tick: number): boolean {
    const list = this.blocked.get(cell);
    if (!list) return false;
    for (const [a, b] of list) if (tick >= a && tick < b) return true;
    return false;
  }

  /** The cell is outside every pending blast, so standing there is safe forever. */
  isForeverSafe(cell: number, fromTick: number): boolean {
    const list = this.danger.get(cell);
    if (list) for (const [, b] of list) if (b >= fromTick) return false;
    const bl = this.blocked.get(cell);
    if (bl) for (const [, b] of bl) if (b > fromTick) return false;
    return true;
  }
}

function push<T>(m: Map<number, T[]>, k: number, v: T) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
