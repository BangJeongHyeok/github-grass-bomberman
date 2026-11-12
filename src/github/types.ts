/** Contribution intensity as GitHub shows it: 0 = no contributions, 4 = darkest green. */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionDay {
  /** ISO date, e.g. "2026-11-12". */
  date: string;
  /** Number of contributions on that day (informational; the game only uses `level`). */
  count: number;
  level: ContributionLevel;
  /** Column in the calendar (0 = oldest week). */
  week: number;
  /** Row in the calendar (0 = Sunday … 6 = Saturday). */
  weekday: number;
}

export interface ContributionCalendar {
  user: string;
  /** Where the data came from. */
  source: "graphql" | "html" | "sample";
  /** Number of week columns (usually 53). */
  weeks: number;
  days: ContributionDay[];
}

export function toLevel(n: number): ContributionLevel {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 4) return 4;
  return Math.round(n) as ContributionLevel;
}
