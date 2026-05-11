#!/usr/bin/env node

/**
 * Reflect Installer — Lodemark Systems
 *
 * Installs /reflect and /gauge skills into Claude Code's global skill directory.
 * Adds a SessionStart hook for boot signal injection.
 * Merges settings.json non-destructively.
 *
 * Usage: npx @lodemark-systems/reflect
 *
 * Requirements from live manual setup (Mar 16):
 *  - No Finder navigation — everything CLI
 *  - settings.json merge, not overwrite
 *  - os.homedir() for path resolution (not $HOME)
 *  - Explicit permissions (0o755 for hooks)
 *  - Programmatic file writes (no shell gymnastics)
 *  - < 30 seconds target
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, chmodSync, lstatSync, openSync, writeSync, closeSync, fchmodSync, constants } from "fs";
import { resolve, dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Configuration ---

const HOME = homedir();
const CLAUDE_DIR = resolve(HOME, ".claude");
const SKILLS_DIR = resolve(CLAUDE_DIR, "skills");
const HOOKS_DIR = resolve(CLAUDE_DIR, "hooks");
const SETTINGS_PATH = resolve(CLAUDE_DIR, "settings.json");
const REFLECT_CACHE_DIR = resolve(HOME, ".reflect", "cache");
const REFLECT_BIN_DIR = resolve(HOME, ".reflect", "bin");

const SKILLS = [
  { name: "reflect", files: ["SKILL.md"] },
  { name: "ponder", files: ["SKILL.md"] },
  { name: "gauge", files: ["SKILL.md"] },
];

// --- Color helpers (no dependencies) ---

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// --- State Detection ---

function detectExistingInstall() {
  const reflectSkill = resolve(SKILLS_DIR, "reflect", "SKILL.md");
  const gaugeSkill = resolve(SKILLS_DIR, "gauge", "SKILL.md");
  const hookFile = resolve(HOOKS_DIR, "reflect-boot.mjs");

  return {
    hasReflect: existsSync(reflectSkill),
    hasGauge: existsSync(gaugeSkill),
    hasHook: existsSync(hookFile),
    hasSettings: existsSync(SETTINGS_PATH),
    isUpgrade: existsSync(reflectSkill) || existsSync(gaugeSkill),
  };
}

// --- Skill Installation ---

/**
 * Check if a path is a symlink (without following it).
 * Returns false if the path doesn't exist.
 */
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// M35: Atomic symlink-safe write. O_NOFOLLOW causes ELOOP if path is a symlink,
// eliminating the TOCTOU gap between isSymlink() check and write.
function safeWriteFile(filePath, content, mode = 0o644) {
  let fd;
  try {
    fd = openSync(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, mode);
  } catch (err) {
    if (err.code === "ELOOP") {
      throw new Error(`Refusing to write through symlink: ${filePath}`);
    }
    throw err;
  }
  try {
    writeSync(fd, content);
    fchmodSync(fd, mode);
  } finally {
    closeSync(fd);
  }
}

function safeCopyFile(src, dest, mode = 0o644) {
  const content = readFileSync(src);
  safeWriteFile(dest, content, mode);
}

// M36: Backup existing file if it differs from what we're about to write.
function backupIfDifferent(dest, newContent) {
  if (!existsSync(dest)) return null;
  try {
    const existing = readFileSync(dest);
    const incoming = typeof newContent === "string" ? Buffer.from(newContent, "utf-8") : newContent;
    if (!existing.equals(incoming)) {
      const backupPath = dest + ".bak." + Date.now();
      copyFileSync(dest, backupPath);
      return backupPath;
    }
  } catch {
    // Can't read existing file — proceed without backup
  }
  return null;
}

