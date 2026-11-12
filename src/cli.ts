import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type BomberOptions, DEFAULT_OPTIONS, generate } from "./index.js";
import { type DataSource, loadContributions } from "./github/index.js";
import type { ContributionCalendar } from "./github/types.js";
import type { Theme } from "./animation/theme.js";
import { type HeroSpriteSet, validateHeroSprites } from "./animation/sprites.js";

const HELP = `github-bomber — blow up your GitHub contribution graph (animated SVG)

Usage:
  github-bomber --user <name> [--output <file[?options]>]... [options]

Data:
  -u, --user <name>          GitHub user name (env: GITHUB_USER)
      --token <token>        GitHub token for the GraphQL API (env: GITHUB_TOKEN)
      --source <s>           auto | graphql | html | sample   (default: auto)
      --data <file.json>     use a saved calendar instead of fetching
      --save-data <file>     save the fetched calendar as JSON
      --allow-sample-fallback  use sample data if the live data cannot be loaded

Output:
  -o, --output <spec>        file to write, repeatable. Per-file options go in a
                             query string, e.g. "dist/bomber-dark.svg?theme=dark&seed=7"
      --outputs <lines>      newline/comma separated list of output specs (GitHub Action)
                             default: dist/github-bomber.svg and dist/github-bomber-dark.svg?theme=dark

Options (global; also usable per output as ?key=value):
      --theme <light|dark>         colour theme                       (light)
      --seed <value>               random seed                         (bomber)
      --radius <n>                 blast radius in cells               (${DEFAULT_OPTIONS.blastRadius})
      --bombs <n>                  bombs on the field at once          (${DEFAULT_OPTIONS.maxBombs})
      --fuse <ticks>               fuse length in walking steps        (${DEFAULT_OPTIONS.fuseTicks})
      --flame <ticks>              flame duration in walking steps     (${DEFAULT_OPTIONS.flameTicks})
      --step <seconds>             seconds per cell walked             (${DEFAULT_OPTIONS.stepDuration})
      --min-step <seconds>         fastest step when squeezing         (${DEFAULT_OPTIONS.minStepDuration})
      --max-seconds <seconds>      target max gameplay length          (${DEFAULT_OPTIONS.maxGameplaySeconds})
      --clear-text <text>          victory banner, "" to hide          ("${DEFAULT_OPTIONS.clearText}")
      --color-empty <css>          empty cell colour
      --color-levels <a,b,c,d>     grass colours for levels 1-4
      --hero-sprite <file.json>    your own hero pixel art (see examples/hero-sprite.json)
  -q, --quiet                      only print errors
  -h, --help
`;

const OPTION_KEYS: Record<string, (o: Partial<BomberOptions>, v: string) => void> = {
  theme: (o, v) => (o.theme = v),
  seed: (o, v) => (o.seed = v),
  radius: (o, v) => (o.blastRadius = int(v, "radius", 1, 20)),
  bombs: (o, v) => (o.maxBombs = int(v, "bombs", 1, 10)),
  fuse: (o, v) => (o.fuseTicks = int(v, "fuse", 4, 60)),
  flame: (o, v) => (o.flameTicks = int(v, "flame", 1, 20)),
  step: (o, v) => (o.stepDuration = num(v, "step", 0.02, 2)),
  "min-step": (o, v) => (o.minStepDuration = num(v, "min-step", 0.02, 2)),
  "max-seconds": (o, v) => (o.maxGameplaySeconds = num(v, "max-seconds", 5, 600)),
  "clear-text": (o, v) => (o.clearText = v),
  "color-empty": (o, v) => (o.colors = { ...o.colors, empty: v }),
  "hero-sprite": (o, v) => (o.heroSprite = { path: v } as unknown as HeroSpriteSet),
  "color-levels": (o, v) => {
    const parts = v.split(",").map((s) => s.trim());
    if (parts.length !== 4) throw new Error("color-levels needs exactly 4 comma separated colours");
    o.colors = { ...o.colors, levels: parts as Theme["levels"] };
  },
};

function int(v: string, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer in [${min}, ${max}]`);
  return n;
}
function num(v: string, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be a number in [${min}, ${max}]`);
  return n;
}

/** Sprite files are read once at start-up and cached by path. */
const spriteFiles = new Map<string, HeroSpriteSet>();

function heroSpriteFrom(path: string): HeroSpriteSet {
  const set = spriteFiles.get(path);
  if (!set) throw new Error(`hero sprite ${path} was not loaded`);
  return set;
}

