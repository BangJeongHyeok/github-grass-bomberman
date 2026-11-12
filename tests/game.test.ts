import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBlast } from "../src/game/blast.js";
import { type Grid, cx, cy, grassCells, gridFromAscii, gridFromCalendar, idx, isFloor } from "../src/game/grid.js";
import { planGame, type Plan } from "../src/game/planner.js";
import { boardAt, validatePlan } from "../src/game/validate.js";
import { sampleCalendar, uniformCalendar } from "../src/github/sample.js";

const sorted = (g: Grid, cells: number[]) => cells.map((c) => `${cx(g, c)},${cy(g, c)}`).sort();

describe("blast", () => {
  const g = gridFromAscii([".......", ".......", "...1...", ".......", "......."]);

  it("is a cross of the configured radius", () => {
    const b = computeBlast(g, idx(g, 3, 2), 2);
    assert.deepEqual(sorted(g, b.cells), ["1,2", "2,2", "3,0", "3,1", "3,2", "3,3", "3,4", "4,2", "5,2"].sort());
    assert.deepEqual(b.arms, { up: 2, down: 2, left: 2, right: 2 });
    assert.equal(computeBlast(g, idx(g, 3, 2), 1).cells.length, 5);
    assert.equal(computeBlast(g, idx(g, 3, 2), 3).cells.length, 11);
  });

  it("is clipped by the map edge", () => {
    const b = computeBlast(g, idx(g, 0, 0), 2);
    assert.deepEqual(b.arms, { up: 0, down: 2, left: 0, right: 2 });
    assert.deepEqual(sorted(g, b.cells), ["0,0", "0,1", "0,2", "1,0", "2,0"]);
  });

  it("stops at missing days and passes through grass", () => {
    const h = gridFromAscii(["4.. ..", "4.4.4."]);
    const b = computeBlast(h, idx(h, 1, 0), 3);
    assert.deepEqual(b.arms, { up: 0, down: 1, left: 1, right: 1 }); // void at (3,0) stops the right arm
    const c = computeBlast(h, idx(h, 0, 1), 4);
    assert.deepEqual(c.arms.right, 4); // flame crosses grass cells
  });
});

describe("grid", () => {
  it("keeps the contribution graph shape (7 rows, ~53 columns)", () => {
    const g = gridFromCalendar(sampleCalendar());
    assert.equal(g.height, 7);
    assert.ok(g.width >= 52 && g.width <= 54);
  });
});

function check(plan: Plan) {
  const errors = validatePlan(plan);
  assert.deepEqual(errors, [], errors.join("\n"));
  assert.deepEqual(plan.warnings, []);
  // nothing left at the end
  assert.equal(grassCells(boardAt(plan, plan.endTick)).length, 0);
  // hero never leaves the board
  for (const c of plan.positions) assert.ok(isFloor(plan.grid, cx(plan.grid, c), cy(plan.grid, c)));
}

describe("auto-play planner", () => {
  it("clears realistic calendars of every density", () => {
    for (const density of [0.05, 0.2, 0.45, 0.7, 0.9, 1]) {
      for (const seed of [1, 2, 3]) {
        const plan = planGame(gridFromCalendar(sampleCalendar({ seed: `${density}-${seed}`, density })), { seed });
        check(plan);
      }
    }
  });

  it("handles a completely green graph (worst case)", () => {
    const plan = planGame(gridFromCalendar(uniformCalendar(4)));
    check(plan);
    assert.equal(plan.destroyedBy.size, grassCells(plan.grid).length);
    assert.ok(plan.endTick < 500, `took ${plan.endTick} ticks`);
  });

  it("handles a graph without contributions", () => {
    const plan = planGame(gridFromCalendar(uniformCalendar(0)));
    check(plan);
    assert.equal(plan.bombs.length, 0);
    assert.ok(plan.positions.length > 1, "the hero still walks around");
  });

  it("never wastes a bomb: each one destroys new grass", () => {
    const plan = planGame(gridFromCalendar(sampleCalendar({ seed: 9 })));
    const destroyedPerBomb = new Map<number, number>();
    for (const id of plan.destroyedBy.values()) destroyedPerBomb.set(id, (destroyedPerBomb.get(id) ?? 0) + 1);
    for (const b of plan.bombs) assert.ok((destroyedPerBomb.get(b.id) ?? 0) > 0, `bomb ${b.id} destroys nothing`);
  });

  it("works with different radii, bomb limits and fuses", () => {
    const grid = gridFromCalendar(sampleCalendar({ seed: 4, density: 0.6 }));
    for (const blastRadius of [1, 2, 3, 5]) check(planGame(grid, { blastRadius }));
    for (const maxBombs of [1, 2, 5]) check(planGame(grid, { maxBombs }));
    for (const fuseTicks of [6, 9, 20]) check(planGame(grid, { fuseTicks }));
  });

  it("works on tiny and odd-shaped boards", () => {
    check(planGame(gridFromAscii(["1", "2", "3", "4", ".", "1", "2"]), { blastRadius: 1 }));
    check(planGame(gridFromAscii(["44", "44", "44", "44", "44", "44", "44"])));
    check(planGame(gridFromAscii([" 4..1", " .4..", "..4. ", "4..4 "])));
  });

  it("escapes every blast (explicit safety check)", () => {
    const plan = planGame(gridFromCalendar(sampleCalendar({ seed: 5, density: 0.9 })));
    const o = plan.options;
    for (const b of plan.bombs) {
      for (let t = b.explodeTick - o.dangerMarginTicks; t <= b.explodeTick + o.flameTicks; t++) {
        assert.ok(!b.blast.cells.includes(plan.positions[t]), `hero burnt by bomb ${b.id} at tick ${t}`);
      }
    }
  });

  it("is reproducible for a seed and varies across seeds", () => {
    const grid = gridFromCalendar(sampleCalendar({ seed: 6 }));
    const a = planGame(grid, { seed: "x" });
    const b = planGame(grid, { seed: "x" });
    assert.deepEqual(a.positions, b.positions);
    assert.deepEqual(
      a.bombs.map((x) => x.cell),
      b.bombs.map((x) => x.cell),
    );
    const others = ["y", "z", "w"].map((seed) => planGame(grid, { seed }).positions.join());
    assert.ok(others.some((p) => p !== a.positions.join()), "seed has no effect");
  });

  it("moves at most one cell per tick (no teleporting)", () => {
    const plan = planGame(gridFromCalendar(sampleCalendar({ seed: 7 })));
    const g = plan.grid;
    for (let t = 1; t < plan.positions.length; t++) {
      const a = plan.positions[t - 1];
      const b = plan.positions[t];
      assert.ok(Math.abs(cx(g, a) - cx(g, b)) + Math.abs(cy(g, a) - cy(g, b)) <= 1);
    }
  });

  it("the validator catches broken plans", () => {
    const plan = planGame(gridFromCalendar(sampleCalendar({ seed: 8 })));
    const teleport = { ...plan, positions: [...plan.positions] };
    teleport.positions[5] = idx(plan.grid, plan.grid.width - 1, 3);
    assert.ok(validatePlan(teleport).some((e) => /teleported/.test(e)));
    const burnt = { ...plan, positions: plan.positions.map(() => plan.bombs[0].cell) };
    assert.ok(validatePlan(burnt).some((e) => /inside the blast/.test(e)));
    const unfinished = { ...plan, bombs: plan.bombs.slice(0, -1) };
    assert.ok(validatePlan(unfinished).some((e) => /never destroyed/.test(e)));
  });
});
