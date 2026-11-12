import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  loadContributions,
  parseContributionsHtml,
  parseGraphQLResponse,
  sampleCalendar,
  uniformCalendar,
} from "../src/github/index.js";
import { gridFromCalendar, VOID } from "../src/game/grid.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("GraphQL contribution data", () => {
  const cal = parseGraphQLResponse("octo", JSON.parse(fixture("graphql-response.json")));

  it("maps weeks, weekdays and quartile levels", () => {
    assert.equal(cal.source, "graphql");
    assert.equal(cal.weeks, 3);
    assert.equal(cal.days.length, 16);
    assert.deepEqual(cal.days[0], { date: "2026-10-28", count: 0, level: 0, week: 0, weekday: 3 });
    assert.deepEqual(cal.days[1], { date: "2026-10-29", count: 2, level: 1, week: 0, weekday: 4 });
    assert.equal(cal.days[4].level, 4);
    assert.equal(cal.days.at(-1)!.date, "2026-11-12");
    assert.equal(cal.days.at(-1)!.week, 2);
  });

  it("builds a 7-row grid with missing days as void cells", () => {
    const g = gridFromCalendar(cal);
    assert.equal(g.width, 3);
    assert.equal(g.height, 7);
    assert.equal(g.cells[0], VOID); // Sunday of the first, partial week
    assert.equal(g.cells[3], 0); // Wednesday 2026-10-28
    assert.equal(g.cells[2 * 7 + 6], VOID); // Saturday after "today"
  });

  it("reports API errors and unknown users", () => {
    assert.throws(() => parseGraphQLResponse("x", { errors: [{ message: "Bad credentials" }] }), /Bad credentials/);
    assert.throws(() => parseGraphQLResponse("ghost", { data: { user: null } }), /not found/);
  });
});

describe("public contribution page (HTML)", () => {
  it("parses cells, levels, positions and tooltip counts", () => {
    const cal = parseContributionsHtml("octo", fixture("contributions.html"));
    const graphql = parseGraphQLResponse("octo", JSON.parse(fixture("graphql-response.json")));
    assert.equal(cal.source, "html");
    assert.equal(cal.weeks, 3);
    assert.equal(cal.days.length, 16);
    const strip = (d: { date: string; level: number; week: number; weekday: number }) => [d.date, d.level, d.week, d.weekday];
    assert.deepEqual(cal.days.map(strip), graphql.days.map(strip));
    assert.equal(cal.days.find((d) => d.level === 4)!.count, 1234); // "1,234 contributions"
    assert.equal(cal.days[0].count, 0); // "No contributions"
  });

  it("falls back to dates when the cell ids change", () => {
    const html = fixture("contributions.html").replace(/id="contribution-day-component-\d+-\d+"/g, 'id="x"');
    const cal = parseContributionsHtml("octo", html);
    assert.deepEqual(
      cal.days.map((d) => [d.week, d.weekday]),
      parseContributionsHtml("octo", fixture("contributions.html")).days.map((d) => [d.week, d.weekday]),
    );
  });

  it("throws on a page without a calendar", () => {
    assert.throws(() => parseContributionsHtml("octo", "<html><body>Not Found</body></html>"), /Could not find/);
  });
});

describe("sample data", () => {
  it("is deterministic and looks like a GitHub year", () => {
    const a = sampleCalendar({ seed: 1 });
    const b = sampleCalendar({ seed: 1 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.days.map((d) => d.level), sampleCalendar({ seed: 2 }).days.map((d) => d.level));
    assert.equal(a.days.length, 365);
    assert.ok(a.weeks === 53 || a.weeks === 54);
    for (const d of a.days) assert.ok(d.level >= 0 && d.level <= 4 && d.weekday >= 0 && d.weekday < 7);
    assert.ok(new Set(a.days.map((d) => d.level)).size === 5, "all levels used");
  });

  it("supports empty and full calendars", () => {
    assert.ok(uniformCalendar(0).days.every((d) => d.level === 0));
    assert.ok(uniformCalendar(4).days.every((d) => d.level === 4));
  });
});

describe("loadContributions", () => {
  const failingFetch = (async () => new Response("nope", { status: 500, statusText: "Server Error" })) as typeof fetch;

  it("uses sample data when no user is configured", async () => {
    const cal = await loadContributions({});
    assert.equal(cal.source, "sample");
  });

  it("prefers GraphQL when a token is present", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(fixture("graphql-response.json"), { status: 200 });
    }) as typeof fetch;
    const cal = await loadContributions({ user: "octo", token: "t", fetchImpl });
    assert.equal(cal.source, "graphql");
    assert.deepEqual(calls, ["https://api.github.com/graphql"]);
  });

  it("falls back from GraphQL to the HTML page", async () => {
    const fetchImpl = (async (url: string | URL) =>
      String(url).includes("graphql")
        ? new Response("{}", { status: 401, statusText: "Unauthorized" })
        : new Response(fixture("contributions.html"), { status: 200 })) as typeof fetch;
    const cal = await loadContributions({ user: "octo", token: "bad", fetchImpl });
    assert.equal(cal.source, "html");
  });

  it("fails loudly (no silent fake data) unless sample fallback is allowed", async () => {
    await assert.rejects(loadContributions({ user: "octo", fetchImpl: failingFetch }), /Could not load/);
    const cal = await loadContributions({ user: "octo", fetchImpl: failingFetch, allowSampleFallback: true });
    assert.equal(cal.source, "sample");
  });
});
