import * as core from "@actions/core";
import * as github from "@actions/github";
import { gather } from "./gather.mjs";
import { analyze, AuthError, RateLimitError, ApiError } from "./api.mjs";
import { evaluate } from "./threshold.mjs";
import { formatComment, postComment } from "./comment.mjs";

async function run() {
  const apiKey = core.getInput("api-key") || "";
  const apiUrl = core.getInput("api-url") || "https://api.lodemark.dev";
  const failOn = core.getInput("fail-on") || "red";
  const shouldComment = core.getInput("comment") !== "false";

  if (apiKey) {
    core.setSecret(apiKey);
  }

  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.warning("Reflect CI only runs on pull_request events. Skipping.");
    return;
  }

  core.info(`Reflect CI analyzing PR #${pr.number}...`);

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const { payload, stats } = gather(workspace);

  if (!stats.hasContent) {
    core.warning(
      "No instruction files found (CLAUDE.md or .claude/rules/*.md). Nothing to analyze.",
    );
    core.setOutput("passed", "true");
    return;
  }

  core.info(
    `Gathered: ${stats.profileLines} profile lines, ${stats.rulesCount} rule files, ${stats.totalChars} total chars`,
  );

  let response;
  try {
    response = await analyze(payload, apiKey, apiUrl);
  } catch (err) {
    if (err instanceof AuthError) {
      core.setFailed(
        `Authentication failed: ${err.message}. Check your REFLECT_API_KEY secret.`,
      );
      return;
    }
    if (err instanceof RateLimitError) {
      core.warning(`Rate limited: ${err.message}`);
      core.setOutput("passed", "true");
      return;
    }
    if (err instanceof ApiError) {
      core.setFailed(`API error (${err.status}): ${err.message}`);
      return;
    }
    throw err;
  }

  core.info(`Analysis complete — tier: ${response.tier}, status: ${response.status}`);

  const evaluation = evaluate(response, failOn);
  const gr = response.structural?.gauge_ready;

  core.setOutput("system-health", gr?.system_health || "unknown");
  core.setOutput("effective-weight", String(gr?.effective_weight || 0));
  core.setOutput(
    "finding-count",
    String(response.structural?.findings?.findings?.length || 0),
  );
  core.setOutput("tier", response.tier || "free");
  core.setOutput("passed", String(evaluation.passed));

  if (shouldComment) {
    try {
      const commentBody = formatComment(response, evaluation);
      const result = await postComment(commentBody, github, github.context);
      if (result?.skipped) {
        core.info(`Comment skipped: ${result.reason}`);
      } else if (result?.updated) {
        core.info(`Updated existing PR comment (id: ${result.id})`);
      } else if (result?.created) {
        core.info(`Posted PR comment (id: ${result.id})`);
      }
    } catch (err) {
      core.warning(`Failed to post PR comment: ${err.message}`);
    }
  }

  if (evaluation.noGauge) {
    core.warning(evaluation.reason);
  }

  if (!evaluation.passed) {
    core.setFailed(evaluation.reason);
  } else {
    core.info(`Check passed: ${evaluation.reason}`);
  }
}

run().catch((err) => {
  core.setFailed(`Unexpected error: ${err.message}`);
});
