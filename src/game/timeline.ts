import type { BlastArms } from "./blast.js";
import { type Direction, type Grid, cx, cy, directionBetween } from "./grid.js";
import type { Plan } from "./planner.js";

export interface TimingOptions {
  /** Seconds the hero needs to walk one cell. */
  stepDuration: number;
  /** Lower bound when the game is sped up to fit `maxGameplaySeconds`. */
  minStepDuration: number;
  /** Long games are sped up (down to minStepDuration) to stay within this length. */
  maxGameplaySeconds: number;
}

export const DEFAULT_TIMING: TimingOptions = {
  stepDuration: 0.13,
  minStepDuration: 0.08,
  maxGameplaySeconds: 50,
};

export interface HeroKey {
  t: number;
  /** Cell coordinates (fractional while walking). */
  x: number;
  y: number;
}

export interface BombEvent {
  id: number;
  x: number;
  y: number;
  placeAt: number;
  explodeAt: number;
}

export interface ExplosionEvent {
  id: number;
  x: number;
  y: number;
  at: number;
  endAt: number;
  arms: BlastArms;
  destroyed: { x: number; y: number; level: number }[];
}

/** Everything the SVG renderer needs, in seconds. The game logic is fully resolved here. */
export interface AnimationModel {
  grid: Grid;
  duration: number;
  step: number;
  intro: { appear: number; land: number; start: number };
  hero: {
    keys: HeroKey[];
    facing: { t: number; dir: Direction }[];
    walking: { t: number; on: boolean }[];
    placing: number[];
  };
  bombs: BombEvent[];
  explosions: ExplosionEvent[];
  /** Hero celebrates; "ALL CLEAR" banner. */
  victory: { start: number; end: number; jumps: { start: number; end: number }[] };
  /** Hero vanishes before the board resets. */
  warpOut: { start: number; end: number };
  /** Grass grows back column by column. */
  regrow: { start: number; end: number; columnFade: number };
  /** Ordered human-readable events (for debugging / tests / docs). */
  events: { t: number; type: string; detail?: string }[];
}

export function buildTimeline(plan: Plan, timing: Partial<TimingOptions> = {}): AnimationModel {
  const opts = { ...DEFAULT_TIMING, ...timing };
  const { grid } = plan;
  const ticks = Math.max(plan.endTick, 1);
  const step = Math.max(opts.minStepDuration, Math.min(opts.stepDuration, opts.maxGameplaySeconds / ticks));
  const round = (v: number) => Math.round(v * 1000) / 1000;

  const intro = { appear: 0.5, land: 1.0, start: 1.35 };
  const at = (tick: number) => round(intro.start + tick * step);
  const events: AnimationModel["events"] = [
    { t: 0, type: "board", detail: "full contribution graph" },
    { t: intro.appear, type: "hero-appear" },
    { t: intro.start, type: "game-start" },
  ];

  // ---- hero path -------------------------------------------------------
  const pos = plan.positions;
  const keys: HeroKey[] = [];
  const velocity = (k: number) => {
    if (k < 0 || k + 1 >= pos.length) return "0,0";
    return `${cx(grid, pos[k + 1]) - cx(grid, pos[k])},${cy(grid, pos[k + 1]) - cy(grid, pos[k])}`;
  };
  for (let k = 0; k < pos.length; k++) {
    if (k === 0 || k === pos.length - 1 || velocity(k - 1) !== velocity(k)) {
      keys.push({ t: at(k), x: cx(grid, pos[k]), y: cy(grid, pos[k]) });
    }
  }

  const facing: AnimationModel["hero"]["facing"] = [{ t: 0, dir: "down" }];
  const walking: AnimationModel["hero"]["walking"] = [{ t: 0, on: false }];
  let lastDir: Direction = "down";
  let lastWalk = false;
  for (let k = 0; k < pos.length; k++) {
    const dir = k + 1 < pos.length ? directionBetween(grid, pos[k], pos[k + 1]) : null;
    const moving = dir !== null;
    if (moving && dir !== lastDir) {
      facing.push({ t: at(k), dir });
      lastDir = dir;
    }
    if (moving !== lastWalk) {
      walking.push({ t: at(k), on: moving });
      lastWalk = moving;
    }
  }

  // ---- bombs and explosions -------------------------------------------
  const flameSeconds = plan.options.flameTicks * step;
  const bombs: BombEvent[] = plan.bombs.map((b) => ({
    id: b.id,
    x: cx(grid, b.cell),
    y: cy(grid, b.cell),
    placeAt: round(at(b.placeTick) + step * 0.5),
    explodeAt: at(b.explodeTick),
  }));
  const destroyedByBomb = new Map<number, number[]>();
  for (const [cell, id] of plan.destroyedBy) {
    const list = destroyedByBomb.get(id) ?? [];
    list.push(cell);
    destroyedByBomb.set(id, list);
  }
  const explosions: ExplosionEvent[] = plan.bombs.map((b) => ({
    id: b.id,
    x: cx(grid, b.cell),
    y: cy(grid, b.cell),
    at: at(b.explodeTick),
    endAt: round(at(b.explodeTick) + Math.max(flameSeconds, 0.3)),
    arms: b.blast.arms,
    destroyed: (destroyedByBomb.get(b.id) ?? [])
      .sort((a, c) => a - c)
      .map((c) => ({ x: cx(grid, c), y: cy(grid, c), level: grid.cells[c] })),
  }));
  for (const b of bombs) events.push({ t: b.placeAt, type: "bomb-place", detail: `#${b.id} at (${b.x},${b.y})` });
  for (const e of explosions) {
    events.push({ t: e.at, type: "explode", detail: `#${e.id} destroys ${e.destroyed.length}` });
  }

  // ---- ending ---------------------------------------------------------
  const gameEnd = at(plan.endTick);
  const vStart = round(gameEnd + 0.25);
  const jumps = [0, 1, 2].map((i) => ({ start: round(vStart + 0.15 + i * 0.5), end: round(vStart + 0.55 + i * 0.5) }));
  const victory = { start: vStart, end: round(vStart + 2.7), jumps };
  const warpOut = { start: round(vStart + 2.2), end: round(vStart + 2.6) };
  const regrow = { start: round(warpOut.end + 0.15), end: round(warpOut.end + 1.35), columnFade: 0.3 };
  const duration = round(regrow.end + 0.45);
  events.push(
    { t: gameEnd, type: "board-cleared" },
    { t: victory.start, type: "victory" },
    { t: warpOut.start, type: "hero-exit" },
    { t: regrow.start, type: "reset", detail: "grass grows back" },
    { t: duration, type: "loop" },
  );
  events.sort((a, b) => a.t - b.t);

  return {
    grid,
    duration,
    step: round(step),
    intro,
    hero: { keys, facing, walking, placing: plan.bombs.map((b) => at(b.placeTick)) },
    bombs,
    explosions,
    victory,
    warpOut,
    regrow,
    events,
  };
}
