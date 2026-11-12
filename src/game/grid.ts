import type { ContributionCalendar, ContributionLevel } from "../github/types.js";

/** Marker for calendar slots that do not exist (before the first / after the last day). */
export const VOID = -1;

/**
 * The game board. Cells are addressed by index `i = x * height + y` (column-major,
 * like the contribution graph: x = week, y = weekday).
 */
export interface Grid {
  width: number;
  height: number;
  /** Per-cell level: VOID (-1) for missing slots, 0 for empty, 1..4 for grass. */
  cells: Int8Array;
}

export const HEIGHT = 7;

export function createGrid(width: number, height = HEIGHT): Grid {
  return { width, height, cells: new Int8Array(width * height).fill(VOID) };
}

export function gridFromCalendar(cal: ContributionCalendar): Grid {
  const width = Math.max(1, cal.weeks);
  const grid = createGrid(width);
  for (const d of cal.days) {
    if (d.week < 0 || d.week >= width || d.weekday < 0 || d.weekday >= HEIGHT) continue;
    grid.cells[idx(grid, d.week, d.weekday)] = d.level;
  }
  return grid;
}

/** Build a grid from ASCII art (tests): '.' empty, '1'-'4' grass, ' ' or '#' void. Rows are weekdays. */
export function gridFromAscii(rows: string[]): Grid {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const grid = createGrid(width, height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? " ";
      grid.cells[idx(grid, x, y)] = ch === "." ? 0 : ch >= "1" && ch <= "4" ? (Number(ch) as ContributionLevel) : VOID;
    }
  });
  return grid;
}

export const idx = (g: Grid, x: number, y: number) => x * g.height + y;
export const cx = (g: Grid, i: number) => Math.floor(i / g.height);
export const cy = (g: Grid, i: number) => i % g.height;

export function inBounds(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.width && y < g.height;
}

/** A cell the hero can stand on / flames can pass through. */
export function isFloor(g: Grid, x: number, y: number): boolean {
  return inBounds(g, x, y) && g.cells[idx(g, x, y)] !== VOID;
}

export function isGrass(g: Grid, i: number): boolean {
  return g.cells[i] > 0;
}

export function grassCells(g: Grid): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] > 0) out.push(i);
  return out;
}

export function floorCells(g: Grid): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== VOID) out.push(i);
  return out;
}

export const DIRS = [
  { name: "up", dx: 0, dy: -1 },
  { name: "down", dx: 0, dy: 1 },
  { name: "left", dx: -1, dy: 0 },
  { name: "right", dx: 1, dy: 0 },
] as const;

export type Direction = (typeof DIRS)[number]["name"];

/** Floor neighbours of each cell, precomputed once per grid. */
export function neighbourTable(g: Grid): number[][] {
  const table: number[][] = [];
  for (let i = 0; i < g.cells.length; i++) {
    const x = cx(g, i);
    const y = cy(g, i);
    const list: number[] = [];
    if (g.cells[i] !== VOID) {
      for (const d of DIRS) {
        if (isFloor(g, x + d.dx, y + d.dy)) list.push(idx(g, x + d.dx, y + d.dy));
      }
    }
    table.push(list);
  }
  return table;
}

export function directionBetween(g: Grid, from: number, to: number): Direction | null {
  const dx = cx(g, to) - cx(g, from);
  const dy = cy(g, to) - cy(g, from);
  for (const d of DIRS) if (d.dx === dx && d.dy === dy) return d.name;
  return null;
}
