# Reflect

**Instruction system governance for AI-powered development.**

Reflect diagnoses hidden compliance failures in your Claude Code instruction system — rules that compete with each other, gates that pass without enforcing, instructions that look right but don't reliably fire. Built on 5,500+ data points of empirical compliance research.

## Install

```bash
npx @lodemark-systems/reflect
```

One command. Installs skills to `~/.claude/skills/`, sets up a boot hook, and creates a local cache at `~/.reflect/`. No OAuth, no connectors, no manual file management.

Requires Node.js 18+ and an active [Claude Code](https://docs.anthropic.com/en/docs/claude-code) environment.

## Quick Start

Open any Claude Code session and type:

```
/reflect
```

Reflect gathers your instruction architecture (global and project CLAUDE.md, rules files, hooks, memory), sends it to the cloud engine for analysis, and returns numbered edit proposals. You review each one and approve or skip — nothing writes without your confirmation.

### First Time?

```
/reflect setup
```

Deploys a starter instruction scaffold designed around the failure patterns Reflect detects — a working foundation that's already structured to avoid the most common compliance issues.

## What You Get

| Skill | What it does | Tier |
|-------|-------------|------|
| `/reflect` | Structural diagnosis with edit proposals | Free (5 runs/mo) |
| `/ponder` | Behavioral compliance analysis | Pro |
| `/gauge` | System dashboard — snapshot from /reflect and /ponder results | Pro |

**Free** gives you structural analysis, a starter scaffold, and up to 5 diagnostic runs per month. Free tier proposals are conservative by design — recommendations require structural evidence and stay scoped to tensions, dead weight, ambiguity, and deduplication. Enforcement-level changes (channel restructuring, hook promotion) require the behavioral data that Pro provides.

**Pro** adds behavioral analysis, empirical compliance scoring, cost attribution per finding, delta tracking across runs, and unlimited usage. $100/month ($50 founding member rate).

## How It Works

1. **Gather** — the packager collects your instruction files (CLAUDE.md, rules, hooks, settings)
2. **Analyze** — the cloud engine evaluates your instruction system for compliance issues
3. **Propose** — you receive numbered, scoped edit proposals with explanations
4. **Review** — you approve, skip, or modify each proposal before it writes

Recommendations are diagnostic signals, not guarantees of improvement. Reflect sees instruction *structure* — weight, placement, tensions, channel alignment — but your behavioral context (how your team actually uses the system, which gates matter most, what your workflow demands) is information only you have. The tool proposes; your judgment decides.

Your instruction files stay local. The cloud engine receives a structured payload for analysis and returns findings — raw conversations and project code are never transmitted.

## Customize

Customize cost parameters for your environment:

```
/reflect config
```

Set your token price, hourly rate, daily interaction count, and rework time estimates to align cost projections with your actual rates and usage patterns.

## Requirements

- Node.js 18+
- Claude Code CLI (active session)
- Internet connection (cloud analysis)

## Links

- [Lodemark Systems](https://lodemark.dev)
- [Apache 2.0 License](./LICENSE)

## Disclaimer

This software is provided "as-is" under the Apache License 2.0, without warranties or conditions of any kind. Reflect provides structural diagnostic analysis and recommendations for AI instruction systems — recommendations are signals for human review, not guaranteed compliance improvements. Instruction behavior depends on context that only the user can evaluate. All edit proposals require human review and approval before application. See [LICENSE](./LICENSE) for full terms.

---

Built by [Lodemark Systems](https://lodemark.dev). *Find the lode. Mark it for others.*
