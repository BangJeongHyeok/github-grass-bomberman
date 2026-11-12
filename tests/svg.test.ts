import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generate } from "../src/index.js";
import { sampleCalendar, uniformCalendar } from "../src/github/sample.js";
import { DEFAULT_HERO, textToSprite } from "../src/animation/sprites.js";

const sample = generate(sampleCalendar(), {});

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no stray '<'. */
function assertWellFormed(xml: string) {
  const stack: string[] = [];
  const body = xml.replace(/<style>[\s\S]*?<\/style>/, "<style></style>");
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const between = body.slice(last, m.index);
    assert.ok(!between.includes("<"), `malformed markup near: ${between.slice(0, 80)}`);
    last = re.lastIndex;
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
    else stack.push(name);
  }
  assert.ok(!body.slice(last).includes("<"), "trailing markup");
  assert.deepEqual(stack, [], "unclosed tags");
}

describe("timeline", () => {
  const m = sample.model;

  it("follows intro -> play -> victory -> reset -> loop", () => {
    const order = ["board", "hero-appear", "game-start", "bomb-place", "explode", "board-cleared", "victory", "hero-exit", "reset", "loop"];
    const firstIndex = (type: string) => m.events.findIndex((e) => e.type === type);
    for (let i = 1; i < order.length; i++) {
      assert.ok(firstIndex(order[i - 1]) <= firstIndex(order[i]), `${order[i - 1]} before ${order[i]}`);
    }
    for (let i = 1; i < m.events.length; i++) assert.ok(m.events[i - 1].t <= m.events[i].t);
    const lastExplosion = Math.max(...m.explosions.map((e) => e.endAt));
    assert.ok(lastExplosion <= m.victory.start);
    assert.ok(m.regrow.end < m.duration);
  });

  it("keeps hero movement continuous and on the board", () => {
    const keys = m.hero.keys;
    for (let i = 1; i < keys.length; i++) {
      const dt = keys[i].t - keys[i - 1].t;
      const dist = Math.abs(keys[i].x - keys[i - 1].x) + Math.abs(keys[i].y - keys[i - 1].y);
      assert.ok(dt > 0, "time moves forward");
      assert.ok(dist <= dt / m.step + 1e-6, `too fast between keys ${i - 1} and ${i}`);
      assert.ok(keys[i].x >= 0 && keys[i].x < m.grid.width && keys[i].y >= 0 && keys[i].y < 7);
    }
  });

  it("squeezes long games into the configured length", () => {
    const full = generate(uniformCalendar(4), { maxGameplaySeconds: 20 });
    assert.ok(full.model.step < 0.13);
    assert.ok(full.model.step >= 0.08);
    const quick = generate(uniformCalendar(4), { maxGameplaySeconds: 20, minStepDuration: 0.04 });
    assert.ok(quick.model.duration - quick.model.intro.start - (quick.model.duration - quick.model.victory.start) <= 21);
  });
});

