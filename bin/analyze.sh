#!/usr/bin/env bash
# Reflect — Mechanical API layer
# Lodemark Systems
#
# Deterministic curl + SSE parsing. Replaces SKILL.md curl templates
# to eliminate LLM reconstruction failures (auth drops, quoting bugs,
# SSE parse errors, shape-matched shortcuts).
#
# Usage:
#   analyze.sh <payload-file> [response-file]     POST /v1/analyze (streaming + SSE parse)
#   analyze.sh config [response-file]              GET  /v1/extraction-config
#
# Exit:  0=success  1=auth error  2=rate limited  3=server error  4=parse error
#
# Reads API key from $REFLECT_API_KEY or ~/.reflect/api-key
# Auth warnings printed to stderr (visible in Claude's bash output)

set -euo pipefail
umask 077

BASE_URL="https://api.lodemark.dev"

# --- API key (env var takes precedence over file) ---

API_KEY=""
if [ -n "${REFLECT_API_KEY:-}" ]; then
  API_KEY="$REFLECT_API_KEY"
elif [ -f "$HOME/.reflect/api-key" ]; then
  API_KEY="$(head -n1 "$HOME/.reflect/api-key" 2>/dev/null)" || API_KEY=""
fi

# --- Auth config file (keeps API key out of process list — L3 security fix) ---

AUTH_CONFIG=""
if [ -n "$API_KEY" ]; then
  AUTH_CONFIG=$(mktemp "${TMPDIR:-/tmp}/reflect-auth.XXXXXX")
  printf 'header = "Authorization: Bearer %s"\n' "$API_KEY" > "$AUTH_CONFIG"
  chmod 600 "$AUTH_CONFIG"
fi

# Global cleanup trap for auth config
cleanup_global() { [ -n "$AUTH_CONFIG" ] && rm -f "$AUTH_CONFIG"; }
trap cleanup_global EXIT

# Helper: validate HTTP_CODE is numeric (L5 security fix)
validate_http_code() {
  [[ "${1:-}" =~ ^[0-9]+$ ]] && echo "$1" || echo "0"
}

# ============================================================
# Subcommand: config — GET /v1/extraction-config
# ============================================================

cmd_config() {
  local RESPONSE="${1:-${HOME}/.reflect/cache/reflect-extraction-config.json}"

  # Symlink check on response path (M2 security fix)
  [ -L "$RESPONSE" ] && { echo "Error: $RESPONSE is a symlink" >&2; exit 4; }

  local HTTP_CODE
  if [ -n "$AUTH_CONFIG" ]; then
    HTTP_CODE=$(curl -s --max-time 30 -K "$AUTH_CONFIG" \
      -o "$RESPONSE" -w "%{http_code}" \
      "$BASE_URL/v1/extraction-config" 2>/dev/null) || HTTP_CODE=""
  else
    HTTP_CODE=$(curl -s --max-time 30 \
      -o "$RESPONSE" -w "%{http_code}" \
      "$BASE_URL/v1/extraction-config" 2>/dev/null) || HTTP_CODE=""
  fi

  HTTP_CODE=$(validate_http_code "$HTTP_CODE")

  case "$HTTP_CODE" in
    2*) ;;
    *)
      echo "HTTP:${HTTP_CODE:-no_response}" >&2
      exit 3 ;;
  esac

  # --- C2 validation: reject responses containing dangerous patterns ---
  # Extraction config is a server-controlled instruction payload. A compromised
  # server could inject tool calls, code execution, or credential exfiltration.
  # Mechanical validation catches this before the model sees the config.
  if [ -f "$RESPONSE" ]; then
    if python3 - "$RESPONSE" <<'PYEOF'
import json, sys, re

with open(sys.argv[1]) as f:
    raw = f.read()

# Must be valid JSON
try:
    data = json.loads(raw)
