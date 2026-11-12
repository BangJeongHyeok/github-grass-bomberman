/** A keyframe stop: time in seconds and the CSS declarations at that moment. */
export type Stop = [time: number, css: string];

const EPS = 0.001; // percent

/**
 * Collects @keyframes rules that all share one global loop duration, so every
 * element stays in sync on each repetition.
 */
export class KeyframeSheet {
  private rules: string[] = [];
  private names = new Set<string>();

  constructor(readonly duration: number) {}

  /** Percentage of the loop for a time in seconds (clamped). */
  pct(t: number): number {
    return Math.min(100, Math.max(0, (t / this.duration) * 100));
  }

  /**
   * Add `@keyframes name`. Stops are sorted; stops that land on the same
   * percentage are nudged apart by 0.001% so instant jumps stay instant.
   * Returns the name for use in class lists.
   */
  add(name: string, stops: Stop[]): string {
    if (this.names.has(name)) throw new Error(`duplicate keyframes ${name}`);
    this.names.add(name);
    const sorted = stops
      .map(([t, css], i) => ({ p: this.pct(t), css, i }))
      .sort((a, b) => a.p - b.p || a.i - b.i);
    let prev = -1;
    const parts: string[] = [];
    for (const s of sorted) {
      let p = Math.round(s.p * 1000) / 1000;
      if (p <= prev) p = Math.round((prev + EPS) * 1000) / 1000;
      if (p > 100) continue; // nothing can happen after the end of the loop
      prev = p;
      parts.push(`${fmt(p)}%{${s.css}}`);
    }
    this.rules.push(`@keyframes ${name}{${parts.join("")}}.${name}{animation-name:${name}}`);
    return name;
  }

  css(): string {
    return this.rules.join("\n");
  }
}

/** Compact number formatting: at most 3 decimals, no trailing zeros, no leading zero. */
export function fmt(n: number, decimals = 3): string {
  const f = 10 ** decimals;
  let s = String(Math.round(n * f) / f);
  if (s.startsWith("0.")) s = s.slice(1);
  else if (s.startsWith("-0.")) s = `-${s.slice(2)}`;
  return s === "-0" ? "0" : s;
}
