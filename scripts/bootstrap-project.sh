#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=""
HOOKS_SAMPLES=0

usage() {
  cat <<'EOF'
Usage: bash scripts/bootstrap-project.sh --project-root <dir> [options]

Options:
  --project-root <dir>  Target project root where .grobot/ will be initialized (required)
  --hooks-samples       Create executable sample hook scripts under .grobot/hooks/*
  -h, --help            Show help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-root)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --project-root" >&2
        exit 1
      fi
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --hooks-samples)
      HOOKS_SAMPLES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$PROJECT_ROOT" ]; then
  echo "error: --project-root is required" >&2
  usage
  exit 1
fi

if ! PROJECT_ROOT="$(cd "$PROJECT_ROOT" >/dev/null 2>&1 && pwd)"; then
  echo "error: project root does not exist or is not accessible: $PROJECT_ROOT" >&2
  exit 1
fi
GROBOT_DIR="$PROJECT_ROOT/.grobot"

CREATED_DIRS=()
CREATED_FILES=()

ensure_dir_exists() {
  local target_dir="$1"
  if [ -d "$target_dir" ]; then
    return 0
  fi
  mkdir -p "$target_dir"
  CREATED_DIRS+=("$target_dir")
}

write_text_file_if_missing() {
  local target_file="$1"
  if [ -e "$target_file" ]; then
    cat >/dev/null
    return 0
  fi
  mkdir -p "$(dirname "$target_file")"
  cat > "$target_file"
  CREATED_FILES+=("$target_file")
  return 0
}

required_dirs=(
  "$GROBOT_DIR"
  "$GROBOT_DIR/hooks"
  "$GROBOT_DIR/hooks/user-prompt-submit"
  "$GROBOT_DIR/hooks/before-tool-use"
  "$GROBOT_DIR/hooks/after-tool-use"
  "$GROBOT_DIR/rules"
  "$GROBOT_DIR/skills"
  "$GROBOT_DIR/commands"
  "$GROBOT_DIR/memory"
  "$GROBOT_DIR/wiki"
  "$GROBOT_DIR/sessions"
  "$GROBOT_DIR/plans"
  "$GROBOT_DIR/experience"
  "$GROBOT_DIR/scheduler"
)

for target_dir in "${required_dirs[@]}"; do
  ensure_dir_exists "$target_dir"
done

write_text_file_if_missing "$GROBOT_DIR/project.toml" <<'EOF'
schema_version = 1
mode = "mvp"

[agent]
id = "grobot"
name = "Grobot Project Agent"
description = "Project-level runtime contract for Grobot"

[execution]
gateway_impl = "ts"
runtime_impl = "rust"
shadow_mode = false

[session]
key_format = "<platform>:<tenant>:<scope>:<subject>"
thread_isolation = true
reply_in_thread = true
resume_ttl_secs = 1800

[tools]
allow = ["list", "glob", "search", "read", "write", "edit", "shell", "git", "rg", "python3", "cargo", "npm"]
deny = ["git reset --hard", "git push --force", "rm -rf /"]

[mcp.instructions]
enabled = true
scope = "project_first"
strict = false
EOF

write_text_file_if_missing "$GROBOT_DIR/mcp.toml" <<'EOF'
# Project-level MCP registry override.
# This file has higher priority than ~/.grobot/mcp/servers.toml for same-name servers.
#
# [[servers]]
# name = "example"
# command = "npx"
# args = ["-y", "@example/mcp-server"]
# enabled = true
EOF

write_text_file_if_missing "$GROBOT_DIR/hooks/README.md" <<'EOF'
# Hooks

Project-level hooks (higher priority than global hooks):
- hooks/user-prompt-submit/
- hooks/before-tool-use/
- hooks/after-tool-use/
EOF

write_text_file_if_missing "$GROBOT_DIR/rules/README.md" <<'EOF'
# Rules

Put project-specific runtime/policy rule files in this directory.
EOF

write_text_file_if_missing "$GROBOT_DIR/skills/README.md" <<'EOF'
# Skills

Put project-local reusable skill files in this directory.
EOF

write_text_file_if_missing "$GROBOT_DIR/commands/README.md" <<'EOF'
# Commands

Project-local user-defined slash commands managed via `/commands`.
Built-in commands are immutable and not managed in this directory.
EOF

write_text_file_if_missing "$GROBOT_DIR/memory/README.md" <<'EOF'
# Memory

Project-local persistent memory artifacts.
EOF

write_text_file_if_missing "$GROBOT_DIR/wiki/README.md" <<'EOF'
# Wiki

Project-local knowledge base and indexed docs.
EOF

write_text_file_if_missing "$GROBOT_DIR/sessions/README.md" <<'EOF'
# Sessions

Session registries and turn histories.
EOF

write_text_file_if_missing "$GROBOT_DIR/plans/README.md" <<'EOF'
# Plans

Plan Mode artifacts grouped by session.
EOF

write_text_file_if_missing "$GROBOT_DIR/experience/README.md" <<'EOF'
# Experience

Project-level experience pool and learned operator signals.
EOF

write_text_file_if_missing "$GROBOT_DIR/scheduler/README.md" <<'EOF'
# Scheduler

Scheduled maintenance/task artifacts.
EOF

if [ "$HOOKS_SAMPLES" -eq 1 ]; then
  sample_user_prompt="$GROBOT_DIR/hooks/user-prompt-submit/10-user-prompt-submit-sample.sh"
  sample_before_tool="$GROBOT_DIR/hooks/before-tool-use/20-before-tool-use-sample.sh"
  sample_after_tool="$GROBOT_DIR/hooks/after-tool-use/30-after-tool-use-sample.sh"

  write_text_file_if_missing "$sample_user_prompt" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "[hook sample] user-prompt-submit"
EOF
  write_text_file_if_missing "$sample_before_tool" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "[hook sample] before-tool-use"
EOF
  write_text_file_if_missing "$sample_after_tool" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "[hook sample] after-tool-use"
EOF
  chmod +x "$sample_user_prompt" "$sample_before_tool" "$sample_after_tool"
fi

echo "Grobot project bootstrap completed."
echo "  project:   $PROJECT_ROOT"
echo "  grobot:    $GROBOT_DIR"
if [ "${#CREATED_DIRS[@]}" -gt 0 ]; then
  echo "  created directories:"
  for target_dir in "${CREATED_DIRS[@]}"; do
    echo "    - $target_dir"
  done
else
  echo "  directories already present"
fi
if [ "${#CREATED_FILES[@]}" -gt 0 ]; then
  echo "  created files:"
  for target_file in "${CREATED_FILES[@]}"; do
    echo "    - $target_file"
  done
else
  echo "  no new files created"
fi