except (json.JSONDecodeError, ValueError):
    print("REJECT: invalid JSON", file=sys.stderr)
    sys.exit(1)

# Must have expected structure
if "version" not in data:
    print("REJECT: missing version field", file=sys.stderr)
    sys.exit(1)
if "patterns" not in data or not isinstance(data["patterns"], list):
    print("REJECT: missing or invalid patterns array", file=sys.stderr)
    sys.exit(1)
if "marker_format" not in data or not isinstance(data["marker_format"], dict):
    print("REJECT: missing or invalid marker_format", file=sys.stderr)
    sys.exit(1)

# Version must be recognized
KNOWN_VERSIONS = ["1.0"]
if data["version"] not in KNOWN_VERSIONS:
    print(f"REJECT: unrecognized version {data['version']}", file=sys.stderr)
    sys.exit(1)

# Scan full text for dangerous patterns.
# NOTE: Only execution-oriented patterns here. Credential keywords (token,
# api_key, etc.) are intentionally excluded — they appear in legitimate
# natural-language extraction guidance and would false-positive reject
# our own config. Exfiltration instructions require execution patterns
# (curl, eval, tool calls) that these rules already catch.
DANGEROUS = [
    r'\b(Bash|Read|Write|Edit|Glob|Grep)\s*\(',   # tool call syntax
    r'\b(eval|exec|subprocess|os\.system)\b',       # code execution
    r'\b(import\s+os|require\s*\(|__import__)\b',   # module imports
    r'\b(cat|head|tail)\s+[~/]',                     # file read commands
    r'`[^`]{10,}`',                                  # embedded code blocks
    r'curl\s',                                       # curl commands
]

for pattern in DANGEROUS:
    if re.search(pattern, raw, re.IGNORECASE):
        print(f"REJECT: dangerous pattern in config: {pattern}", file=sys.stderr)
        sys.exit(1)

sys.exit(0)
PYEOF
    then
      echo "HTTP:$HTTP_CODE"
      exit 0
    else
      echo "REJECT: extraction config failed validation" >&2
      rm -f "$RESPONSE"
      exit 4
    fi
  fi
}

# ============================================================
# Subcommand: analyze — POST /v1/analyze (default)
# ============================================================

