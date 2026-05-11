#!/usr/bin/env bash
# Reflect — PreToolUse Path Validation Hook (C3)
# Fires before Write/Edit. Validates that resolved path is within
# expected directories. Blocks and announces writes to unexpected locations.
#
# Expected write targets for Reflect:
#   ~/.reflect/          — cache, config, api-key
#   ~/.claude/           — CLAUDE.md, rules, hooks (via user approval)
#   $PROJECT_DIR/        — project CLAUDE.md, project rules
#   /tmp/ or $TMPDIR     — temporary files (payload, response)
#
# SECURITY (pen-test C3, Apr 19): A compromised extraction config or
# injected SKILL.md instruction could direct writes to arbitrary paths.
# This hook is the mechanical enforcement layer — SKILL.md rules are
# defense-in-depth behind this check.

INPUT=$(cat)

# Extract file_path from tool input (Write uses "file_path", Edit uses "file_path")
if command -v python3 >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('file_path', ''))
except:
    pass
" 2>/dev/null)
else
  # Fallback — extract file_path with grep
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":\s*"[^"]*"' | head -1 | sed 's/"file_path":\s*"//;s/"$//')
fi

# Skip if no file path
[ -z "$FILE_PATH" ] && exit 0

# Resolve to absolute path (follow symlinks, normalize ..)
RESOLVED=""
if command -v realpath >/dev/null 2>&1; then
  # realpath -m: don't require the file to exist yet (Write creates new files)
  RESOLVED=$(realpath -m "$FILE_PATH" 2>/dev/null) || RESOLVED=""
elif command -v python3 >/dev/null 2>&1; then
  RESOLVED=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$FILE_PATH" 2>/dev/null) || RESOLVED=""
fi

# SECURITY (M-NEW-10, May 6): fail closed if path resolution unavailable.
# Raw paths can bypass prefix checks via traversal (e.g. ~/.claude/../../etc/passwd).
if [ -z "$RESOLVED" ]; then
  echo "BLOCKED: Cannot resolve path (neither realpath nor python3 available). Failing closed."
  exit 2
fi

# --- Allowed directories ---
REFLECT_DIR="$HOME/.reflect"
CLAUDE_DIR="$HOME/.claude"
TMPDIR_RESOLVED="${TMPDIR:-/tmp}"

# Check against allowed prefixes
allowed=false

case "$RESOLVED" in
  "$REFLECT_DIR"/*|"$REFLECT_DIR")
    allowed=true ;;
  "$CLAUDE_DIR"/*|"$CLAUDE_DIR")
    allowed=true ;;
  /tmp/*|/tmp)
    allowed=true ;;
  "$TMPDIR_RESOLVED"/*|"$TMPDIR_RESOLVED")
    allowed=true ;;
esac

# Allow writes within the current working directory (project scope)
if [ "$allowed" = false ]; then
  CWD=$(pwd)
  case "$RESOLVED" in
    "$CWD"/*|"$CWD")
      allowed=true ;;
  esac
fi

# Allow writes within the project directory if CLAUDE_PROJECT_DIR is set
if [ "$allowed" = false ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  case "$RESOLVED" in
    "$CLAUDE_PROJECT_DIR"/*|"$CLAUDE_PROJECT_DIR")
      allowed=true ;;
  esac
fi

if [ "$allowed" = false ]; then
  echo "BLOCKED: Reflect path check — write target is outside expected directories."
  echo "  Path: $RESOLVED"
  echo "  Allowed: ~/.reflect/, ~/.claude/, project directory, /tmp/"
  echo "  If this is intentional, the user can approve the write manually."
  exit 2
fi

exit 0