function installSkills() {
  let installed = 0;
  const skipped = [];

  for (const skill of SKILLS) {
    const targetDir = resolve(SKILLS_DIR, skill.name);

    // SAFETY: If the target directory is a symlink, refuse to write through it.
    // Writing through a symlink can clobber files in the link target — for
    // example a user with ~/.claude/skills/reflect symlinked to ~/dotfiles/...
    // would have their dotfiles overwritten without warning.
    if (isSymlink(targetDir)) {
      skipped.push({ skill: skill.name, reason: "directory is a symlink", path: targetDir });
      continue;
    }

    mkdirSync(targetDir, { recursive: true });

    for (const file of skill.files) {
      const src = resolve(__dirname, "skills", skill.name, file);
      const dest = resolve(targetDir, file);

      if (!existsSync(src)) {
        console.error(`  ${yellow("WARN")} Source file not found: ${src}`);
        continue;
      }

      if (isSymlink(dest)) {
        skipped.push({ skill: skill.name, reason: "file is a symlink", path: dest });
        continue;
      }

      try {
        const backup = backupIfDifferent(dest, readFileSync(src));
        if (backup) {
          console.log(`\n  ${yellow("BACKUP")} ${skill.name}/${file} → ${dim(backup)}`);
        }
        safeCopyFile(src, dest);
        installed++;
      } catch (err) {
        skipped.push({ skill: skill.name, reason: err.message, path: dest });
      }
    }
  }

  // Report skipped files clearly — these are not silent failures.
  if (skipped.length > 0) {
    console.log();
    console.log(`  ${yellow("WARN")} Skipped ${skipped.length} file(s):`);
    for (const item of skipped) {
      console.log(`    ${dim("•")} ${item.skill}: ${item.reason}`);
      console.log(`      ${dim(item.path)}`);
    }
    console.log();
    console.log(`  ${dim("If you intentionally manage these paths (e.g., dotfiles, sync), resolve")}`);
    console.log(`  ${dim("the symlinks manually and re-run the installer to update.")}`);
  }

  return installed;
}

// --- Hook Installation ---

function createBootHook() {
  const hookPath = resolve(HOOKS_DIR, "reflect-boot.mjs");

  // SAFETY: Refuse to write through symlinks (same hazard as installSkills).
  if (isSymlink(HOOKS_DIR)) {
    console.error(`  ${yellow("WARN")} Hook directory is a symlink — skipping boot hook installation.`);
    console.error(`    ${dim(HOOKS_DIR)}`);
    return null;
  }
  if (isSymlink(hookPath)) {
    console.error(`  ${yellow("WARN")} Boot hook is a symlink — skipping installation.`);
    console.error(`    ${dim(hookPath)}`);
    return null;
  }

  mkdirSync(HOOKS_DIR, { recursive: true });

  const hookContent = `#!/usr/bin/env node

/**
 * Reflect — SessionStart Boot Hook
 *
 * Silent in established projects. Nudges only when actionable:
 * - No instruction system detected → scaffold prompt
 * - Otherwise → silent (user knows the tool is there)
 *
 * V1.1: drift detection, update prompts.
 */

const hasInstructionSystem = await (async () => {
  const { existsSync } = await import("fs");
  const { resolve } = await import("path");
  const { homedir } = await import("os");
  const cwd = process.cwd();
  const home = homedir();
  // Check project-level OR global-level instruction system
  return existsSync(resolve(cwd, "CLAUDE.md")) ||
    existsSync(resolve(cwd, ".claude", "CLAUDE.md")) ||
    existsSync(resolve(cwd, ".claude", "rules", "quality-gates.md")) ||
    existsSync(resolve(cwd, ".claude", "rules", "reflect-gates.md")) ||
    existsSync(resolve(home, ".claude", "CLAUDE.md")) ||
    existsSync(resolve(home, ".claude", "rules", "quality-gates.md")) ||
    existsSync(resolve(home, ".claude", "rules", "reflect-gates.md"));
})();

if (!hasInstructionSystem) {
  console.log("--- Reflect (installed) ---");
  console.log("No instruction system found. Run /reflect to set one up.");
  console.log("---");
}
`;

  const backup = backupIfDifferent(hookPath, hookContent);
  if (backup) {
    console.log(`\n  ${yellow("BACKUP")} reflect-boot.mjs → ${dim(backup)}`);
  }
  safeWriteFile(hookPath, hookContent, 0o755);

  return hookPath;
}

// --- Enforcement Hook Installation ---

