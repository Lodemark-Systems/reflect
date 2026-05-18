import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/threshold.mjs";

function makeResponse(health, findings = []) {
  return {
    structural: {
      gauge_ready: health ? { system_health: health } : undefined,
      findings: findings.length ? { findings } : undefined,
    },
  };
}

describe("evaluate", () => {
  describe('fail-on: "red" (default)', () => {
    it("passes on green", () => {
      const r = evaluate(makeResponse("green"), "red");
      assert.equal(r.passed, true);
    });

    it("passes on yellow", () => {
      const r = evaluate(makeResponse("yellow"), "red");
      assert.equal(r.passed, true);
    });

    it("fails on red", () => {
      const r = evaluate(makeResponse("red"), "red");
      assert.equal(r.passed, false);
      assert.ok(r.reason.includes("red"));
    });
  });

  describe('fail-on: "yellow"', () => {
    it("passes on green", () => {
      const r = evaluate(makeResponse("green"), "yellow");
      assert.equal(r.passed, true);
    });

    it("fails on yellow", () => {
      const r = evaluate(makeResponse("yellow"), "yellow");
      assert.equal(r.passed, false);
    });

    it("fails on red", () => {
      const r = evaluate(makeResponse("red"), "yellow");
      assert.equal(r.passed, false);
    });
  });

  describe('fail-on: "high-finding"', () => {
    it("passes with no findings", () => {
      const r = evaluate(makeResponse("green"), "high-finding");
      assert.equal(r.passed, true);
    });

    it("passes with medium findings", () => {
      const r = evaluate(
        makeResponse("green", [{ severity: "medium", title: "Test" }]),
        "high-finding",
      );
      assert.equal(r.passed, true);
    });

    it("fails with high finding", () => {
      const r = evaluate(
        makeResponse("green", [{ severity: "high", title: "Bad Gate" }]),
        "high-finding",
      );
      assert.equal(r.passed, false);
      assert.ok(r.reason.includes("Bad Gate"));
    });

    it("counts multiple high findings", () => {
      const r = evaluate(
        makeResponse("green", [
          { severity: "high", title: "A" },
          { severity: "high", title: "B" },
          { severity: "medium", title: "C" },
        ]),
        "high-finding",
      );
      assert.equal(r.passed, false);
      assert.ok(r.reason.includes("2 high"));
    });
  });

  describe('fail-on: "never"', () => {
    it("always passes regardless of health", () => {
      assert.equal(evaluate(makeResponse("red"), "never").passed, true);
      assert.equal(evaluate(makeResponse("yellow"), "never").passed, true);
      assert.equal(evaluate(makeResponse("green"), "never").passed, true);
    });
  });

  describe("no gauge data (Free tier)", () => {
    it("passes when gauge_ready is absent", () => {
      const r = evaluate(makeResponse(null), "red");
      assert.equal(r.passed, true);
      assert.equal(r.noGauge, true);
    });

    it("passes on yellow mode without gauge", () => {
      const r = evaluate(makeResponse(null), "yellow");
      assert.equal(r.passed, true);
      assert.equal(r.noGauge, true);
    });
  });
});
