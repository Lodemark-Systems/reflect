const MARKER = "<!-- reflect-ci-report -->";

function escapeMd(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([^\]]*)\]\(javascript:/gi, "[$1](blocked:");
}

const HEALTH_BADGE = {
  green: "\u{1F7E2} Green",
  yellow: "\u{1F7E1} Yellow",
  red: "\u{1F534} Red",
};

function formatMetricsTable(response) {
  const gr = response.structural?.gauge_ready;
  if (!gr) return "";

  const rows = [
    ["Health", HEALTH_BADGE[gr.system_health] || gr.system_health],
    ["Weight", `${gr.effective_weight} lines (${gr.source_count} sources)`],
  ];

  if (gr.gates_total > 0) {
    rows.push(["Gates", `${gr.gates_healthy}/${gr.gates_total} healthy`]);
  }
  if (gr.architecture_type) {
    rows.push(["Architecture", gr.architecture_type]);
  }

  rows.push(["Tier", response.tier || "free"]);

  const table =
    "| Metric | Value |\n|--------|-------|\n" +
    rows.map(([k, v]) => `| ${k} | ${v} |`).join("\n");

  return table;
}

function formatFindings(findings) {
  if (!findings?.findings?.length && !findings?.flags?.length) return "";

  let md = "";

  if (findings.findings?.length) {
    md += "\n### Findings\n\n";
    for (const f of findings.findings) {
      md += `> **${escapeMd(f.id)}: ${escapeMd(f.title)}** \`${escapeMd(f.severity)}\`\n`;
      md += `> ${escapeMd(f.summary?.split("\n")[0])}\n\n`;
    }
  }

  if (findings.flags?.length) {
    md += "\n### Flags\n\n";
    for (const f of findings.flags) {
      md += `> **${escapeMd(f.id)}: ${escapeMd(f.title)}** \`${escapeMd(f.severity)}\`\n`;
      md += `> ${escapeMd(f.summary?.split("\n")[0])}\n\n`;
    }
  }

  return md;
}

function formatStrengths(findings) {
  if (!findings?.strengths?.length) return "";

  let md = "\n<details><summary>Strengths</summary>\n\n";
  for (const s of findings.strengths) {
    md += `- **${escapeMd(s.title)}** — ${escapeMd(s.summary?.split("\n")[0])}\n`;
  }
  md += "\n</details>\n";
  return md;
}

function formatCost(cost) {
  if (!cost) return "";

  const tokenWaste = cost.aggregate_token_waste?.monthly;
  const rework = cost.aggregate_rework_impact?.monthly;

  if (tokenWaste == null && rework == null) return "";

  let md = "\n<details><summary>Cost Impact</summary>\n\n";
  if (tokenWaste != null) {
    md += `**Token waste:** $${tokenWaste.toFixed(2)}/mo`;
    if (cost.aggregate_token_waste?.monthly_tokens) {
      md += ` (${cost.aggregate_token_waste.monthly_tokens.toLocaleString()} tokens)`;
    }
    md += "\n";
  }
  if (rework != null) {
    md += `**Rework risk:** $${rework.toFixed(2)}/mo (illustrative)\n`;
  }
  md += "\n</details>\n";
  return md;
}

function formatAnalysis(analysis) {
  if (!analysis) return "";
  return `\n<details><summary>Full Analysis</summary>\n\n${analysis}\n\n</details>\n`;
}

function formatRateLimit(rateLimit) {
  if (!rateLimit) return "";
  return ` | Free (${rateLimit.remaining} runs remaining)`;
}

export function formatComment(response, evaluation) {
  let md = `${MARKER}\n## Reflect CI — Instruction System Analysis\n\n`;

  const metricsTable = formatMetricsTable(response);
  const findings = response.structural?.findings;
  const analysis = response.structural?.analysis;
  const cost = response.cost;
  const rateLimit = response.rate_limit;

  if (metricsTable) {
    md += metricsTable + "\n";
  }

  if (!evaluation.passed) {
    md += `\n> **Check failed:** ${evaluation.reason}\n`;
  }

  if (findings) {
    md += formatFindings(findings);
    md += formatStrengths(findings);
  }

  if (findings && analysis) {
    md += formatAnalysis(analysis);
  } else if (analysis) {
    md += `\n${analysis}\n`;
  }

  md += formatCost(cost);

  md += "\n---\n";
  md += `<sub>Reflect CI by <a href="https://lodemark.dev">Lodemark Systems</a>${formatRateLimit(rateLimit)}</sub>\n`;

  return md;
}

export async function postComment(commentBody, github, context) {
  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) return;

  if (context.payload.pull_request?.head?.repo?.fork) {
    return { skipped: true, reason: "Fork PR — no write permission for comments" };
  }

  const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
  const { owner, repo } = context.repo;

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find((c) => c.body?.includes(MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: commentBody,
    });
    return { updated: true, id: existing.id };
  }

  const { data: created } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: commentBody,
  });
  return { created: true, id: created.id };
}
