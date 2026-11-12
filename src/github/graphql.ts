import type { ContributionCalendar, ContributionDay, ContributionLevel } from "./types.js";

const QUERY = /* GraphQL */ `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              weekday
              contributionCount
              contributionLevel
            }
          }
        }
      }
    }
  }
`;

const LEVELS: Record<string, ContributionLevel> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

interface GraphQLDay {
  date: string;
  weekday: number;
  contributionCount: number;
  contributionLevel: string;
}

interface GraphQLResponse {
  data?: {
    user: {
      contributionsCollection: {
        contributionCalendar: { weeks: { contributionDays: GraphQLDay[] }[] };
      };
    } | null;
  };
  errors?: { message: string }[];
}

/** Convert a raw GraphQL response into our calendar model. Exported for tests. */
export function parseGraphQLResponse(user: string, json: GraphQLResponse): ContributionCalendar {
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  const u = json.data?.user;
  if (!u) throw new Error(`GitHub user "${user}" not found`);
  const weeks = u.contributionsCollection.contributionCalendar.weeks;
  const days: ContributionDay[] = [];
  weeks.forEach((w, week) => {
    for (const d of w.contributionDays) {
      days.push({
        date: d.date,
        count: d.contributionCount,
        level: LEVELS[d.contributionLevel] ?? (d.contributionCount > 0 ? 1 : 0),
        week,
        weekday: d.weekday,
      });
    }
  });
  return { user, source: "graphql", weeks: weeks.length, days };
}

export async function fetchContributionsGraphQL(
  user: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ContributionCalendar> {
  const res = await fetchImpl("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "github-contribution-bomber",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: user } }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL request failed: HTTP ${res.status} ${res.statusText}`);
  }
  return parseGraphQLResponse(user, (await res.json()) as GraphQLResponse);
}
