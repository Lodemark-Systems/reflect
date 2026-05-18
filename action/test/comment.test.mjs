import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { formatComment } from "../src/comment.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const proResponse = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-response-pro.json"), "utf-8"),
);
const freeResponse = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-response-free.json"), "utf-8"),
);

describe("formatComment", () => {
  describe("Pro tier", () => {
    it("includes the HTML marker", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("<!-- reflect-ci-report -->"));
    });

    it("includes health badge", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("Green"));
    });

    it("includes metrics table", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("| Weight |"));
      assert.ok(md.includes("2 lines"));
      assert.ok(md.includes("2 sources"));
      assert.ok(md.includes("single-layer"));
    });

    it("includes findings", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("Instructional Dilution"));
      assert.ok(md.includes("`medium`"));
    });

    it("includes flags", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("Default Behavior Overlap"));
    });

    it("includes strengths in collapsible", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("<details><summary>Strengths"));
      assert.ok(md.includes("Clean Weight Budget"));
    });

    it("includes cost data in collapsible", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("Cost Impact"));
      assert.ok(md.includes("$0.16"));
      assert.ok(md.includes("$702.00"));
    });

    it("includes analysis in collapsible", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("<details><summary>Full Analysis"));
    });

    it("shows failure reason when check fails", () => {
      const md = formatComment(proResponse, {
        passed: false,
        reason: "System health is red",
      });
      assert.ok(md.includes("**Check failed:**"));
      assert.ok(md.includes("System health is red"));
    });

    it("includes Lodemark footer", () => {
      const md = formatComment(proResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("Lodemark Systems"));
    });
  });

  describe("Free tier", () => {
    it("shows prose analysis as main body", () => {
      const md = formatComment(freeResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("minimal coverage"));
      assert.ok(!md.includes("<details><summary>Full Analysis"));
    });

    it("shows remaining runs", () => {
      const md = formatComment(freeResponse, { passed: true, reason: "ok" });
      assert.ok(md.includes("3 runs remaining"));
    });

    it("does not include findings table", () => {
      const md = formatComment(freeResponse, { passed: true, reason: "ok" });
      assert.ok(!md.includes("### Findings"));
    });

    it("does not include cost section", () => {
      const md = formatComment(freeResponse, { passed: true, reason: "ok" });
      assert.ok(!md.includes("Cost Impact"));
    });

    it("does not include metrics table without gauge_ready", () => {
      const md = formatComment(freeResponse, { passed: true, reason: "ok" });
      assert.ok(!md.includes("| Health |"));
    });
  });
});
