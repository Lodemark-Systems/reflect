import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function gatherRules(rulesDir) {
  if (!existsSync(rulesDir)) return [];
  const files = readdirSync(rulesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const rules = [];
  for (const file of files) {
    if (rules.length >= 20) break;
    const content = safeRead(join(rulesDir, file));
    if (content) {
      rules.push({
        name: `[project] ${file}`,
        content,
        frontmatter: content.split("\n").slice(0, 5).join("\n"),
      });
    }
  }
  return rules;
}

function extractHooks(workspacePath) {
  const settingsPath = join(workspacePath, ".claude", "settings.json");
  const raw = safeRead(settingsPath);
  if (!raw) return null;
  try {
    const settings = JSON.parse(raw);
    return settings.hooks ? JSON.stringify(settings.hooks) : null;
  } catch {
    return null;
  }
}

export function gather(workspacePath) {
  const projectProfile = safeRead(join(workspacePath, "CLAUDE.md"));
  const rules = gatherRules(join(workspacePath, ".claude", "rules"));
  const settings = safeRead(join(workspacePath, ".claude", "settings.json"));
  const hooks = extractHooks(workspacePath);
  const memoryMd =
    safeRead(join(workspacePath, ".claude", "MEMORY.md")) ||
    safeRead(join(workspacePath, "MEMORY.md"));

  const hasContent = Boolean(projectProfile || rules.length > 0);

  return {
    payload: {
      platform: "code",
      global_profile: null,
      project_profile: projectProfile,
      rules,
      hooks,
      settings,
      memory_md: memoryMd,
      project_config: null,
      previous_results: null,
      behavioral_markers: null,
      cost_config: null,
    },
    stats: {
      hasContent,
      profileLines: projectProfile
        ? projectProfile.split("\n").length
        : 0,
      rulesCount: rules.length,
      totalChars: (projectProfile || "").length +
        rules.reduce((sum, r) => sum + r.content.length, 0),
    },
  };
}
