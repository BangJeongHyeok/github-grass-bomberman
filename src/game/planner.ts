import { blastTable } from "./blast.js";
import { type Grid, HEIGHT, cx, cy, floorCells, grassCells, neighbourTable } from "./grid.js";
import { reachInTime } from "./pathfinding.js";
import { createRng } from "./rng.js";
import { type Bomb, Hazards, type Timing } from "./world.js";

export interface PlannerOptions extends Timing {
  seed: string | number;
  blastRadius: number;
  /** Maximum number of bombs on the field at the same time. */
  maxBombs: number;
  /** How many top-scoring bomb spots get a full escape check per decision. */
  candidatesPerStep?: number;
}

/** Tuned on 24 sample calendars of different densities (shortest total play time). */
const TRAVEL_BIAS = 1;
/** Bombs must hit grass within this many columns of the leftmost remaining grass. */
const FRONT_BAND = 0;

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = {
  seed: "bomber",
  blastRadius: 2,
  fuseTicks: 12,
  flameTicks: 3,
  dangerMarginTicks: 1,
  maxBombs: 3,
  candidatesPerStep: 16,
};

/** The full result of one game, in integer ticks (one tick = time to walk one cell). */
export interface Plan {
  grid: Grid;
  options: PlannerOptions;
  start: number;
  /** Hero cell at every tick 0..positions.length-1. */
  positions: number[];
  bombs: Bomb[];
  /** grass cell -> id of the bomb whose explosion destroys it */
  destroyedBy: Map<number, number>;
  /** Tick at which the last flame has disappeared (== positions.length - 1). */
  endTick: number;
  /** Non-fatal issues (e.g. a bomb that had to be placed without a safe escape). */
  warnings: string[];
}

/**
 * Plan an automatic play-through that destroys every grass cell.
 *
 * Greedy, safety-first loop:
 *  1. Find every cell the hero can reach (space-time BFS around pending flames).
 *  2. Score bomb spots by "unclaimed grass destroyed / time to get there".
 *  3. Accept the best spot that still leaves an escape route to a cell outside
 *     every pending blast; walk there and drop the bomb.
 *  4. If nothing qualifies (bomb limit reached, or boxed in), retreat to safety
 *     and wait for the next explosion, then try again.
 * Every bomb claims at least one new grass cell, so the loop always terminates
 * with the board cleared.
 */
