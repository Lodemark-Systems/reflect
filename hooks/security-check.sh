#!/usr/bin/env bash
# Reflect — PreToolUse Security Check Hook
# Fires before Write/Edit. Scans proposed content for security anti-patterns.
# Installed by Reflect setup. Mechanical enforcement for Security Defaults gate.

# PreToolUse hooks receive tool_input on stdin as JSON.
# For Write/Edit, the content is in the file_content or new_string field.

INPUT=$(cat)

# Extract the content being written (Write tool uses "content", Edit uses "new_string")
# Uses python3 for reliable JSON parsing instead of fragile regex (L8 security fix)
if command -v python3 >/dev/null 2>&1; then
  CONTENT=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('content', data.get('new_string', '')))
except:
    pass
" 2>/dev/null)
else
  # Fallback to regex if python3 unavailable (fails safe — empty CONTENT skips checks)
  CONTENT=$(echo "$INPUT" | grep -o '"content":\s*"[^"]*"' | head -1 | sed 's/"content":\s*"//;s/"$//')
  if [ -z "$CONTENT" ]; then
    CONTENT=$(echo "$INPUT" | grep -o '"new_string":\s*"[^"]*"' | head -1 | sed 's/"new_string":\s*"//;s/"$//')
  fi
fi

# Skip if no content to check
[ -z "$CONTENT" ] && exit 0

WARNINGS=""

# Check for hardcoded secrets
if echo "$CONTENT" | grep -qiE '(api[_-]?key|secret[_-]?key|password|token)\s*[=:]\s*["\x27][A-Za-z0-9+/=_-]{16,}'; then
  WARNINGS="${WARNINGS}Possible hardcoded secret detected. "
fi

# Check for common API key patterns (including our own rk_ prefix)
if echo "$CONTENT" | grep -qE '(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|xox[bpras]-[a-zA-Z0-9-]+|rk_[a-f0-9]{32,})'; then
  WARNINGS="${WARNINGS}API key pattern detected. "
fi

# Check for .env content being written to non-.env files
FILE="${CLAUDE_TOOL_INPUT_FILE_PATH:-}"
if [ -n "$FILE" ]; then
  case "$FILE" in
    *.env|*.env.*) ;; # .env files are fine
    *)
      if echo "$CONTENT" | grep -qE '^[A-Z_]+=.{8,}$'; then
        WARNINGS="${WARNINGS}Env-style secrets may be in a non-.env file. "
      fi
      ;;
  esac
fi

if [ -n "$WARNINGS" ]; then
  echo "Security check: ${WARNINGS}Review before proceeding."
fi

exit 0
