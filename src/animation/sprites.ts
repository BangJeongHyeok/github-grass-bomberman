/**
 * Original pixel art for the project: "Fuse", a round-helmet bomber made as a
 * homage to classic arcade bomber games (not a copy of any existing character).
 * Big round helmet, dark visor with bright eyes, a lit-fuse antenna, gloves and
 * boots. Every frame is 12x16 art pixels; one art pixel = one SVG unit. The feet
 * sit on the bottom edge, so a frame is drawn at (-6, -10) relative to the
 * centre of the 12x12 cell it stands on.
 *
 * You can replace the hero with your own art: see `HeroSpriteSet` and the
 * `--hero-sprite` CLI option.
 */

export type Sprite = readonly string[];

/** Colour per palette character; '.' is transparent. `k` (outline) is themable. */
export const HERO_COLORS: Record<string, string> = {
  k: "#2b2140", // outline
  F: "#ffe066", // spark on the antenna
  f: "#d8b07a", // fuse antenna
  R: "#ef4b4b", // helmet
  r: "#b8303c", // helmet shade
  h: "#ffb3b3", // helmet highlight
  v: "#1d1b38", // visor
  w: "#ffffff", // eyes
  b: "#3346b8", // suit
  d: "#24318a", // suit shade
  y: "#ffc93c", // belt
  g: "#ffffff", // gloves
  n: "#ef4b4b", // boots
};

const ANTENNA = ["......F.....", ".....f......"];
const HEAD_FRONT = [
  "...kkkkkk...",
  "..kRhhRRRk..",
  ".kRhRRRRRRk.",
  ".kRvvvvvvRk.",
  ".kRvwvvwvRk.",
  ".kRvwvvwvRk.",
  ".kRRvvvvRRk.",
  "..kkrrrrkk..",
];
const HEAD_BACK = [
  "...kkkkkk...",
  "..kRhhRRRk..",
  ".kRhRRRRRRk.",
  ".kRRRRRRRRk.",
  ".kRRRRRRRRk.",
  ".krRRRRRRrk.",
  ".krrRRRRrrk.",
  "..kkrrrrkk..",
];
const BODY = [".gkbbbbbbkg.", ".gkbyyyybkg.", "..kddbbddk.."];

const LEGS_STAND = ["..kbbkkbbk..", "..knnkknnk..", "...kk..kk..."];
const LEGS_WALK_A = ["..kbbkknnk..", "..knnk.kk...", "...kk......."];
const LEGS_WALK_B = ["..knnkkbbk..", "...kk.knnk..", ".......kk..."];

export const HERO_DOWN: Sprite[] = [LEGS_STAND, LEGS_WALK_A, LEGS_WALK_B].map((legs) => [
  ...ANTENNA,
  ...HEAD_FRONT,
  ...BODY,
  ...legs,
]);

export const HERO_UP: Sprite[] = [LEGS_STAND, LEGS_WALK_A, LEGS_WALK_B].map((legs) => [
  ...ANTENNA,
  ...HEAD_BACK,
  ...BODY,
  ...legs,
]);

const SIDE_TOP = [
  ".....F......",
  "......f.....",
  "...kkkkkk...",
  "..kRhhRRRk..",
  ".kRhRRRRRRk.",
  ".kvvvvRRRRk.",
  ".kwvvvRRRRk.",
  ".kwvvvRRRRk.",
  ".kvvvRRRRrk.",
  "..kkrrrrkk..",
  "...kbbgbk...",
  "...kbygbk...",
  "...kddddk...",
];

/** Facing left; the right-facing frames are mirrored at render time. */
export const HERO_LEFT: Sprite[] = [
  [...SIDE_TOP, "...kbbbk....", "..knnnnk....", "...kkkk....."],
  [...SIDE_TOP, "..kbk.kbk...", ".knnk.knnk..", "..kk...kk..."],
  [...SIDE_TOP, "...kbbbk....", "..knnnnk....", "...kkkk....."],
];

/** Both arms up, eyes squeezed happily. */
export const HERO_VICTORY: Sprite = [
  ...ANTENNA,
  "...kkkkkk...",
  "..kRhhRRRk..",
  "gkRhRRRRRRkg",
  "gkRvvvvvvRkg",
  "bkRvwvvwvRkb",
  "bkRwvvvvwRkb",
  ".bkRvvvvRkb.",
  "..kkrrrrkk..",
  "..kbbbbbbk..",
  "..kbyyyybk..",
  "..kddbbddk..",
  ...LEGS_STAND,
];

/**
 * A complete hero: three frames per direction (stand, walk A, walk B), facing
 * down / up / left (right is mirrored), one victory frame, and the palette.
 * All frames of a set must share the same width and height.
 */
export interface HeroSpriteSet {
  down: Sprite[];
  up: Sprite[];
  left: Sprite[];
  victory: Sprite;
  colors: Record<string, string>;
}

export const DEFAULT_HERO: HeroSpriteSet = {
  down: HERO_DOWN,
  up: HERO_UP,
  left: HERO_LEFT,
  victory: HERO_VICTORY,
  colors: HERO_COLORS,
};

