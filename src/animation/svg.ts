import { createRng } from "../game/rng.js";
import type { AnimationModel } from "../game/timeline.js";
import type { BlastArms } from "../game/blast.js";
import { KeyframeSheet, type Stop, fmt } from "./keyframes.js";
import {
  BOMB,
  BOMB_COLORS,
  DEFAULT_HERO,
  type HeroSpriteSet,
  spriteToSvg,
  textToSprite,
} from "./sprites.js";
import type { Theme } from "./theme.js";

export interface RenderOptions {
  theme: Theme;
  /** Banner shown when the board is cleared (pixel font: A-Z 0-9 ! ? . , - : ' + * ♥). Empty hides it. */
  clearText: string;
  /** Accessible title of the image. */
  title: string;
  /** Seed for decorative randomness (sparkle positions). */
  seed: string | number;
  /** Hero pixel art; defaults to the built-in bomber. */
  hero?: HeroSpriteSet;
}

/** Board geometry, in SVG user units. */
export const CELL = 12;
export const PITCH = 16;
const RADIUS = 2;
const PAD_X = 14;
const PAD_TOP = 30;
const PAD_BOTTOM = 12;

const FLAME = { outer: "#ff4d1c", mid: "#ffa62b", core: "#fff3b0" };

/**
 * Render the animation model as a standalone animated SVG.
 *
 * Everything is driven by CSS @keyframes that share one loop duration, so the
 * file plays in an <img> tag (GitHub README) with no scripts or external assets.
 */