describe("SVG output", () => {
  const svg = sample.svg;

  it("is standalone: no scripts, no external resources", () => {
    assert.ok(svg.startsWith("<svg "));
    assert.ok(!/<script/i.test(svg));
    assert.ok(!/\bon\w+=/i.test(svg), "no event handler attributes");
    assert.ok(!/<(image|foreignObject|iframe)/i.test(svg));
    assert.ok(!/url\(/i.test(svg), "no url() references");
    for (const m of svg.matchAll(/href="([^"]*)"/g)) assert.ok(m[1].startsWith("#"), `external href ${m[1]}`);
    const urls = [...svg.matchAll(/https?:\/\/[^"\s)]+/g)].map((m) => m[0]);
    assert.deepEqual([...new Set(urls)], ["http://www.w3.org/2000/svg"]);
  });

  it("is well-formed XML", () => {
    assertWellFormed(svg);
    assertWellFormed(generate(uniformCalendar(0)).svg);
  });

  it("references only defined ids and keyframes", () => {
    const ids = new Set([...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of svg.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `missing #${m[1]}`);
    const keyframes = new Set([...svg.matchAll(/@keyframes (\w+)/g)].map((m) => m[1]));
    for (const m of svg.matchAll(/animation-name:(\w+)/g)) assert.ok(keyframes.has(m[1]), `missing @keyframes ${m[1]}`);
    for (const m of svg.matchAll(/animation:(\w+) /g)) assert.ok(keyframes.has(m[1]), `missing @keyframes ${m[1]}`);
  });

  it("loops forever with one shared duration", () => {
    assert.match(svg, new RegExp(`\\.A\\{animation-duration:${sample.model.duration}s;animation-iteration-count:infinite`));
    for (const m of svg.matchAll(/animation:\w+ [\d.]+s [^;}]*/g)) assert.match(m[0], /infinite/);
  });

  it("uses monotonic keyframe percentages within 0..100", () => {
    for (const [, name, body] of svg.matchAll(/@keyframes (\w+)\{(.*?\})\}/g)) {
      const pcts = [...body.matchAll(/(?:^|\})([\d.]+)%(?:,[\d.]+%)?\{/g)].map((m) => Number(m[1]));
      for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] > pcts[i - 1], `${name}: ${pcts[i - 1]} -> ${pcts[i]}`);
      for (const p of pcts) assert.ok(p >= 0 && p <= 100, `${name}: ${p}%`);
    }
  });

  it("negative animation delays stay within one loop", () => {
    for (const m of svg.matchAll(/animation-delay:(-?[\d.]+)s/g)) {
      const d = Number(m[1]);
      assert.ok(d <= 0 && d >= -sample.model.duration - 1, `delay ${d}`);
    }
  });

  it("draws every board cell, grass cell, bomb and explosion", () => {
    const g = sample.plan.grid;
    const floor = [...g.cells].filter((c) => c >= 0).length;
    const grass = [...g.cells].filter((c) => c > 0).length;
    assert.equal((svg.match(/<use href="#e"/g) ?? []).length, floor);
    assert.equal((svg.match(/<rect class="L\d/g) ?? []).length, grass);
    assert.equal((svg.match(/<use href="#B"/g) ?? []).length, sample.plan.bombs.length);
    assert.equal((svg.match(/<use href="#f\d{4}"/g) ?? []).length, sample.plan.bombs.length);
  });

  it("stays small, even for a fully green year", () => {
    assert.ok(svg.length < 200 * 1024, `${svg.length} bytes`);
    const worst = generate(uniformCalendar(4)).svg;
    assert.ok(worst.length < 250 * 1024, `${worst.length} bytes`);
  });

  it("supports light and dark themes and custom colours", () => {
    const dark = generate(sampleCalendar(), { theme: "dark" }).svg;
    assert.match(dark, /#161b22/);
    assert.match(dark, /#39d353/);
    assert.match(svg, /#ebedf0/);
    const custom = generate(sampleCalendar(), { colors: { levels: ["#111111", "#222222", "#333333", "#444444"] } }).svg;
    assert.match(custom, /\.L4\{fill:#444444\}/);
    assert.throws(() => generate(sampleCalendar(), { theme: "neon" }), /Unknown theme/);
  });

  it("is deterministic", () => {
    assert.equal(generate(sampleCalendar(), {}).svg, svg);
  });

  it("escapes the title and renders custom banner text", () => {
    const out = generate({ ...sampleCalendar(), user: `<a&"b>` }, { clearText: "GG!" }).svg;
    assert.match(out, /&lt;a&amp;&quot;b&gt;/);
    assert.equal(textToSprite("GG!")[0].length, 5 + 1 + 5 + 1 + 1);
    assert.ok(!/@keyframes vt/.test(generate(sampleCalendar(), { clearText: "" }).svg));
  });

  it("accepts custom hero pixel art and rejects broken art", () => {
    const blob = ["..xx..", ".xxxx.", "xxxxxx", ".x..x."];
    const custom = { down: [blob, blob, blob], up: [blob, blob, blob], left: [blob, blob, blob], victory: blob, colors: { x: "#ff00ff" } };
    const out = generate(sampleCalendar(), { heroSprite: custom }).svg;
    assert.match(out, /#ff00ff/);
    assert.ok(!out.includes(DEFAULT_HERO.colors.R), "built-in hero not drawn");
    assert.throws(() => generate(sampleCalendar(), { heroSprite: { ...custom, colors: {} } }), /no colour for "x"/);
    assert.throws(() => generate(sampleCalendar(), { heroSprite: { ...custom, up: [blob] } }), /exactly 3 frames/);
    assert.throws(
      () => generate(sampleCalendar(), { heroSprite: { ...custom, victory: ["..x..", "....."] } }),
      /rows|characters/,
    );
    assert.throws(
      () => generate(sampleCalendar(), { heroSprite: { ...custom, colors: { x: "red;}<script>" } } }),
      /invalid colour/,
    );
  });
});
