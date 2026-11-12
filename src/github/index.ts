import { fetchContributionsGraphQL } from "./graphql.js";
import { fetchContributionsHtml } from "./html.js";
import { sampleCalendar } from "./sample.js";
import type { ContributionCalendar } from "./types.js";

export * from "./types.js";
export { parseGraphQLResponse, fetchContributionsGraphQL } from "./graphql.js";
export { parseContributionsHtml, fetchContributionsHtml } from "./html.js";
export { sampleCalendar, uniformCalendar } from "./sample.js";

export type DataSource = "auto" | "graphql" | "html" | "sample";

export interface LoadOptions {
  user?: string;
  token?: string;
  source?: DataSource;
  /** When the live API fails, fall back to sample data instead of throwing. */
  allowSampleFallback?: boolean;
  sampleSeed?: string | number;
  log?: (msg: string) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Load the contribution calendar.
 *
 * `auto`: GraphQL when a token is present, otherwise the public HTML page; if no
 * user is configured (local development), sample data is used.
 */
export async function loadContributions(opts: LoadOptions): Promise<ContributionCalendar> {
  const log = opts.log ?? (() => {});
  const source = opts.source ?? "auto";
  const sample = () => sampleCalendar({ seed: opts.sampleSeed ?? opts.user ?? "sample", user: opts.user });

  if (source === "sample") return sample();
  if (!opts.user) {
    if (source === "auto") {
      log("No GitHub user configured; using sample contribution data.");
      return sample();
    }
    throw new Error("A GitHub user name is required (--user or GITHUB_USER).");
  }

  const attempts: [string, () => Promise<ContributionCalendar>][] = [];
  if ((source === "auto" || source === "graphql") && opts.token) {
    attempts.push(["GraphQL API", () => fetchContributionsGraphQL(opts.user!, opts.token!, opts.fetchImpl)]);
  } else if (source === "graphql") {
    throw new Error("The GraphQL source needs a token (--token or GITHUB_TOKEN).");
  }
  if (source === "auto" || source === "html") {
    attempts.push(["public contribution page", () => fetchContributionsHtml(opts.user!, opts.fetchImpl)]);
  }

  const errors: string[] = [];
  for (const [name, attempt] of attempts) {
    try {
      const cal = await attempt();
      log(`Loaded ${cal.days.length} days for ${opts.user} from the ${name}.`);
      return cal;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${msg}`);
      log(`Could not load contributions from the ${name}: ${msg}`);
    }
  }
  if (opts.allowSampleFallback) {
    log("Falling back to sample contribution data.");
    return sample();
  }
  throw new Error(`Could not load contributions for "${opts.user}".\n  ${errors.join("\n  ")}`);
}
