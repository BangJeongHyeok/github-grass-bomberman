import { renderSvg } from "./animation/svg.js";
import { type HeroSpriteSet, validateHeroSprites } from "./animation/sprites.js";
import { type Theme, resolveTheme } from "./animation/theme.js";
import { gridFromCalendar } from "./game/grid.js";
import { DEFAULT_PLANNER_OPTIONS, type Plan, planGame } from "./game/planner.js";
import { type AnimationModel, DEFAULT_TIMING, buildTimeline } from "./game/timeline.js";
import { validatePlan } from "./game/validate.js";
import type { ContributionCalendar } from "./github/types.js";

export * from "./github/index.js";
export { gridFromCalendar, gridFromAscii } from "./game/grid.js";
export { planGame, type Plan } from "./game/planner.js";
export { validatePlan } from "./game/validate.js";
export { buildTimeline, type AnimationModel } from "./game/timeline.js";
export { renderSvg } from "./animation/svg.js";
export { THEMES, LIGHT, DARK, type Theme } from "./animation/theme.js";
export { DEFAULT_HERO, validateHeroSprites, type HeroSpriteSet } from "./animation/sprites.js";

/** Every user-tunable setting, with defaults. */
export interface BomberOptions {
  /** Colour theme: "light" or "dark". */
  theme: string;
  /** Partial colour overrides on top of the theme. */
  colors: Partial<Theme>;
  /** Random seed: same data + same seed = same animation. */
  seed: string | number;
  /** Cells a flame reaches in each direction. */
  blastRadius: number;
  /** Bombs allowed on the field at once. */
  maxBombs: number;
  /** Fuse length in walking steps. */
  fuseTicks: number;
  /** How long flames stay, in walking steps. */
  flameTicks: number;
  /** Seconds per cell walked. */
  stepDuration: number;
  /** Fastest allowed seconds per cell when squeezing long games. */
  minStepDuration: number;
  /** Target maximum length of the gameplay part (intro/outro excluded). */
  maxGameplaySeconds: number;
  /** Banner shown when the board is cleared ("" to hide). */
  clearText: string;
  /** Custom hero pixel art (see HeroSpriteSet); the built-in bomber when omitted. */
  heroSprite?: HeroSpriteSet;
}

export const DEFAULT_OPTIONS: BomberOptions = {
  theme: "light",
  colors: {},
  seed: "bomber",
  blastRadius: DEFAULT_PLANNER_OPTIONS.blastRadius,
  maxBombs: DEFAULT_PLANNER_OPTIONS.maxBombs,
  fuseTicks: DEFAULT_PLANNER_OPTIONS.fuseTicks,
  flameTicks: DEFAULT_PLANNER_OPTIONS.flameTicks,
  stepDuration: DEFAULT_TIMING.stepDuration,
  minStepDuration: DEFAULT_TIMING.minStepDuration,
  maxGameplaySeconds: DEFAULT_TIMING.maxGameplaySeconds,
  clearText: "ALL CLEAR!",
};

export interface GenerateResult {
  svg: string;
  plan: Plan;
  model: AnimationModel;
}

/** Contribution calendar -> game simulation -> event timeline -> animated SVG. */
export function generate(cal: ContributionCalendar, options: Partial<BomberOptions> = {}): GenerateResult {
  const o = { ...DEFAULT_OPTIONS, ...options };
  if (o.heroSprite) validateHeroSprites(o.heroSprite);
  const grid = gridFromCalendar(cal);
  const plan = planGame(grid, {
    seed: o.seed,
    blastRadius: o.blastRadius,
    maxBombs: o.maxBombs,
    fuseTicks: o.fuseTicks,
    flameTicks: o.flameTicks,
  });
  const problems = validatePlan(plan);
  if (problems.length > 0) {
    throw new Error(`internal error: generated play-through is invalid:\n  ${problems.slice(0, 5).join("\n  ")}`);
  }
  const model = buildTimeline(plan, {
    stepDuration: o.stepDuration,
    minStepDuration: o.minStepDuration,
    maxGameplaySeconds: o.maxGameplaySeconds,
  });
  const svg = renderSvg(model, {
    theme: resolveTheme(o.theme, o.colors),
    clearText: o.clearText,
    title: `GitHub Contribution Bomber — ${cal.user}`,
    seed: o.seed,
    hero: o.heroSprite,
  });
  return { svg, plan, model };
}