function installEnforcementHooks() {
  const hooks = [
    { name: "test-reminder.sh", src: resolve(__dirname, "hooks", "test-reminder.sh") },
    { name: "security-check.sh", src: resolve(__dirname, "hooks", "security-check.sh") },
    { name: "path-check.sh", src: resolve(__dirname, "hooks", "path-check.sh") },
  ];

  let installed = 0;

  for (const hook of hooks) {
    if (!existsSync(hook.src)) continue;

    const dest = resolve(HOOKS_DIR, hook.name);

    if (isSymlink(dest)) {
      console.error(`  ${yellow("WARN")} ${hook.name} is a symlink — skipping.`);
      continue;
    }

    mkdirSync(HOOKS_DIR, { recursive: true });
    const backup = backupIfDifferent(dest, readFileSync(hook.src));
    if (backup) {
      console.log(`\n  ${yellow("BACKUP")} ${hook.name} → ${dim(backup)}`);
    }
    safeCopyFile(hook.src, dest, 0o755);
    installed++;
  }

  return installed;
}

// --- Settings.json Merge ---

function mergeSettings(hookPath) {
  let settings = {};

  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } catch (e) {
      console.error(`  ${yellow("WARN")} Could not parse existing settings.json, creating backup`);
      const backupPath = SETTINGS_PATH + ".bak." + Date.now();
      copyFileSync(SETTINGS_PATH, backupPath);
      console.error(`  ${dim("Backup saved to: " + backupPath)}`);
      settings = {};
    }
  }

  // Ensure hooks structure exists
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

  // Boot hook (SessionStart)
  const reflectHookEntry = {
    matcher: "startup|resume",
    hooks: [
      {
        type: "command",
        command: hookPath,
      },
    ],
  };

  const alreadyRegistered = settings.hooks.SessionStart.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("reflect-boot"))
  );

  if (!alreadyRegistered) {
    settings.hooks.SessionStart.push(reflectHookEntry);
  }

  // Testing hook (PostToolUse — Write/Edit on code files)
  const testHookPath = resolve(HOOKS_DIR, "test-reminder.sh");
  const testHookRegistered = settings.hooks.PostToolUse.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("test-reminder"))
  );

  if (!testHookRegistered && existsSync(testHookPath)) {
    settings.hooks.PostToolUse.push({
      matcher: "Write|Edit",
      hooks: [{ type: "command", command: testHookPath }],
    });
  }

  // Security hook (PreToolUse — Write/Edit)
  const secHookPath = resolve(HOOKS_DIR, "security-check.sh");
  const secHookRegistered = settings.hooks.PreToolUse.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("security-check"))
  );

  if (!secHookRegistered && existsSync(secHookPath)) {
    settings.hooks.PreToolUse.push({
      matcher: "Write|Edit",
      hooks: [{ type: "command", command: secHookPath }],
    });
  }

  // Path validation hook (PreToolUse — Write/Edit) — pen-test C3
  const pathHookPath = resolve(HOOKS_DIR, "path-check.sh");
  const pathHookRegistered = settings.hooks.PreToolUse.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("path-check"))
  );

  if (!pathHookRegistered && existsSync(pathHookPath)) {
    settings.hooks.PreToolUse.push({
      matcher: "Write|Edit",
      hooks: [{ type: "command", command: pathHookPath }],
    });
  }

  safeWriteFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

  return !alreadyRegistered;
}

// --- Cache Directory ---

function ensureCacheDir() {
  mkdirSync(REFLECT_CACHE_DIR, { recursive: true });
}

// --- Analyze Script Installation ---