/** Validate a (possibly user supplied) sprite set; throws a readable error. */
export function validateHeroSprites(set: HeroSpriteSet): void {
  const frames: [string, Sprite][] = [
    ...(["down", "up", "left"] as const).flatMap((d) => {
      const list = set[d];
      if (!Array.isArray(list) || list.length !== 3) throw new Error(`hero sprite "${d}" needs exactly 3 frames`);
      return list.map((f, i): [string, Sprite] => [`${d}[${i}]`, f]);
    }),
    ["victory", set.victory],
  ];
  const w = frames[0][1][0]?.length ?? 0;
  const h = frames[0][1].length;
  if (w < 4 || w > 24 || h < 4 || h > 28) throw new Error("hero frames must be between 4x4 and 24x28 pixels");
  for (const [name, f] of frames) {
    if (!Array.isArray(f) || f.length !== h) throw new Error(`hero frame ${name} must have ${h} rows`);
    for (const row of f) {
      if (typeof row !== "string" || row.length !== w) throw new Error(`hero frame ${name}: every row must be ${w} characters`);
      for (const ch of row) {
        if (ch !== "." && !set.colors[ch]) throw new Error(`hero frame ${name}: no colour for "${ch}"`);
      }
    }
  }
  for (const [ch, c] of Object.entries(set.colors)) {
    if (!/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d.,\s%]+\))$/.test(c)) throw new Error(`invalid colour for "${ch}": ${c}`);
  }
}

export const BOMB_COLORS: Record<string, string> = {
  k: "#2b2140", // outline (themable)
  b: "#30344f", // body
  w: "#9aa2cc", // shine
  c: "#9097ad", // cap
  f: "#d8b07a", // fuse
};

/** 12x12, drawn at (-6, -6) relative to the cell centre. */
export const BOMB: Sprite = [
  "............",
  ".......f....",
  "......f.....",
  ".....kck....",
  "...kkkkkk...",
  "..kbbbbbbk..",
  ".kbwwbbbbbk.",
  ".kbwbbbbbbk.",
  ".kbbbbbbbbk.",
  ".kbbbbbbbbk.",
  "..kbbbbbbk..",
  "...kkkkkk...",
];

/**
 * Convert pixel art into compact SVG paths, one <path> per colour, merging
 * horizontal runs. Coordinates are offset by (ox, oy).
 */
export function spriteToSvg(sprite: Sprite, colors: Record<string, string>, ox = 0, oy = 0): string {
  const byColor = new Map<string, string[]>();
  sprite.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let len = 1;
      while (x + len < row.length && row[x + len] === ch) len++;
      if (ch !== ".") {
        const color = colors[ch];
        if (!color) throw new Error(`no colour for pixel '${ch}'`);
        const list = byColor.get(color) ?? [];
        list.push(`M${x + ox} ${y + oy}h${len}v1h${-len}z`);
        byColor.set(color, list);
      }
      x += len;
    }
  });
  return [...byColor].map(([color, d]) => `<path fill="${color}" d="${d.join("")}"/>`).join("");
}

/** 5-row pixel font for the victory banner. */
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#####", "#...#", "#...#"],
  B: ["####.", "#...#", "####.", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "####.", "#....", "#####"],
  F: ["#####", "#....", "####.", "#....", "#...."],
  G: [".####", "#....", "#..##", "#...#", ".###."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..###", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "###..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "####.", "#....", "#...."],
  Q: [".###.", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "####.", "#..#.", "#...#"],
  S: [".####", "#....", ".###.", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
  Z: ["#####", "...#.", "..#..", ".#...", "#####"],
  0: [".###.", "#..##", "#.#.#", "##..#", ".###."],
  1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["####.", "....#", ".###.", "#....", "#####"],
  3: ["####.", "....#", ".###.", "....#", "####."],
  4: ["#..#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "####."],
  6: [".###.", "#....", "####.", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", "..#.."],
  8: [".###.", "#...#", ".###.", "#...#", ".###."],
  9: [".###.", "#...#", ".####", "....#", ".###."],
  "!": ["#", "#", "#", ".", "#"],
  "?": [".###.", "#...#", "..##.", ".....", "..#.."],
  ".": [".", ".", ".", ".", "#"],
  ",": ["..", "..", "..", ".#", "#."],
  "-": ["...", "...", "###", "...", "..."],
  ":": [".", "#", ".", "#", "."],
  "'": ["#", "#", ".", ".", "."],
  "+": [".....", "..#..", ".###.", "..#..", "....."],
  "*": ["#.#", ".#.", "#.#", "...", "..."],
  "♥": [".#.#.", "#####", "#####", ".###.", "..#.."],
  " ": ["...", "...", "...", "...", "..."],
};

/** Supported characters of the pixel font. Unknown characters render as spaces. */
export const FONT_CHARS = Object.keys(FONT).join("");

export function textToSprite(text: string): Sprite {
  const rows = ["", "", "", "", ""];
  [...text.toUpperCase()].forEach((ch, i) => {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let r = 0; r < 5; r++) rows[r] += (i > 0 ? "." : "") + glyph[r];
  });
  return rows;
}
