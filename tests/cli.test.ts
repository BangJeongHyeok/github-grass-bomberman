import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main, parseArgs, parseOutputSpec } from "../src/cli.js";

describe("CLI", () => {
  it("parses output specs with per-file options", () => {
    assert.deepEqual(parseOutputSpec("dist/a.svg"), { file: "dist/a.svg", options: {} });
    assert.deepEqual(parseOutputSpec("dist/b.svg?theme=dark&seed=7&radius=3&max_seconds=30"), {
      file: "dist/b.svg",
      options: { theme: "dark", seed: "7", blastRadius: 3, maxGameplaySeconds: 30 },
    });
    assert.deepEqual(parseOutputSpec("x.svg?palette=github-dark").options, { theme: "dark" });
    assert.throws(() => parseOutputSpec("x.svg?bogus=1"), /unknown output option/);
    assert.throws(() => parseOutputSpec("x.svg?radius=0"), /radius/);
  });

  it("reads the user and token from the environment and defaults to light + dark outputs", () => {
    const a = parseArgs([], { GITHUB_USER: "octo", GITHUB_TOKEN: "tok" });
    assert.equal(a.user, "octo");
    assert.equal(a.token, "tok");
    assert.deepEqual(
      a.outputs.map((o) => o.file),
      ["dist/github-bomber.svg", "dist/github-bomber-dark.svg"],
    );
    assert.equal(a.outputs[1].options.theme, "dark");
  });

  it("accepts multi-line outputs (GitHub Action input) and global options", () => {
    const a = parseArgs(["--outputs", "a.svg\n  b.svg?theme=dark\n\n", "--seed=42", "--bombs", "2", "-u", "me"], {});
    assert.deepEqual(a.outputs.map((o) => o.file), ["a.svg", "b.svg"]);
    assert.equal(a.options.seed, "42");
    assert.equal(a.options.maxBombs, 2);
    assert.equal(a.user, "me");
    assert.throws(() => parseArgs(["--nope"], {}), /unknown argument/);
    assert.throws(() => parseArgs(["--source", "ftp"], {}), /unknown source/);
  });

  it("generates files end to end from sample data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bomber-"));
    try {
      const data = join(dir, "data.json");
      await main(["--source", "sample", "-q", "--save-data", data, "-o", join(dir, "l.svg"), "-o", `${join(dir, "d.svg")}?theme=dark`]);
      const light = await readFile(join(dir, "l.svg"), "utf8");
      const dark = await readFile(join(dir, "d.svg"), "utf8");
      assert.match(light, /^<svg /);
      assert.match(dark, /#161b22/);
      // a custom hero from a JSON file (the bundled template)
      await main(["--source", "sample", "-q", "--hero-sprite", "examples/hero-sprite.json", "-o", join(dir, "h.svg")]);
      assert.equal(await readFile(join(dir, "h.svg"), "utf8"), light);
      // the saved calendar reproduces the same animation
      await main(["--data", data, "-q", "-o", join(dir, "again.svg")]);
      assert.equal(await readFile(join(dir, "again.svg"), "utf8"), light);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
