#!/usr/bin/env bash
# Reflect — PostToolUse Testing Reminder Hook
# Fires after Write/Edit on code files. Reminds to run tests.
# Installed by Reflect setup. Mechanical enforcement for Testing Triggers gate.

# The hook receives the tool result on stdin. We only need the file path
# from the tool_input, which is passed as arguments by Claude Code.
# PostToolUse hooks fire with: tool_name, file_path (for Write/Edit)

FILE="${CLAUDE_TOOL_INPUT_FILE_PATH:-}"

# Skip if no file path (non-file tool call)
[ -z "$FILE" ] && exit 0

# Only fire on code files
case "$FILE" in
  *.js|*.ts|*.mjs|*.cjs|*.jsx|*.tsx|*.py|*.rs|*.go|*.java|*.rb|*.php|*.swift|*.kt|*.c|*.cpp|*.h|*.cs)
    ;;
  *)
    exit 0
    ;;
esac

# Read test command from quality gates if available
TEST_CMD=""
for gates_file in ".claude/rules/quality-gates.md" ".claude/rules/reflect-gates.md" "$HOME/.claude/rules/quality-gates.md" "$HOME/.claude/rules/reflect-gates.md"; do
  if [ -f "$gates_file" ]; then
    # Extract test command from "**Test command:** `...`" line
    # Strip control characters to prevent terminal escape injection from malicious repos (M3 security fix)
    CMD=$(grep -o '`[^`]*`' "$gates_file" | head -1 | tr -d '`' | tr -d '\000-\037\177')
    if [ -n "$CMD" ] && [ "$CMD" != "[detected or placeholder]" ] && [ "$CMD" != "[add your test command here]" ]; then
      TEST_CMD="$CMD"
      break
    fi
  fi
done

if [ -n "$TEST_CMD" ]; then
  echo "Testing gate: code modified. Run: $TEST_CMD"
else
  echo "Testing gate: code modified. Add your test command to quality-gates.md."
fi