export async function loadHeroSprite(path: string): Promise<HeroSpriteSet> {
  let set = spriteFiles.get(path);
  if (!set) {
    try {
      set = JSON.parse(await readFile(path, "utf8")) as HeroSpriteSet;
    } catch (err) {
      throw new Error(`cannot read hero sprite ${path}: ${err instanceof Error ? err.message : err}`);
    }
    validateHeroSprites(set);
    spriteFiles.set(path, set);
  }
  return set;
}

export interface OutputSpec {
  file: string;
  options: Partial<BomberOptions>;
}

/** "dist/x.svg?theme=dark&seed=3" -> { file, options } (snake_case keys are accepted too). */
export function parseOutputSpec(spec: string): OutputSpec {
  const q = spec.indexOf("?");
  const file = (q < 0 ? spec : spec.slice(0, q)).trim();
  if (!file) throw new Error(`invalid output "${spec}"`);
  const options: Partial<BomberOptions> = {};
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(spec.slice(q + 1))) {
      const key = k.replace(/_/g, "-");
      const apply = OPTION_KEYS[key] ?? (key === "palette" ? OPTION_KEYS.theme : undefined);
      if (!apply) throw new Error(`unknown output option "${k}" in "${spec}"`);
      apply(options, key === "palette" ? v.replace(/^github-/, "") : v);
    }
  }
  return { file, options };
}

export interface CliArgs {
  user?: string;
  token?: string;
  source: DataSource;
  data?: string;
  saveData?: string;
  allowSampleFallback: boolean;
  outputs: OutputSpec[];
  options: Partial<BomberOptions>;
  quiet: boolean;
  help: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliArgs {
  const args: CliArgs = {
    user: env.GITHUB_USER || undefined,
    token: env.GITHUB_TOKEN || undefined,
    source: "auto",
    allowSampleFallback: false,
    outputs: [],
    options: {},
    quiet: false,
    help: false,
  };
  const outputSpecs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let value: string | undefined;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) {
      value = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const next = () => {
      if (value !== undefined) return value;
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "-u":
      case "--user":
        args.user = next();
        break;
      case "--token":
        args.token = next();
        break;
      case "--source": {
        const s = next();
        if (!["auto", "graphql", "html", "sample"].includes(s)) throw new Error(`unknown source "${s}"`);
        args.source = s as DataSource;
        break;
      }
      case "--data":
        args.data = next();
        break;
      case "--save-data":
        args.saveData = next();
        break;
      case "--allow-sample-fallback":
        args.allowSampleFallback = true;
        break;
      case "-o":
      case "--output":
        outputSpecs.push(next());
        break;
      case "--outputs":
        outputSpecs.push(...next().split(/[\n,]/));
        break;
      case "-q":
      case "--quiet":
        args.quiet = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default: {
        const key = a.replace(/^--/, "");
        const apply = a.startsWith("--") ? OPTION_KEYS[key] : undefined;
        if (!apply) throw new Error(`unknown argument "${a}" (see --help)`);
        apply(args.options, next());
      }
    }
  }
  const specs = outputSpecs.map((s) => s.trim()).filter(Boolean);
  args.outputs = (specs.length ? specs : ["dist/github-bomber.svg", "dist/github-bomber-dark.svg?theme=dark"]).map(
    parseOutputSpec,
  );
  return args;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const log = (m: string) => {
    if (!args.quiet) console.log(m);
  };

  let cal: ContributionCalendar;
  if (args.data) {
    cal = JSON.parse(await readFile(args.data, "utf8")) as ContributionCalendar;
    log(`Loaded calendar from ${args.data} (${cal.days.length} days).`);
  } else {
    cal = await loadContributions({
      user: args.user,
      token: args.token,
      source: args.source,
      allowSampleFallback: args.allowSampleFallback,
      sampleSeed: args.options.seed,
      log,
    });
  }
  if (args.saveData) {
    await mkdir(dirname(args.saveData), { recursive: true });
    await writeFile(args.saveData, JSON.stringify(cal, null, 1));
  }

  for (const out of args.outputs) {
    const options = { ...args.options, ...out.options };
    const spritePath = (options.heroSprite as { path?: string } | undefined)?.path;
    if (spritePath) {
      await loadHeroSprite(spritePath);
      options.heroSprite = heroSpriteFrom(spritePath);
    }
    const started = Date.now();
    const { svg, plan, model } = generate(cal, options);
    await mkdir(dirname(out.file), { recursive: true });
    await writeFile(out.file, svg);
    const grass = plan.destroyedBy.size;
    log(
      `✔ ${out.file}: ${grass} grass cells, ${plan.bombs.length} bombs, ` +
        `${model.duration.toFixed(1)}s loop, ${(svg.length / 1024).toFixed(1)} KB (${Date.now() - started} ms)`,
    );
  }
}