cmd_analyze() {
  local PAYLOAD="${1:-}"
  local RESPONSE="${2:-${HOME}/.reflect/cache/reflect-response.json}"

  # Use mktemp for intermediate files (M2 security fix — unpredictable paths)
  local HEADERS
  HEADERS=$(mktemp "${TMPDIR:-/tmp}/reflect-headers.XXXXXX")
  local STREAM
  STREAM=$(mktemp "${TMPDIR:-/tmp}/reflect-stream.XXXXXX")

  # Local cleanup for intermediate files
  cleanup_local() { rm -f "$STREAM" "$HEADERS"; }

  # --- Validate ---

  if [ -z "$PAYLOAD" ] || [ ! -f "$PAYLOAD" ]; then
    echo "Error: payload file required" >&2
    echo "Usage: analyze.sh <payload-file> [response-file]" >&2
    cleanup_local
    exit 4
  fi

  # Symlink check on ALL write targets (M2 security fix)
  [ -L "$RESPONSE" ] && { echo "Error: $RESPONSE is a symlink" >&2; cleanup_local; exit 4; }

  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required but not found" >&2
    cleanup_local
    exit 4
  fi

  # --- Streaming request ---
  # Two branches: authenticated vs unauthenticated.
  # Auth via config file (-K) keeps API key out of process list.

  local HTTP_CODE
  if [ -n "$AUTH_CONFIG" ]; then
    HTTP_CODE=$(curl -s -N --max-time 300 -K "$AUTH_CONFIG" \
      -o "$STREAM" -D "$HEADERS" -w "%{http_code}" \
      -X POST "$BASE_URL/v1/analyze" \
      -H "Content-Type: application/json" \
      -H "Accept: text/event-stream" \
      -d "@$PAYLOAD" 2>/dev/null) || HTTP_CODE=""
  else
    HTTP_CODE=$(curl -s -N --max-time 300 \
      -o "$STREAM" -D "$HEADERS" -w "%{http_code}" \
      -X POST "$BASE_URL/v1/analyze" \
      -H "Content-Type: application/json" \
      -H "Accept: text/event-stream" \
      -d "@$PAYLOAD" 2>/dev/null) || HTTP_CODE=""
  fi

  HTTP_CODE=$(validate_http_code "$HTTP_CODE")

  # --- HTTP status ---

  case "$HTTP_CODE" in
    2*) ;; # Success — continue to parse
    401|403)
      echo '{"error":"auth_error","http_code":'"$HTTP_CODE"'}' > "$RESPONSE"
      cleanup_local; exit 1 ;;
    422|400)
      # Validation error — preserve server response body for Claude to display
      cp "$STREAM" "$RESPONSE" 2>/dev/null \
        || echo '{"error":"validation_error","http_code":'"$HTTP_CODE"'}' > "$RESPONSE"
      cleanup_local; exit 3 ;;
    429)
      cp "$STREAM" "$RESPONSE" 2>/dev/null \
        || echo '{"error":"rate_limited"}' > "$RESPONSE"
      cleanup_local; exit 2 ;;
    5*)
      echo '{"error":"server_error","http_code":'"$HTTP_CODE"'}' > "$RESPONSE"
      cleanup_local; exit 3 ;;
    *)
      # Preserve server response body when possible (may contain error details)
      cp "$STREAM" "$RESPONSE" 2>/dev/null \
        || echo '{"error":"request_failed","http_code":"'"$HTTP_CODE"'"}' > "$RESPONSE"
      cleanup_local; exit 3 ;;
  esac

  # --- Parse SSE stream ---
  # Reflect SSE format:
  #   event: text\ndata: {"text":"chunk"}\n\n       (live text chunks)
  #   event: complete\ndata: {full JSON}\n\n         (final structured response)
  #   event: error\ndata: {"code":"...","message":"..."}\n\n

  python3 - "$STREAM" <<'PYEOF' > "$RESPONSE"
import json, sys

with open(sys.argv[1]) as f:
    raw = f.read()

blocks = raw.split("\n\n")
complete_data = None
text_chunks = []

for block in blocks:
    lines = block.strip().split("\n")
    event_type = None
    data_str = None
    for line in lines:
        if line.startswith("event: "):
            event_type = line[7:].strip()
        elif line.startswith("data: "):
            data_str = line[6:]
    if not data_str:
        continue
    try:
        data = json.loads(data_str)
    except json.JSONDecodeError:
        continue
    if event_type == "complete":
        complete_data = data
    elif event_type == "text":
        text_chunks.append(data.get("text", ""))
    elif event_type == "error":
        complete_data = {"error": data}

if complete_data:
    print(json.dumps(complete_data, indent=2))
elif not text_chunks:
    try:
        print(json.dumps(json.loads(raw), indent=2))
    except:
        print(json.dumps({"error": "parse_failed", "raw_length": len(raw)}))
else:
    print(json.dumps({"analysis": "".join(text_chunks)}))
