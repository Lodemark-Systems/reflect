import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gather } from "../src/gather.mjs";

const TMP = join(tmpdir(), "reflect-ci-test-" + Date.now());

function setupFixture(structure) {
  rmSync(TMP, { recursive: true, force: true });
  for (const [path, content] of Object.entries(structure)) {
    const full = join(TMP, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
}

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("gather", () => {
  it("reads CLAUDE.md as project_profile", () => {
    setupFixture({ "CLAUDE.md": "# My Project\nBe concise." });
    const { payload, stats } = gather(TMP);

    assert.equal(payload.platform, "code");
    assert.equal(payload.project_profile, "# My Project\nBe concise.");
    assert.equal(stats.hasContent, true);
    assert.equal(stats.profileLines, 2);
  });

  it("reads .claude/rules/*.md as rules", () => {
    setupFixture({
      "CLAUDE.md": "# Test",
      ".claude/rules/style.md": "# Style\nUse tabs.",
      ".claude/rules/testing.md": "# Testing\nWrite tests.",
      ".claude/rules/readme.txt": "not a rule",
    });
    const { payload } = gather(TMP);

    assert.equal(payload.rules.length, 2);
    assert.equal(payload.rules[0].name, "[project] style.md");
    assert.equal(payload.rules[0].content, "# Style\nUse tabs.");
    assert.equal(payload.rules[0].frontmatter, "# Style\nUse tabs.");
  });

  it("caps rules at 20", () => {
    const structure = { "CLAUDE.md": "# Test" };
    for (let i = 0; i < 25; i++) {
      structure[`.claude/rules/rule-${String(i).padStart(2, "0")}.md`] = `# Rule ${i}`;
    }
    setupFixture(structure);
    const { payload } = gather(TMP);

    assert.equal(payload.rules.length, 20);
  });

  it("extracts hooks from settings.json", () => {
    setupFixture({
      "CLAUDE.md": "# Test",
      ".claude/settings.json": JSON.stringify({
        hooks: { "pre-commit": { command: "npm test" } },
        other: "stuff",
      }),
    });
    const { payload } = gather(TMP);

    assert.equal(payload.hooks, '{"pre-commit":{"command":"npm test"}}');
    assert.ok(payload.settings.includes('"hooks"'));
  });

  it("reads .claude/MEMORY.md with fallback to root", () => {
    setupFixture({
      "CLAUDE.md": "# Test",
      ".claude/MEMORY.md": "# Memory in .claude",
    });
    const { payload } = gather(TMP);
    assert.equal(payload.memory_md, "# Memory in .claude");

    setupFixture({
      "CLAUDE.md": "# Test",
      "MEMORY.md": "# Memory at root",
    });
    const { payload: p2 } = gather(TMP);
    assert.equal(p2.memory_md, "# Memory at root");
  });

  it("returns hasContent=false when no instruction files", () => {
    setupFixture({ "README.md": "# Not an instruction file" });
    const { stats } = gather(TMP);

    assert.equal(stats.hasContent, false);
    assert.equal(stats.profileLines, 0);
    assert.equal(stats.rulesCount, 0);
  });

  it("sets CI-irrelevant fields to null", () => {
    setupFixture({ "CLAUDE.md": "# Test" });
    const { payload } = gather(TMP);

    assert.equal(payload.global_profile, null);
    assert.equal(payload.previous_results, null);
    assert.equal(payload.behavioral_markers, null);
    assert.equal(payload.cost_config, null);
    assert.equal(payload.project_config, null);
  });
});
