import { type Grid, cx, cy, grassCells, isFloor } from "./grid.js";
import type { Plan } from "./planner.js";

/**
 * Independently replay a plan and list every rule it breaks. An empty array
 * means the play-through is legal: the hero stays on the map, moves one cell per
 * tick, never stands in a flame, never walks onto a bomb, bombs never chain,
 * and every grass cell is destroyed.
 */
export function validatePlan(plan: Plan): string[] {
  const { grid, positions, bombs, options: o } = plan;
  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 50) errors.push(m);
  };
  const pos = (c: number) => `(${cx(grid, c)},${cy(grid, c)})`;

  // 1. movement
  positions.forEach((c, t) => {
    if (!isFloor(grid, cx(grid, c), cy(grid, c))) err(`tick ${t}: hero off the map at ${pos(c)}`);
    if (t > 0) {
      const p = positions[t - 1];
      const d = Math.abs(cx(grid, c) - cx(grid, p)) + Math.abs(cy(grid, c) - cy(grid, p));
      if (d > 1) err(`tick ${t}: hero teleported ${pos(p)} -> ${pos(c)}`);
    }
  });

  // 2. bombs
  for (const b of bombs) {
    if (positions[b.placeTick] !== b.cell || positions[b.placeTick + 1] !== b.cell) {
      err(`bomb ${b.id}: hero not on ${pos(b.cell)} while placing at tick ${b.placeTick}`);
    }
    if (b.explodeTick - b.placeTick !== o.fuseTicks) err(`bomb ${b.id}: wrong fuse`);
    const live = bombs.filter((x) => x.placeTick <= b.placeTick && x.explodeTick > b.placeTick).length;
    if (live > o.maxBombs) err(`bomb ${b.id}: ${live} bombs on the field (max ${o.maxBombs})`);
    for (const other of bombs) {
      if (other === b) continue;
      // `other` explodes while `b` is still waiting and its flame reaches b -> chain reaction
      const onField = other.explodeTick >= b.placeTick && other.explodeTick <= b.explodeTick;
      if (onField && other.blast.cells.includes(b.cell)) err(`bomb ${other.id} would chain into bomb ${b.id}`);
    }
    for (let t = b.placeTick + 1; t < b.explodeTick && t < positions.length; t++) {
      if (positions[t] === b.cell && positions[t - 1] !== b.cell) err(`tick ${t}: hero walked onto bomb ${b.id}`);
    }
  }

  // 3. safety
  if (plan.warnings.length === 0) {
    for (const b of bombs) {
      for (let t = b.explodeTick - o.dangerMarginTicks; t <= b.explodeTick + o.flameTicks; t++) {
        const c = positions[Math.min(t, positions.length - 1)];
        if (b.blast.cells.includes(c)) err(`tick ${t}: hero inside the blast of bomb ${b.id} at ${pos(c)}`);
      }
    }
  }

  // 4. every grass cell destroyed, by the earliest explosion that reaches it
  for (const g of grassCells(grid)) {
    const hits = bombs.filter((b) => b.blast.cells.includes(g));
    if (hits.length === 0) {
      err(`grass ${pos(g)} is never destroyed`);
      continue;
    }
    const first = hits.reduce((a, b) => (b.explodeTick < a.explodeTick ? b : a));
    const by = plan.destroyedBy.get(g);
    if (by === undefined || bombs[by].explodeTick !== first.explodeTick) {
      err(`grass ${pos(g)} destroyed by bomb ${by}, expected the earlier bomb ${first.id}`);
    }
  }

  // 5. the game only ends after the last flame
  const lastFlame = Math.max(-1, ...bombs.map((b) => b.explodeTick + o.flameTicks));
  if (plan.endTick < lastFlame) err(`game ends at ${plan.endTick} before the last flame (${lastFlame})`);
  if (plan.endTick !== positions.length - 1) err("endTick does not match the hero timeline");
  return errors;
}

/** Level of each grass cell at a given tick (0 once destroyed). Handy for snapshot tests. */
export function boardAt(plan: Plan, tick: number): Grid {
  const cells = plan.grid.cells.slice();
  for (const [g, id] of plan.destroyedBy) if (plan.bombs[id].explodeTick <= tick) cells[g] = 0;
  return { ...plan.grid, cells };
}