PYEOF

  # --- Fallback: if SSE parse failed, retry as buffered JSON ---

  if grep -q '"parse_failed"' "$RESPONSE" 2>/dev/null; then
    if [ -n "$AUTH_CONFIG" ]; then
      HTTP_CODE=$(curl -s --max-time 120 -K "$AUTH_CONFIG" \
        -o "$STREAM" -D "$HEADERS" -w "%{http_code}" \
        -X POST "$BASE_URL/v1/analyze" \
        -H "Content-Type: application/json" \
        -d "@$PAYLOAD" 2>/dev/null) || HTTP_CODE=""
    else
      HTTP_CODE=$(curl -s --max-time 120 \
        -o "$STREAM" -D "$HEADERS" -w "%{http_code}" \
        -X POST "$BASE_URL/v1/analyze" \
        -H "Content-Type: application/json" \
        -d "@$PAYLOAD" 2>/dev/null) || HTTP_CODE=""
    fi

    HTTP_CODE=$(validate_http_code "$HTTP_CODE")

    case "$HTTP_CODE" in
      2*)
        if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$STREAM" 2>/dev/null; then
          cp "$STREAM" "$RESPONSE"
        else
          echo '{"error":"parse_failed","message":"Streaming and buffered both failed"}' > "$RESPONSE"
          cleanup_local; exit 4
        fi ;;
      *)
        echo '{"error":"request_failed","http_code":"'"$HTTP_CODE"'","retry":"buffered"}' > "$RESPONSE"
        cleanup_local; exit 3 ;;
    esac
  fi

  # --- Auth warnings to stderr (Claude sees these in bash output) ---

  if grep -qi "^x-auth-warning:" "$HEADERS" 2>/dev/null; then
    grep -i "^x-auth-warning:" "$HEADERS" >&2
  fi

  # --- Cleanup intermediate files (L4 — headers + stream) ---

  cleanup_local

  exit 0
}

# ============================================================
# Subcommand: gauge — POST /v1/gauge
# ============================================================

cmd_gauge() {
  local PAYLOAD="${1:-}"
  local RESPONSE="${2:-${HOME}/.reflect/cache/gauge-response.json}"

  if [ -z "$PAYLOAD" ] || [ ! -f "$PAYLOAD" ]; then
    echo "Error: gauge payload file required" >&2
    echo "Usage: analyze.sh gauge <payload-file> [response-file]" >&2
    exit 4
  fi

  # Symlink check on response path
  [ -L "$RESPONSE" ] && { echo "Error: $RESPONSE is a symlink" >&2; exit 4; }

  # Auth required for gauge (Pro-only)
  if [ -z "$AUTH_CONFIG" ]; then
    echo "Error: gauge requires authentication. Set REFLECT_API_KEY or create ~/.reflect/api-key" >&2
    exit 1
  fi

  local HTTP_CODE
  HTTP_CODE=$(curl -s --max-time 60 -K "$AUTH_CONFIG" \
    -o "$RESPONSE" -w "%{http_code}" \
    -X POST "$BASE_URL/v1/gauge" \
    -H "Content-Type: application/json" \
    -d "@$PAYLOAD" 2>/dev/null) || HTTP_CODE=""

  HTTP_CODE=$(validate_http_code "$HTTP_CODE")

  case "$HTTP_CODE" in
    2*) echo "HTTP:$HTTP_CODE"; exit 0 ;;
    401|403)
      echo '{"error":"auth_error","http_code":'"$HTTP_CODE"'}' > "$RESPONSE"
      exit 1 ;;
    422)
      # Validation error — preserve server response for Claude to display
      echo "HTTP:$HTTP_CODE" >&2
      exit 3 ;;
    429)
      echo '{"error":"rate_limited"}' > "$RESPONSE"
      exit 2 ;;
    *)
      echo "HTTP:${HTTP_CODE:-no_response}" >&2
      exit 3 ;;
  esac
}

# ============================================================
# Route subcommand
# ============================================================

case "${1:-}" in
  config)
    shift
    cmd_config "$@"
    ;;
  gauge)
    shift
    cmd_gauge "$@"
    ;;
  -h|--help)
    echo "Usage:" >&2
    echo "  analyze.sh <payload-file> [response-file]   — POST /v1/analyze" >&2
    echo "  analyze.sh config [response-file]            — GET /v1/extraction-config" >&2
    echo "  analyze.sh gauge <payload-file> [response-file] — POST /v1/gauge" >&2
    exit 0 ;;
  *)
    cmd_analyze "$@"
    ;;
esac
