/**
 * Render an animated SVG in headless Chromium at chosen moments.
 *
 *   npm run preview -- examples/sample.svg --frames 0,2,5.5 --out .tmp/frames
 *   npm run preview -- examples/sample.svg --gif examples/preview.gif --fps 10
 *   npm run preview -- examples/sample.svg --sheet examples/timeline.png --frames 0,3,10,20
 *   npm run preview -- examples/sample.svg --img-check   (does it animate inside an <img>?)
 *
 * Needs Playwright with Chromium (`npx playwright install chromium`).
 * Time is controlled through the Web Animations API, so frames are exact.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc as unknown as {
  GIFEncoder: () => {
    writeFrame(index: Uint8Array, w: number, h: number, o: { palette: number[][]; delay: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  quantize: (rgba: Uint8Array, n: number) => number[][];
  applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array;
};

interface Args {
  svg: string;
  frames: number[];
  out: string;
  gif?: string;
  sheet?: string;
  fps: number;
  from?: number;
  to?: number;
  scale: number;
  background?: string;
  imgCheck: boolean;
}

function parse(argv: string[]): Args {
  const a: Args = { svg: "", frames: [], out: ".tmp/frames", fps: 10, scale: 1, imgCheck: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--frames") a.frames = v().split(",").map(Number);
    else if (k === "--out") a.out = v();
    else if (k === "--gif") a.gif = v();
    else if (k === "--sheet") a.sheet = v();
    else if (k === "--fps") a.fps = Number(v());
    else if (k === "--from") a.from = Number(v());
    else if (k === "--to") a.to = Number(v());
    else if (k === "--scale") a.scale = Number(v());
    else if (k === "--background") a.background = v();
    else if (k === "--img-check") a.imgCheck = true;
    else a.svg = k;
  }
  if (!a.svg) throw new Error("usage: preview <file.svg> [--frames t,..] [--gif out.gif] [--sheet out.png]");
  return a;
}

async function loadChromium() {
  try {
    return createRequire(import.meta.url)("playwright").chromium;
  } catch {
    throw new Error("Playwright is required: npm install && npx playwright install chromium");
  }
}

async function main() {
  const args = parse(process.argv.slice(2));
  const svgPath = resolve(args.svg);
  const svgText = await readFile(svgPath, "utf8");
  const duration = Number(/animation-duration:([\d.]+)s/.exec(svgText)?.[1] ?? "0");
  const bg = args.background ?? (/dark/.test(svgPath) ? "#0d1117" : "#ffffff");
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: args.scale });

  if (args.imgCheck) {
    // Real <img> embedding, like GitHub's README renderer: animations must run on their own.
    await page.setContent(`<body style="margin:0;background:${bg}"><img id="i" src="data:image/svg+xml;base64,${Buffer.from(svgText).toString("base64")}"></body>`);
    await page.waitForTimeout(600);
    const shots: Buffer[] = [];
    for (let i = 0; i < 4; i++) {
      shots.push(await page.locator("#i").screenshot());
      await page.waitForTimeout(1500);
    }
    const distinct = new Set(shots.map((b) => b.toString("base64"))).size;
    console.log(`<img> check: ${distinct}/${shots.length} distinct frames over ${(shots.length - 1) * 1.5}s`);
    await browser.close();
    if (distinct < 2) process.exitCode = 1;
    return;
  }

  await page.goto(pathToFileURL(svgPath).href);
  await page.evaluate((c: string) => {
    (document.documentElement as unknown as HTMLElement).style.background = c;
  }, bg);
  const seek = async (t: number) => {
    await page.evaluate((ms: number) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = ms;
      }
    }, t * 1000);
  };
  const shot = async () => PNG.sync.read(await page.locator("svg").screenshot({ omitBackground: false }));

  let times = args.frames;
  if (args.gif) {
    const from = args.from ?? 0;
    const to = args.to ?? duration;
    times = [];
    for (let t = from; t < to; t += 1 / args.fps) times.push(Math.round(t * 1000) / 1000);
  }
  if (times.length === 0) times = [0, duration * 0.1, duration * 0.3, duration * 0.6, duration * 0.9];

  const frames: PNG[] = [];
  for (const t of times) {
    await seek(t);
    frames.push(await shot());
  }
  await browser.close();

  if (args.gif) {
    const gif = GIFEncoder();
    const delay = Math.round(1000 / args.fps);
    for (const f of frames) {
      const rgba = new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.length);
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), f.width, f.height, { palette, delay });
    }
    gif.finish();
    await mkdir(dirname(args.gif), { recursive: true });
    await writeFile(args.gif, gif.bytes());
    // Optional: a shared palette + frame diffs shrink the GIF ~6x when ffmpeg is available.
    const tmp = `${args.gif}.tmp.gif`;
    const ff = spawnSync("ffmpeg", [
      "-loglevel", "error", "-y", "-i", args.gif, "-vf",
      "split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
      tmp,
    ]);
    if (ff.status === 0) await writeFile(args.gif, await readFile(tmp));
    await import("node:fs/promises").then((fs) => fs.rm(tmp, { force: true }));
    const size = (await readFile(args.gif)).length;
    console.log(`wrote ${args.gif} (${frames.length} frames, ${(size / 1024).toFixed(0)} KB${ff.status === 0 ? ", ffmpeg-optimized" : ""})`);
  } else if (args.sheet) {
    const w = frames[0].width;
    const h = frames[0].height;
    const sheet = new PNG({ width: w, height: h * frames.length });
    frames.forEach((f, i) => PNG.bitblt(f, sheet, 0, 0, w, h, 0, i * h));
    await mkdir(dirname(args.sheet), { recursive: true });
    await writeFile(args.sheet, PNG.sync.write(sheet));
    console.log(`wrote ${args.sheet} (${times.map((t) => `${t}s`).join(", ")})`);
  } else {
    await mkdir(args.out, { recursive: true });
    for (let i = 0; i < frames.length; i++) {
      const file = join(args.out, `frame-${String(times[i]).padStart(6, "0")}.png`);
      await writeFile(file, PNG.sync.write(frames[i]));
      console.log(`wrote ${file}`);
    }
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