export function planGame(grid: Grid, partial: Partial<PlannerOptions> = {}): Plan {
  const opt: PlannerOptions = { ...DEFAULT_PLANNER_OPTIONS, ...partial };
  if (opt.fuseTicks < 3) throw new Error("fuseTicks must be at least 3");
  if (opt.blastRadius < 1) throw new Error("blastRadius must be at least 1");
  const rng = createRng(opt.seed);
  const neigh = neighbourTable(grid);
  const blasts = blastTable(grid, opt.blastRadius);
  const warnings: string[] = [];
  const floor = floorCells(grid);
  if (floor.length === 0) throw new Error("The contribution grid has no cells");

  const start = chooseStart(grid, floor);
  const positions = [start];
  const bombs: Bomb[] = [];
  const destroyedBy = new Map<number, number>();
  const unclaimed = new Set(grassCells(grid));
  // Small per-cell random jitter so different seeds give different (but valid) games.
  const jitter = floor.reduce((m, c) => m.set(c, rng.next()), new Map<number, number>());

  const now = () => positions.length - 1;
  const here = () => positions[positions.length - 1];
  const walk = (path: number[]) => {
    // path[0] is the current cell at the current tick
    for (let i = 1; i < path.length; i++) positions.push(path[i]);
  };
  const waitUntil = (tick: number) => {
    while (now() < tick) positions.push(here());
  };
  const pending = (t: number) => bombs.filter((b) => b.explodeTick + opt.flameTicks >= t);

  if (unclaimed.size === 0) {
    // Nothing to blow up: take a short stroll so the animation is not static.
    const reach = reachInTime(neigh, start, 0, new Hazards([], opt));
    const sx = cx(grid, start);
    const target = floor
      .filter((c) => cy(grid, c) === cy(grid, start) && cx(grid, c) > sx && cx(grid, c) <= sx + 6)
      .sort((a, b) => b - a)[0];
    if (target !== undefined) {
      const there = reach.path(target);
      walk(there);
      waitUntil(now() + 3);
      walk([...there].reverse());
    }
  }

  let guard = 0;
  while (unclaimed.size > 0) {
    if (++guard > 20000) throw new Error("planner did not converge");
    const t0 = now();
    const active = pending(t0);
    const hazards = new Hazards(active, opt);
    const reach = reachInTime(neigh, here(), t0, hazards);

    // --- score candidate bomb spots ------------------------------------
    // Sweep from left to right: every bomb must hit the leftmost columns that
    // still hold grass, so no stragglers are left behind for a long walk back.
    let frontier = Infinity;
    for (const g of unclaimed) frontier = Math.min(frontier, cx(grid, g));
    const scored: { cell: number; arrive: number; gain: number; score: number }[] = [];
    for (const c of floor) {
      const arrive = reach.arrival[c];
      if (arrive < 0) continue;
      const blast = blasts[c];
      let gain = 0;
      let front = false;
      for (const g of blast.cells) {
        if (!unclaimed.has(g)) continue;
        gain += 1;
        if (cx(grid, g) <= frontier + FRONT_BAND) front = true;
      }
      if (!front) continue;
      if (!canPlace(c, arrive, active, opt)) continue;
      const travel = arrive - t0;
      // Prefer big hits, then short walks.
      const score = (gain + 0.35 * jitter.get(c)!) / (travel + TRAVEL_BIAS);
      scored.push({ cell: c, arrive, gain, score });
    }
    scored.sort((a, b) => b.score - a.score);

    let placed = false;
    for (const cand of scored.slice(0, opt.candidatesPerStep ?? 16)) {
      const bomb: Bomb = {
        id: bombs.length,
        cell: cand.cell,
        placeTick: cand.arrive,
        explodeTick: cand.arrive + opt.fuseTicks,
        blast: blasts[cand.cell],
      };
      if (!hasEscape(cand.cell, cand.arrive, [...active, bomb])) continue;
      walk(reach.path(cand.cell));
      positions.push(cand.cell); // one tick to put the bomb down
      commitBomb(bomb);
      placed = true;
      break;
    }
    if (placed) continue;

    if (active.length === 0) {
      // No bombs anywhere and still no safe spot: only possible on degenerate
      // maps (e.g. a single column with a huge radius). Place the best bomb
      // anyway so the board still gets cleared, and report it.
      const cand = scored[0];
      if (!cand) throw new Error("no reachable grass left; the map is disconnected");
      warnings.push(`bomb at cell ${cand.cell} was placed without a safe escape route`);
      walk(reach.path(cand.cell));
      positions.push(cand.cell);
      const bomb: Bomb = {
        id: bombs.length,
        cell: cand.cell,
        placeTick: cand.arrive,
        explodeTick: cand.arrive + opt.fuseTicks,
        blast: blasts[cand.cell],
      };
      commitBomb(bomb);
      waitUntil(bomb.explodeTick + opt.flameTicks + 1);
      continue;
    }

    // --- nothing placeable: retreat and let the next bomb go off --------
    retreat(reach, hazards);
    const nextBlast = Math.min(...active.map((b) => b.explodeTick + opt.flameTicks + 1));
    // Only wait while standing somewhere safe; otherwise the loop re-plans.
    waitUntil(Math.max(nextBlast, now()));
  }

  // Board is claimed: get to safety and let everything burn out.
  const finalActive = pending(now());
  if (finalActive.length > 0) {
    const hazards = new Hazards(finalActive, opt);
    retreat(reachInTime(neigh, here(), now(), hazards), hazards);
    waitUntil(Math.max(...finalActive.map((b) => b.explodeTick + opt.flameTicks + 1)));
  }

  return { grid, options: opt, start, positions, bombs, destroyedBy, endTick: now(), warnings };

  // ---------------------------------------------------------------------
  function commitBomb(bomb: Bomb) {
    bombs.push(bomb);
    for (const g of bomb.blast.cells) {
      if (unclaimed.delete(g)) destroyedBy.set(g, bomb.id);
    }
  }

  function hasEscape(cell: number, placeTick: number, withBomb: Bomb[]): boolean {
    const hazards = new Hazards(withBomb, opt);
    // The hero spends the placement tick on the bomb cell.
    if (hazards.isDeadly(cell, placeTick + 1)) return false;
    const r = reachInTime(neigh, cell, placeTick + 1, hazards, opt.fuseTicks + opt.flameTicks + 8);
    for (const c of floor) {
      const a = r.arrival[c];
      if (a >= 0 && a < placeTick + opt.fuseTicks && hazards.isForeverSafe(c, a)) return true;
    }
    return false;
  }

  /** Walk to the closest cell that no pending flame will touch (towards remaining grass if tied). */
  function retreat(reach: ReturnType<typeof reachInTime>, hazards: Hazards) {
    let best = -1;
    let bestScore = Infinity;
    for (const c of floor) {
      const a = reach.arrival[c];
      if (a < 0 || !hazards.isForeverSafe(c, a)) continue;
      const score = (a - reach.startTick) * 10 + distanceToNearest(c, unclaimed) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best >= 0) walk(reach.path(best));
    else positions.push(here()); // should not happen: the escape check guarantees a safe cell
  }

  function distanceToNearest(c: number, targets: Set<number>): number {
    let best = 0;
    if (targets.size === 0) return best;
    best = Infinity;
    const x = cx(grid, c);
    const y = cy(grid, c);
    for (const t of targets) {
      const d = Math.abs(cx(grid, t) - x) + Math.abs(cy(grid, t) - y);
      if (d < best) best = d;
    }
    return best;
  }
}

/** A bomb may go on `cell` at `tick` unless another bomb is there or a pending flame would set it off early. */
function canPlace(cell: number, tick: number, active: Bomb[], opt: PlannerOptions): boolean {
  let live = 0;
  for (const b of active) {
    if (b.explodeTick > tick && b.placeTick <= tick) live++;
    if (b.cell === cell && b.explodeTick >= tick) return false;
    // Chain reactions are avoided: a pending explosion must not reach the new bomb.
    if (b.explodeTick >= tick && b.blast.cells.includes(cell)) return false;
  }
  return live < opt.maxBombs;
}

/**
 * Start on an empty cell near the middle row of the leftmost columns, so the
 * hero has room to move and the first bombs are close by.
 */
export function chooseStart(grid: Grid, floor: number[]): number {
  const midY = Math.floor(HEIGHT / 2);
  let best = floor[0];
  let bestScore = Infinity;
  for (const c of floor) {
    const empty = grid.cells[c] === 0 ? 0 : 6;
    const score = cx(grid, c) * 1.0 + Math.abs(cy(grid, c) - midY) * 1.5 + empty;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