function installAnalyzeScript() {
  const src = resolve(__dirname, "bin", "analyze.sh");

  if (!existsSync(src)) {
    console.error(`  ${yellow("WARN")} analyze.sh not found in package — skipping script install.`);
    return false;
  }

  // SAFETY: Refuse to write through symlinks
  if (isSymlink(REFLECT_BIN_DIR)) {
    console.error(`  ${yellow("WARN")} ~/.reflect/bin is a symlink — skipping script install.`);
    return false;
  }

  mkdirSync(REFLECT_BIN_DIR, { recursive: true });

  const dest = resolve(REFLECT_BIN_DIR, "analyze.sh");

  if (isSymlink(dest)) {
    console.error(`  ${yellow("WARN")} analyze.sh is a symlink — skipping script install.`);
    return false;
  }

  const backup = backupIfDifferent(dest, readFileSync(src));
  if (backup) {
    console.log(`\n  ${yellow("BACKUP")} analyze.sh → ${dim(backup)}`);
  }
  safeCopyFile(src, dest, 0o755);
  return true;
}

// --- Project-Level Conflict Check ---

function checkProjectConflicts() {
  const projectSkillDir = resolve(process.cwd(), ".claude", "skills", "reflect");
  if (existsSync(projectSkillDir)) {
    return true;
  }
  return false;
}

// --- Main ---

async function main() {
  console.log();
  console.log(bold("  Reflect — Instruction System Diagnostics"));
  console.log(dim("  Lodemark Systems"));
  console.log();

  const state = detectExistingInstall();

  if (state.isUpgrade) {
    console.log(`  ${yellow("Existing installation detected — upgrading.")}`);
    console.log();
  }

  // Step 1: Install skills
  process.stdout.write("  Installing skills...");
  const filesInstalled = installSkills();
  console.log(` ${green("done")} (${filesInstalled} files)`);

  // Step 2: Create boot hook
  process.stdout.write("  Creating boot hook...");
  const hookPath = createBootHook();
  if (hookPath) {
    console.log(` ${green("done")}`);
  } else {
    console.log(` ${yellow("skipped")}`);
  }

  // Step 3: Merge settings.json (only if hook was installed)
  if (hookPath) {
    process.stdout.write("  Configuring settings.json...");
    const hookAdded = mergeSettings(hookPath);
    console.log(` ${green("done")}${hookAdded ? "" : " (already configured)"}`);
  }

  // Step 4: Cache directory
  process.stdout.write("  Creating cache directory...");
  ensureCacheDir();
  console.log(` ${green("done")}`);

  // Step 5: Analyze script
  process.stdout.write("  Installing analyze script...");
  const scriptInstalled = installAnalyzeScript();
  console.log(scriptInstalled ? ` ${green("done")}` : ` ${yellow("skipped")}`);

  // Step 6: Enforcement hooks
  process.stdout.write("  Installing enforcement hooks...");
  const hooksInstalled = installEnforcementHooks();
  console.log(` ${green("done")} (${hooksInstalled} hooks)`);

  // Step 7: Check for project-level conflicts
  const hasConflict = checkProjectConflicts();
  if (hasConflict) {
    console.log();
    console.log(`  ${yellow("NOTE:")} This project has a local .claude/skills/reflect/ directory.`);
    console.log(`  Local skills take precedence over global ones.`);
    console.log(`  Remove the local copy if you want to use the installed version.`);
  }

  // Exit message — primary discovery mechanism
  console.log();
  console.log(bold("  Installed successfully."));
  console.log();
  console.log("  What was installed:");
  console.log(`    ${dim("Skills:")}   /reflect (structural) + /ponder (behavioral) + /gauge (dashboard)`);
  console.log(`    ${dim("Hook:")}     Boot signal on session start`);
  console.log(`    ${dim("Location:")} ${SKILLS_DIR}/`);
  console.log();
  console.log(bold("  Next steps:"));
  console.log(`    1. Start a new Claude Code session in any project`);
  console.log(`    2. Type ${bold("/reflect")} to diagnose your instruction system`);
  console.log(`    3. Review the suggestions and apply what fits`);
  console.log();
  console.log(`  ${dim("/ponder and /gauge require a Pro subscription — visit lodemark.dev for details.")}`);
  console.log();
}

main().catch((err) => {
  console.error();
  console.error(`  ${bold("Installation failed:")}`);
  console.error(`  ${err.message}`);
  console.error();
  console.error(`  If this persists, report at: https://github.com/lodemark-systems/reflect/issues`);
  console.error();
  process.exit(1);
});
