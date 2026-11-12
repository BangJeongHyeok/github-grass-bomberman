import { createRng } from "../game/rng.js";
import { assignWeeksFromDates } from "./html.js";
import type { ContributionCalendar, ContributionDay, ContributionLevel } from "./types.js";

export interface SampleOptions {
  seed?: string | number;
  /** Rough share of days with at least one contribution (0..1). */
  density?: number;
  /** Last day of the calendar (ISO date). Fixed by default so examples are reproducible. */
  endDate?: string;
  user?: string;
}

/**
 * Generate a plausible-looking contribution calendar: busier weekdays, streaks,
 * quiet holiday stretches, and a partial first/last week like the real graph.
 */
export function sampleCalendar(opts: SampleOptions = {}): ContributionCalendar {
  const rng = createRng(opts.seed ?? "sample");
  const density = Math.min(1, Math.max(0, opts.density ?? 0.55));
  const end = Date.parse(`${opts.endDate ?? "2026-11-12"}T00:00:00Z`);
  // GitHub shows the last year: start on the same weekday one year back, then
  // pad back to that week's Sunday is *not* done (the first column is partial).
  const start = end - 364 * 86400000;

  const days: ContributionDay[] = [];
  let mood = rng.next(); // slowly drifting activity level -> streaks & gaps
  for (let t = start, i = 0; t <= end; t += 86400000, i++) {
    const date = new Date(t);
    const weekday = date.getUTCDay();
    mood = Math.min(1, Math.max(0, mood + (rng.next() - 0.5) * 0.35));
    const weekend = weekday === 0 || weekday === 6;
    const p = density * (0.45 + mood * 0.9) * (weekend ? 0.45 : 1.1);
    let count = 0;
    if (rng.next() < p) {
      count = 1 + Math.floor(Math.pow(rng.next(), 2.2) * 14 * (0.5 + mood));
    }
    days.push({ date: date.toISOString().slice(0, 10), count, level: 0, week: 0, weekday });
  }
  assignLevelsByQuartile(days);
  assignWeeksFromDates(days);
  const weeks = Math.max(...days.map((d) => d.week)) + 1;
  return { user: opts.user ?? "sample-user", source: "sample", weeks, days };
}

/** GitHub-like level assignment: quartiles of the non-zero counts. */
export function assignLevelsByQuartile(days: ContributionDay[]): void {
  const nonZero = days.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) {
    for (const d of days) d.level = 0;
    return;
  }
  const q = (f: number) => nonZero[Math.min(nonZero.length - 1, Math.floor(f * nonZero.length))];
  const q1 = q(0.25);
  const q2 = q(0.5);
  const q3 = q(0.75);
  for (const d of days) {
    let level: ContributionLevel = 0;
    if (d.count > 0) level = d.count <= q1 ? 1 : d.count <= q2 ? 2 : d.count <= q3 ? 3 : 4;
    d.level = level;
  }
}

/** A calendar where every day has the given level (useful for tests and stress cases). */
export function uniformCalendar(level: ContributionLevel, endDate = "2026-11-12"): ContributionCalendar {
  const cal = sampleCalendar({ endDate, density: 0 });
  for (const d of cal.days) {
    d.level = level;
    d.count = level === 0 ? 0 : level * 3;
  }
  return cal;
}