export function renderSvg(model: AnimationModel, opts: RenderOptions): string {
  const { grid, duration: D } = model;
  const t = opts.theme;
  const sheet = new KeyframeSheet(D);
  const art = opts.hero ?? DEFAULT_HERO;
  const artW = art.victory[0].length;
  const artH = art.victory.length;
  // room above the top row for the hero's head while jumping
  const padTop = Math.max(PAD_TOP, artH + 4);
  const width = PAD_X * 2 + grid.width * PITCH - (PITCH - CELL);
  const height = padTop + grid.height * PITCH - (PITCH - CELL) + PAD_BOTTOM;
  const px = (x: number) => PAD_X + x * PITCH; // cell left edge
  const py = (y: number) => padTop + y * PITCH;
  const mx = (x: number) => px(x) + CELL / 2; // cell centre
  const my = (y: number) => py(y) + CELL / 2;
  const n = (v: number) => fmt(v, 2);
  const tr = (x: number, y: number) => `translate(${n(x)},${n(y)})`;

  const defs: string[] = [];
  const body: string[] = [];

  // ---------------------------------------------------------------- defs
  defs.push(`<rect id="e" width="${CELL}" height="${CELL}" rx="${RADIUS}"/>`);
  // Built-in art uses `k` as the themable outline; custom art keeps its own colours.
  const hero = opts.hero ? art.colors : { ...art.colors, k: t.outline };
  // centred horizontally, feet on the bottom edge of the cell
  const frame = (id: string, sprite: readonly string[]) =>
    defs.push(`<g id="${id}">${spriteToSvg(sprite, hero, -Math.floor(artW / 2), CELL / 2 - artH)}</g>`);
  art.down.forEach((s, i) => frame(`hd${i}`, s));
  art.up.forEach((s, i) => frame(`hu${i}`, s));
  art.left.forEach((s, i) => frame(`hl${i}`, s));
  frame("hv", art.victory);
  defs.push(
    `<g id="B"><g class="pu">${spriteToSvg(BOMB, { ...BOMB_COLORS, k: t.bombOutline }, -6, -6)}</g>` +
      `<g transform="translate(1.5,-5.5)"><g class="sp"><path fill="#ffe066" d="M-.6-2.6h1.2v2h2v1.2h-2v2h-1.2v-2h-2v-1.2h2z"/>` +
      `<path fill="#fff" d="M-.6-.6h1.2v1.2h-1.2z"/></g></g></g>`,
  );
  t.levels.forEach((c, i) =>
    defs.push(
      `<g id="d${i + 1}"><path fill="${c}" d="M-4.5-4.5h2.6v2.6h-2.6zM1.8-4.8h2.4v2.4h-2.4zM-4.6 1.6h2.4v2.4h-2.4zM2 2h2.6v2.6h-2.6z"/>` +
        `<path fill="#ffd166" d="M-.8-.8h1.6v1.6h-1.6z"/></g>`,
    ),
  );
  const flameIds = new Map<string, string>();
  const flameShape = (a: BlastArms) => {
    const key = `${a.up}${a.down}${a.left}${a.right}`;
    let id = flameIds.get(key);
    if (!id) {
      id = `f${key}`;
      flameIds.set(key, id);
      defs.push(`<g id="${id}">${flameMarkup(a)}</g>`);
    }
    return id;
  };

  // ---------------------------------------------------------------- styles
  const css: string[] = [
    `.A{animation-duration:${fmt(D)}s;animation-iteration-count:infinite;animation-timing-function:linear}`,
    `.S{animation-timing-function:step-end}`,
    `.H{opacity:0}`,
    `.G rect{transform-box:fill-box;transform-origin:center}`,
    ...t.levels.map((c, i) => `.L${i + 1}{fill:${c}}`),
    `@keyframes wa{0%{opacity:1}50%{opacity:0}}.wa{animation:wa .26s step-end infinite}`,
    `@keyframes wb{0%{opacity:0}50%{opacity:1}}.wb{animation:wb .26s step-end infinite}`,
    `@keyframes pu{0%{transform:scale(1)}100%{transform:scale(1.1)}}.pu{animation:pu .32s ease-in-out infinite alternate}`,
    `@keyframes sp{0%{opacity:1;transform:scale(1.2)}50%{opacity:.5;transform:scale(.6)}}.sp{animation:sp .14s step-end infinite}`,
    `@keyframes fk{0%{opacity:1}50%{opacity:.6}}.fk{animation:fk .12s step-end infinite}`,
    `@keyframes tw{0%,100%{opacity:0;transform:scale(.2)}50%{opacity:1;transform:scale(1)}}.tw{animation:tw .9s ease-in-out infinite}`,
  ];

  // ---------------------------------------------------------------- board
  const floor: string[] = [];
  for (let x = 0; x < grid.width; x++) {
    for (let y = 0; y < grid.height; y++) {
      if (grid.cells[x * grid.height + y] >= 0) floor.push(`<use href="#e" x="${px(x)}" y="${py(y)}"/>`);
    }
  }
  body.push(`<g fill="${t.empty}" stroke="${t.cellStroke}" stroke-width="1">${floor.join("")}</g>`);

  // Many effects share one keyframe "template" whose visible window starts at
  // local time P; each element is shifted onto its own moment with a negative
  // animation-delay. Phase-shifted infinite animations keep the same period, so
  // everything stays in sync on every loop while the CSS stays small.
  const P = 0.5;
  const shift = (time: number) => `animation-delay:${fmt(time - P - D)}s`;

  // grass: one group per column (for the regrow wave), one keyframe per explosion
  const { regrow, victory } = model;
  const grassClass = new Map<number, string>(); // cell -> class
  for (const e of model.explosions) {
    if (e.destroyed.length === 0) continue;
    const name = sheet.add(`g${e.id}`, [
      [0, "transform:scale(1)"],
      [e.at, "transform:scale(1)"],
      [e.at + 0.06, "transform:scale(1.25)"],
      [e.at + 0.22, "transform:scale(0)"],
      [regrow.start - 0.05, "transform:scale(0)"],
      [regrow.start - 0.05, "transform:scale(1)"],
      [D, "transform:scale(1)"],
    ]);
    for (const c of e.destroyed) grassClass.set(c.x * grid.height + c.y, name);
  }
  // Columns hide once the board is clear and fade back in one after another.
  const span = Math.max(0.01, regrow.end - regrow.start - regrow.columnFade);
  const hideAt = victory.start;
  const col = sheet.add("c", [
    [0, "opacity:1;transform:translate(0,0)"],
    [P, "opacity:1;transform:translate(0,0)"],
    [P, "opacity:0;transform:translate(0,5px)"],
    [P + regrow.start - hideAt, "opacity:0;transform:translate(0,5px);animation-timing-function:ease-out"],
    [P + regrow.start - hideAt + regrow.columnFade, "opacity:1;transform:translate(0,0)"],
    [D, "opacity:1;transform:translate(0,0)"],
  ]);
  const cols: string[] = [];
  for (let x = 0; x < grid.width; x++) {
    const rects: string[] = [];
    for (let y = 0; y < grid.height; y++) {
      const i = x * grid.height + y;
      const level = grid.cells[i];
      if (level <= 0) continue;
      const cls = grassClass.get(i);
      rects.push(
        `<rect class="L${level}${cls ? ` A ${cls}` : ""}" x="${px(x)}" y="${py(y)}" width="${CELL}" height="${CELL}" rx="${RADIUS}"/>`,
      );
    }
    if (rects.length === 0) continue;
    const delay = hideAt + (span * x) / Math.max(1, grid.width - 1);
    cols.push(`<g class="A ${col}" style="${shift(delay)}">${rects.join("")}</g>`);
  }
  body.push(`<g class="G">${cols.join("")}</g>`);

  // ---------------------------------------------------------------- bombs
  const sc = (s: number, o: number) => `transform:scale(${s});opacity:${o}`;
  if (model.bombs.length > 0) {
    const fuse = model.bombs[0].explodeAt - model.bombs[0].placeAt;
    const bomb = sheet.add("b", [
      [0, sc(0, 0)],
      [P, sc(0, 0)],
      [P, sc(0.4, 1)],
      [P + 0.1, sc(1.25, 1)],
      [P + 0.2, sc(1, 1)],
      [P + Math.max(0.25, fuse - 0.35), sc(1, 1)],
      [P + fuse - 0.02, sc(1.35, 1)],
      [P + fuse, sc(0, 0)],
      [D, sc(0, 0)],
    ]);
    const bombEls = model.bombs.map(
      (b) =>
        `<g transform="${tr(mx(b.x), my(b.y))}"><g class="A H ${bomb}" style="${shift(b.placeAt)}"><use href="#B"/></g></g>`,
    );
    body.push(`<g>${bombEls.join("")}</g>`);
  }

  // ---------------------------------------------------------------- flames + debris
  if (model.explosions.length > 0) {
    const life = model.explosions[0].endAt - model.explosions[0].at;
    const flame = sheet.add("x", [
      [0, sc(0, 0)],
      [P, sc(0, 0)],
      [P, sc(0.15, 1)],
      [P + 0.07, sc(1.08, 1)],
      [P + 0.13, sc(1, 1)],
      [P + Math.max(0.16, life - 0.14), sc(1, 1)],
      [P + life, sc(0.8, 0)],
      [D, sc(0, 0)],
    ]);
    const pf = (s: number, r: number, o: number) => `transform:scale(${s}) rotate(${r}deg);opacity:${o}`;
    const bits = sheet.add("p", [
      [0, pf(0, 0, 0)],
      [P + 0.05, pf(0, 0, 0)],
      [P + 0.05, pf(0.7, 0, 1) + ";animation-timing-function:ease-out"],
      [P + 0.55, pf(2.8, 80, 0)],
      [D, pf(0, 0, 0)],
    ]);
    const flames: string[] = [];
    const debris: string[] = [];
    for (const e of model.explosions) {
      const delay = shift(e.at);
      flames.push(
        `<g transform="${tr(mx(e.x), my(e.y))}"><g class="A H ${flame}" style="${delay}"><use href="#${flameShape(e.arms)}"/></g></g>`,
      );
      for (const c of e.destroyed) {
        debris.push(
          `<g transform="${tr(mx(c.x), my(c.y))}"><use class="A H ${bits}" style="${delay}" href="#d${c.level}"/></g>`,
        );
      }
    }
    body.push(`<g>${flames.join("")}</g>`, `<g>${debris.join("")}</g>`);
  }

  // ---------------------------------------------------------------- hero
  body.push(renderHero());

  // ---------------------------------------------------------------- victory
  body.push(renderVictory());

  const title = escapeXml(opts.title);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<desc>A pixel-art bomber walks over the contribution graph, places bombs and clears every green cell, then the graph grows back and the loop repeats.</desc>`,
    `<style>\n${css.join("\n")}\n${sheet.css()}\n</style>`,
    `<defs>${defs.join("")}</defs>`,
    t.background !== "none" ? `<rect width="100%" height="100%" fill="${t.background}"/>` : "",
    ...body,
    `</svg>`,
  ].join("\n");

  // =================================================================
  function renderHero(): string {
    const h = model.hero;
    const k0 = h.keys[0];
    const pos = (x: number, y: number) => `transform:translate(${n(mx(x))}px,${n(my(y))}px)`;
    const move: Stop[] = [[0, pos(k0.x, k0.y)], ...h.keys.map((k): Stop => [k.t, pos(k.x, k.y)])];
    const last = h.keys[h.keys.length - 1];
    move.push([D, pos(last.x, last.y)]);
    const hm = sheet.add("hm", move);

    // vertical bounce / squash: intro drop, bomb placing, victory jumps, exit
    const J = (time: number, dy: number, sx: number, sy: number, o: number, ease?: string): Stop => [
      time,
      `transform:translate(0,${n(dy)}px) scale(${sx},${sy});opacity:${o}${ease ? `;animation-timing-function:${ease}` : ""}`,
    ];
    const { intro, victory, warpOut } = model;
    const jump: Stop[] = [
      J(0, -48, 1, 1, 0),
      J(intro.appear, -48, 1, 1, 0),
      J(intro.appear, -48, 0.9, 1.15, 1, "ease-in"),
      J(intro.land, 0, 1.18, 0.82, 1, "ease-out"),
      J(intro.land + 0.12, -4, 0.95, 1.06, 1, "ease-in"),
      J(intro.land + 0.24, 0, 1, 1, 1),
    ];
    for (const tp of h.placing) {
      jump.push(J(tp, 0, 1, 1, 1), J(tp + model.step * 0.45, 1.5, 1.14, 0.86, 1), J(tp + model.step, 0, 1, 1, 1));
    }
    for (const j of victory.jumps) {
      const mid = (j.start + j.end) / 2;
      jump.push(
        J(j.start - 0.06, 0, 1, 1, 1),
        J(j.start, 0, 1.12, 0.88, 1, "ease-out"),
        J(mid, -14, 0.94, 1.08, 1, "ease-in"),
        J(j.end, 0, 1.14, 0.86, 1),
        J(j.end + 0.08, 0, 1, 1, 1),
      );
    }
    jump.push(
      J(warpOut.start, 0, 1, 1, 1),
      J(warpOut.start + 0.12, 2, 1.3, 0.7, 1, "ease-in"),
      J(warpOut.end, -44, 0.15, 2.4, 0),
      J(D, -44, 0.15, 2.4, 0),
    );
    const hj = sheet.add("hj", jump);

    const shadowStops: Stop[] = [
      [0, "transform:scale(0);opacity:0"],
      [intro.appear, "transform:scale(.2);opacity:1"],
      [intro.land, "transform:scale(1);opacity:1"],
    ];
    for (const j of victory.jumps) {
      const mid = (j.start + j.end) / 2;
      shadowStops.push([j.start, "transform:scale(1);opacity:1"], [mid, "transform:scale(.6);opacity:1"], [j.end, "transform:scale(1);opacity:1"]);
    }
    shadowStops.push(
      [warpOut.start, "transform:scale(1);opacity:1"],
      [warpOut.end, "transform:scale(0);opacity:0"],
      [D, "transform:scale(0);opacity:0"],
    );
    const hs = sheet.add("hs", shadowStops);

    // facing (step-end opacity toggles); victory pose replaces all directions
    const dirs = ["down", "up", "left", "right"] as const;
    const faceClass: Record<string, string> = {};
    for (const d of dirs) {
      const stops: Stop[] = [];
      let prev = -1;
      const set = (time: number, v: number) => {
        if (v !== prev) stops.push([time, `opacity:${v}`]);
        prev = v;
      };
      for (const f of h.facing) set(f.t, f.dir === d ? 1 : 0);
      set(victory.start, 0);
      stops.push([D, `opacity:${d === "down" ? 1 : 0}`]);
      faceClass[d] = sheet.add(`f${d[0]}`, stops);
    }
    const fv = sheet.add("fv", [[0, "opacity:0"], [victory.start, "opacity:1"], [D, "opacity:0"]]);
    const walkStops = (on: number): Stop[] => {
      const stops: Stop[] = h.walking.map((w): Stop => [w.t, `opacity:${w.on ? on : 1 - on}`]);
      stops.push([victory.start, `opacity:${1 - on}`], [D, `opacity:${1 - on}`]);
      return stops;
    };
    const ww = sheet.add("ww", walkStops(1));
    const wi = sheet.add("wi", walkStops(0));

    const dirGroup = (letter: string) =>
      `<g class="A S ${wi}"><use href="#h${letter}0"/></g>` +
      `<g class="A S H ${ww}"><g class="wa"><use href="#h${letter}1"/></g><g class="wb"><use href="#h${letter}2"/></g></g>`;

    // landing dust
    const du = sheet.add("du", [
      [0, "transform:scale(.3);opacity:0"],
      [intro.land, "transform:scale(.3);opacity:0"],
      [intro.land, "transform:scale(.5);opacity:.9;animation-timing-function:ease-out"],
      [intro.land + 0.4, "transform:scale(1.9);opacity:0"],
      [D, "transform:scale(.3);opacity:0"],
    ]);
    const dustColor = t.name === "dark" ? "#8b949e" : "#c8ccd1";
    return [
      `<g transform="${tr(mx(k0.x), my(k0.y) + 5)}"><g class="A H ${du}" fill="${dustColor}"><path d="M-9-1.5h3v3h-3zM6-1.5h3v3h-3zM-12 0h2v2h-2zM10 0h2v2h-2z"/></g></g>`,
      `<g class="A ${hm}" transform="${tr(mx(k0.x), my(k0.y))}" shape-rendering="crispEdges">`,
      `<g transform="translate(0,6)"><ellipse class="A ${hs}" rx="5.5" ry="1.8" fill="${t.shadow}"/></g>`,
      `<g class="A ${hj}">`,
      `<g class="A S ${faceClass.down}">${dirGroup("d")}</g>`,
      `<g class="A S H ${faceClass.up}">${dirGroup("u")}</g>`,
      `<g class="A S H ${faceClass.left}">${dirGroup("l")}</g>`,
      `<g class="A S H ${faceClass.right}"><g transform="scale(-1,1)">${dirGroup("l")}</g></g>`,
      `<g class="A S H ${fv}"><use href="#hv"/></g>`,
      `</g></g>`,
    ].join("");
  }

  function renderVictory(): string {
    const { victory } = model;
    const out: string[] = [];
    const cxB = PAD_X + (grid.width * PITCH - (PITCH - CELL)) / 2;
    const cyB = padTop + (grid.height * PITCH - (PITCH - CELL)) / 2;

    // fireworks: two rings of pixels bursting outwards
    const rng = createRng(`${opts.seed}:fx`);
    const colors = ["#ffd166", "#ff6b6b", "#4dd0e1", "#b388ff", "#69f0ae"];
    const ring = (count: number, r: number, size: number, phase: number) => {
      let d = "";
      for (let k = 0; k < count; k++) {
        const a = ((k + phase) / count) * Math.PI * 2;
        d += `M${n(Math.cos(a) * r - size / 2)} ${n(Math.sin(a) * r - size / 2)}h${size}v${size}h-${size}z`;
      }
      return d;
    };
    for (let i = 0; i < 5; i++) {
      const at = victory.start + 0.1 + i * 0.36;
      const fx = PAD_X + (0.1 + 0.8 * ((i * 0.37 + rng.next() * 0.15) % 1)) * (width - PAD_X * 2);
      const fy = padTop + 8 + rng.next() * 50;
      const name = sheet.add(`fw${i}`, [
        [0, "transform:scale(.2);opacity:0"],
        [at, "transform:scale(.2);opacity:0"],
        [at, "transform:scale(.3);opacity:1;animation-timing-function:cubic-bezier(.15,.75,.3,1)"],
        [at + 0.55, "transform:scale(3.2);opacity:1"],
        [at + 0.95, "transform:scale(3.8);opacity:0"],
        [D, "transform:scale(.2);opacity:0"],
      ]);
      out.push(
        `<g transform="${tr(fx, fy)}"><g class="A H ${name}">` +
          `<path fill="${colors[i % colors.length]}" d="${ring(12, 8, 2, 0)}"/>` +
          `<path fill="${colors[(i + 2) % colors.length]}" d="${ring(8, 4.5, 1.6, 0.5)}"/>` +
          `<path fill="#fff" d="M-1-1h2v2h-2z"/></g></g>`,
      );
    }

    // twinkling sparkles while celebrating
    const vs = sheet.add("vs", [
      [0, "opacity:0"],
      [victory.start, "opacity:1"],
      [victory.end, "opacity:0"],
      [D, "opacity:0"],
    ]);
    const sparkles: string[] = [];
    for (let i = 0; i < 18; i++) {
      const x = PAD_X + rng.next() * (width - PAD_X * 2);
      const y = 6 + rng.next() * (height - 12);
      const delay = fmt(-rng.next() * 0.9, 2);
      sparkles.push(
        `<g transform="${tr(x, y)}"><path class="tw" style="animation-delay:${delay}s" d="M-.75-3.5h1.5v2.75h2.75v1.5h-2.75v2.75h-1.5v-2.75h-2.75v-1.5h2.75z"/></g>`,
      );
    }
    out.push(`<g class="A S H ${vs}" fill="#ffe066">${sparkles.join("")}</g>`);

    // banner
    if (opts.clearText.trim()) {
      const text = textToSprite(opts.clearText);
      const S = 3;
      const tw = text[0].length * S;
      const th = text.length * S;
      const pw = tw + 16;
      const ph = th + 12;
      const vt = sheet.add("vt", [
        [0, "transform:scale(0);opacity:0"],
        [victory.start + 0.1, "transform:scale(0);opacity:0"],
        [victory.start + 0.1, "transform:scale(.2);opacity:1;animation-timing-function:ease-out"],
        [victory.start + 0.3, "transform:scale(1.15);opacity:1"],
        [victory.start + 0.42, "transform:scale(1);opacity:1"],
        [victory.end - 0.3, "transform:scale(1);opacity:1"],
        [victory.end, "transform:scale(.85);opacity:0"],
        [D, "transform:scale(0);opacity:0"],
      ]);
      out.push(
        `<g transform="${tr(cxB, cyB)}"><g class="A H ${vt}">`,
        `<rect x="${n(-pw / 2)}" y="${n(-ph / 2)}" width="${pw}" height="${ph}" rx="4" fill="${t.panel}" stroke="${t.panelBorder}" stroke-width="1.5"/>`,
        `<g shape-rendering="crispEdges">`,
        `<g transform="translate(${n(-tw / 2 + 1.5)},${n(-th / 2 + 1.5)}) scale(${S})">${spriteToSvg(text, { "#": t.textShadow })}</g>`,
        `<g transform="translate(${n(-tw / 2)},${n(-th / 2)}) scale(${S})">${spriteToSvg(text, { "#": t.text })}</g>`,
        `</g></g></g>`,
      );
    }
    return out.join("");
  }
}

/** Layered cross-shaped flame (outer red, orange middle, pale core) for the given arm lengths. */
function flameMarkup(a: BlastArms): string {
  const layers = [
    { color: FLAME.outer, half: 6, tip: 6, cls: "" },
    { color: FLAME.mid, half: 4, tip: 4.5, cls: "fk" },
    { color: FLAME.core, half: 2, tip: 3, cls: "" },
  ];
  const f = (v: number) => fmt(v, 2);
  return layers
    .map((l) => {
      const hx = -(a.left * PITCH + l.tip);
      const hw = (a.left + a.right) * PITCH + 2 * l.tip;
      const vy = -(a.up * PITCH + l.tip);
      const vh = (a.up + a.down) * PITCH + 2 * l.tip;
      const rx = l.half;
      const center = l.half + 2;
      return (
        `<g fill="${l.color}"${l.cls ? ` class="${l.cls}"` : ""}>` +
        `<rect x="${f(hx)}" y="${-l.half}" width="${f(hw)}" height="${l.half * 2}" rx="${rx}"/>` +
        `<rect x="${-l.half}" y="${f(vy)}" width="${l.half * 2}" height="${f(vh)}" rx="${rx}"/>` +
        `<rect x="${-center}" y="${-center}" width="${center * 2}" height="${center * 2}" rx="${Math.min(4, center)}"/></g>`
      );
    })
    .join("");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}
