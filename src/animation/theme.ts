export interface Theme {
  name: string;
  /** Background behind the board; "none" keeps the SVG transparent so it blends into the page. */
  background: string;
  /** Empty (no contribution / destroyed) cell. */
  empty: string;
  /** Outline drawn around every cell (GitHub uses a very faint one). */
  cellStroke: string;
  /** Grass colours for levels 1..4. */
  levels: [string, string, string, string];
  /** Outline colour for the hero and bombs (needs contrast with the page). */
  outline: string;
  bombOutline: string;
  shadow: string;
  /** Victory banner. */
  panel: string;
  panelBorder: string;
  text: string;
  textShadow: string;
}

export const LIGHT: Theme = {
  name: "light",
  background: "none",
  empty: "#ebedf0",
  cellStroke: "rgba(27,31,35,0.06)",
  levels: ["#9be9a8", "#40c463", "#30a14e", "#216e39"],
  outline: "#2b2140",
  bombOutline: "#2b2140",
  shadow: "rgba(27,31,35,0.22)",
  panel: "#ffffff",
  panelBorder: "#d0d7de",
  text: "#f08a24",
  textShadow: "#6b2f0a",
};

export const DARK: Theme = {
  name: "dark",
  background: "none",
  empty: "#161b22",
  cellStroke: "rgba(255,255,255,0.05)",
  levels: ["#0e4429", "#006d32", "#26a641", "#39d353"],
  outline: "#0a0710",
  bombOutline: "#a3abd1",
  shadow: "rgba(0,0,0,0.5)",
  panel: "#0d1117",
  panelBorder: "#30363d",
  text: "#ffc93c",
  textShadow: "#000000",
};

export const THEMES: Record<string, Theme> = { light: LIGHT, dark: DARK };

export function resolveTheme(name: string | undefined, overrides: Partial<Theme> = {}): Theme {
  const base = THEMES[(name ?? "light").toLowerCase()];
  if (!base) throw new Error(`Unknown theme "${name}" (use one of: ${Object.keys(THEMES).join(", ")})`);
  return { ...base, ...overrides };
}
