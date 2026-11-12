/**
 * Renders the SVG in a real browser engine (Chromium via Playwright) and checks
 * what is actually on screen at specific moments of the loop. Skipped when
 * Playwright/Chromium is not installed.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { generate } from "../src/index.js";
import { sampleCalendar } from "../src/github/sample.js";

interface Snapshot {
  grass: { x: number; y: number; on: boolean }[];
  bombs: number;
  flames: number;
  hero: { visible: boolean; x: number; y: number };
  inside: boolean;
  banner: boolean;
}
type Page = {
  setContent(html: string): Promise<void>;
  evaluate(fn: (src: string) => Snapshot, arg: string): Promise<Snapshot>;
};

const IN_PAGE = `function (ms) {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    let o = 1;
    for (let e = el; e && e.tagName !== "svg"; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return r.width > 1 && o > 0.5;
  };
  const box = document.querySelector("svg").getBoundingClientRect();
  const grass = [...document.querySelectorAll("rect[class^=L]")].map((r) => ({
    x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), on: visible(r),
  }));
  const hero = document.querySelector(".hj");
  const h = hero.getBoundingClientRect();
  const banner = document.querySelector(".vt");
  return {
    grass,
    bombs: [...document.querySelectorAll('use[href="#B"]')].filter(visible).length,
    flames: [...document.querySelectorAll('use[href^="#f"]')].filter(visible).length,
    hero: { visible: visible(hero), x: h.x + h.width / 2, y: h.y + h.height / 2 },
    inside: h.x >= box.x - 1 && h.right <= box.right + 1 && h.bottom <= box.bottom + 1,
    banner: banner ? visible(banner) : false,
  };
}`;
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

function loadChromium(): { launch(): Promise<Browser> } | null {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright").chromium;
  } catch {
    return null;
  }
}

const chromium = loadChromium();
const { svg, model } = generate(sampleCalendar(), {});

describe("browser rendering", { skip: chromium ? false : "playwright not installed" }, () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium!.launch();
    page = await browser.newPage();
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
  });
  after(async () => browser?.close());

  /**
   * Seek every animation to `t` seconds and report what is visible. The in-page
   * code is a plain string so the TypeScript loader cannot inject helpers into it.
   */
  const snapshot = (t: number) => page.evaluate((src: string) => (0, eval)(src), `(${IN_PAGE})(${t * 1000})`);

  it("starts with the full contribution graph and nothing else", async () => {
    const s = await snapshot(0);
    assert.ok(s.grass.length > 0);
    assert.ok(s.grass.every((g) => g.on), "all grass visible");
    assert.equal(s.bombs, 0);
    assert.equal(s.flames, 0);
    assert.equal(s.hero.visible, false);
  });

  it("shows the hero after the intro, inside the board", async () => {
    for (let t = model.intro.land; t < model.victory.start; t += 0.37) {
      const s = await snapshot(t);
      assert.ok(s.hero.visible, `hero hidden at ${t}`);
      assert.ok(s.inside, `hero outside the image at ${t.toFixed(2)}s`);
    }
  });

  it("removes grass exactly when its explosion happens", async () => {
    for (const e of model.explosions.filter((_, i) => i % 7 === 0)) {
      const before = await snapshot(e.at - 0.05);
      const afterwards = await snapshot(e.at + 0.3);
      const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
      const destroyed = new Set(e.destroyed.map((c) => key({ x: 14 + c.x * 16, y: 30 + c.y * 16 })));
      for (const g of before.grass) if (destroyed.has(key(g))) assert.ok(g.on, "grass present before the blast");
      for (const g of afterwards.grass) if (destroyed.has(key(g))) assert.ok(!g.on, "grass gone after the blast");
      assert.ok(afterwards.flames >= 1, "flame visible");
    }
  });

  it("shows bombs while their fuse burns", async () => {
    const b = model.bombs[3];
    assert.ok((await snapshot((b.placeAt + b.explodeAt) / 2)).bombs >= 1);
  });

  it("clears the whole board, celebrates, then restores it before looping", async () => {
    const won = await snapshot(model.victory.start + 0.6);
    assert.ok(won.grass.every((g) => !g.on), "board cleared");
    assert.ok(won.banner, "victory banner");
    assert.equal(won.bombs, 0);
    const end = await snapshot(model.duration - 0.05);
    assert.ok(end.grass.every((g) => g.on), "graph restored at loop end");
    assert.equal(end.hero.visible, false);
    assert.equal(end.banner, false);
  });
});
