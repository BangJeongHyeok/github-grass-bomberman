import type { ContributionCalendar, ContributionDay } from "./types.js";
import { toLevel } from "./types.js";

/**
 * Parse the public, unauthenticated contribution calendar page
 * (https://github.com/users/<user>/contributions).
 *
 * Each day is a `<td class="ContributionCalendar-day" data-date=… data-level=…
 * id="contribution-day-component-<weekday>-<week>">` cell; the count lives in a
 * matching `<tool-tip for="contribution-day-component-…">` element.
 */
export function parseContributionsHtml(user: string, html: string): ContributionCalendar {
  const counts = new Map<string, number>();
  const tipRe = /<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g;
  for (let m = tipRe.exec(html); m; m = tipRe.exec(html)) {
    const text = m[2].trim();
    const n = /^(\d[\d,]*)\s+contribution/i.exec(text);
    counts.set(m[1], n ? Number(n[1].replace(/,/g, "")) : 0);
  }

  const days: ContributionDay[] = [];
  const tdRe = /<td\b[^>]*>/g;
  for (let m = tdRe.exec(html); m; m = tdRe.exec(html)) {
    const tag = m[0];
    const date = attr(tag, "data-date");
    const level = attr(tag, "data-level");
    if (!date || level === undefined) continue;
    const id = attr(tag, "id") ?? "";
    const pos = /contribution-day-component-(\d+)-(\d+)/.exec(id);
    // Fall back to the date when the id format changes.
    const weekday = pos ? Number(pos[1]) : new Date(`${date}T00:00:00Z`).getUTCDay();
    const week = pos ? Number(pos[2]) : -1;
    days.push({ date, level: toLevel(Number(level)), count: counts.get(id) ?? 0, weekday, week });
  }
  if (days.length === 0) {
    throw new Error(`Could not find any contribution cells for "${user}" in the HTML page`);
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  if (days.some((d) => d.week < 0)) assignWeeksFromDates(days);
  const minWeek = Math.min(...days.map((d) => d.week));
  for (const d of days) d.week -= minWeek;
  const weeks = Math.max(...days.map((d) => d.week)) + 1;
  return { user, source: "html", weeks, days };
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : undefined;
}

/** Recompute week columns from dates (weeks start on Sunday). Days must be sorted. */
export function assignWeeksFromDates(days: ContributionDay[]): void {
  if (days.length === 0) return;
  const first = Date.parse(`${days[0].date}T00:00:00Z`);
  const firstSunday = first - new Date(first).getUTCDay() * 86400000;
  for (const d of days) {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    d.weekday = new Date(t).getUTCDay();
    d.week = Math.floor((t - firstSunday) / (7 * 86400000));
  }
}

export async function fetchContributionsHtml(
  user: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ContributionCalendar> {
  const res = await fetchImpl(`https://github.com/users/${encodeURIComponent(user)}/contributions`, {
    headers: { "User-Agent": "github-contribution-bomber" },
  });
  if (!res.ok) {
    throw new Error(`Fetching the contribution page failed: HTTP ${res.status} ${res.statusText}`);
  }
  return parseContributionsHtml(user, await res.text());
}
