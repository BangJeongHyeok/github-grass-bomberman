import { DIRS, type Grid, cx, cy, idx, isFloor } from "./grid.js";

export interface BlastArms {
  up: number;
  down: number;
  left: number;
  right: number;
}

export interface Blast {
  center: number;
  /** Every cell covered by the flame, centre included. */
  cells: number[];
  /** How many cells each arm actually reaches (clipped by the map edge and missing days). */
  arms: BlastArms;
}

/**
 * Classic cross-shaped explosion. Flames travel `radius` cells in each direction,
 * pass through grass (destroying it) and stop at the map edge or at a missing day.
 */
export function computeBlast(g: Grid, center: number, radius: number): Blast {
  const x0 = cx(g, center);
  const y0 = cy(g, center);
  const cells = [center];
  const arms: BlastArms = { up: 0, down: 0, left: 0, right: 0 };
  for (const d of DIRS) {
    for (let r = 1; r <= radius; r++) {
      const x = x0 + d.dx * r;
      const y = y0 + d.dy * r;
      if (!isFloor(g, x, y)) break;
      cells.push(idx(g, x, y));
      arms[d.name] = r;
    }
  }
  return { center, cells, arms };
}

/** Precompute blasts for every cell (the grid never changes shape during a game). */
export function blastTable(g: Grid, radius: number): Blast[] {
  const out: Blast[] = [];
  for (let i = 0; i < g.cells.length; i++) out.push(computeBlast(g, i, radius));
  return out;
}
