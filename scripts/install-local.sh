#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  if [[ "$TARGET" != /* ]]; then
    SOURCE="$SCRIPT_DIR/$TARGET"
  else
    SOURCE="$TARGET"
  fi
done

SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BIN_DIR_DEFAULT="${HOME}/.local/bin"
BIN_DIR="${GROBOT_INSTALL_BIN_DIR:-$BIN_DIR_DEFAULT}"
GROBOT_HOME_DEFAULT="${HOME}/.grobot"
GROBOT_HOME_DIR="${GROBOT_HOME:-$GROBOT_HOME_DEFAULT}"
UPDATE_PROFILE=1
BOOTSTRAP_HOME=1
BOOTSTRAP_ONLY=0
RUN_BROWSER_NATIVE_SETUP=1
BROWSER_NATIVE_SETUP_STRICT=0

usage() {
  cat <<'EOF'
Usage: bash scripts/install-local.sh [options]

Options:
  --bin-dir <dir>    Install symlink into custom directory (default: ~/.local/bin)
  --home <dir>       Use custom Grobot home (default: ~/.grobot or $GROBOT_HOME)
  --no-profile       Do not modify shell profile PATH
  --no-home-bootstrap
                     Skip ~/.grobot scaffold bootstrap (not recommended)
  --bootstrap-only   Only run ~/.grobot bootstrap and skip symlink/profile/native setup
  --no-browser-native-setup
                     Skip browser native dependency setup
  --browser-native-setup-strict
                     Fail install when browser native setup fails
  -h, --help         Show help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --bin-dir" >&2
        exit 1
      fi
      BIN_DIR="$2"
      shift 2
      ;;
    --home)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --home" >&2
        exit 1
      fi
      GROBOT_HOME_DIR="$2"
      shift 2
      ;;
    --no-profile)
      UPDATE_PROFILE=0
      shift
      ;;
    --no-home-bootstrap)
      BOOTSTRAP_HOME=0
      shift
      ;;
    --bootstrap-only)
      BOOTSTRAP_ONLY=1
      shift
      ;;
    --no-browser-native-setup)
      RUN_BROWSER_NATIVE_SETUP=0
      shift
      ;;
    --browser-native-setup-strict)
      BROWSER_NATIVE_SETUP_STRICT=1
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

if [ ! -f "$REPO_ROOT/grobot" ]; then
  echo "cannot find grobot launcher under repo root: $REPO_ROOT" >&2
  exit 1
fi

LINK_PATH="$BIN_DIR/grobot"

profile_for_shell() {
  case "${SHELL:-}" in
    */zsh) echo "${HOME}/.zshrc" ;;
    */bash)
      if [ -f "${HOME}/.bashrc" ]; then
        echo "${HOME}/.bashrc"
      else
        echo "${HOME}/.bash_profile"
      fi
      ;;
    *) echo "" ;;
  esac
}

ensure_path_line() {
  local profile_file="$1"
  local path_line="$2"
  if [ -z "$profile_file" ]; then
    return 0
  fi
  touch "$profile_file"
  if ! grep -F "$path_line" "$profile_file" >/dev/null 2>&1; then
    printf '\n%s\n' "$path_line" >> "$profile_file"
  fi
}

BOOTSTRAP_CREATED_DIRS=()
BOOTSTRAP_CREATED_FILES=()
BOOTSTRAP_PRUNED_DIRS=()
BOOTSTRAP_MIGRATION_EVENTS=()

ensure_dir_exists() {
  local target_dir="$1"
  if [ -d "$target_dir" ]; then
    return 0
  fi
  mkdir -p "$target_dir"
  BOOTSTRAP_CREATED_DIRS+=("$target_dir")
}

copy_file_if_missing() {
  local source_file="$1"
  local target_file="$2"
  if [ -e "$target_file" ]; then
    return 0
  fi
  if [ ! -f "$source_file" ]; then
    return 1
  fi
  mkdir -p "$(dirname "$target_file")"
  cp "$source_file" "$target_file"
  BOOTSTRAP_CREATED_FILES+=("$target_file")
  return 0
}

copy_dir_if_missing() {
  local source_dir="$1"
  local target_dir="$2"
  if [ -e "$target_dir" ]; then
    return 0
  fi
  if [ ! -d "$source_dir" ]; then
    return 1
  fi
  mkdir -p "$(dirname "$target_dir")"
  cp -R "$source_dir" "$target_dir"
  BOOTSTRAP_CREATED_DIRS+=("$target_dir")
  return 0
}

write_text_file_if_missing() {
  local target_file="$1"
  if [ -e "$target_file" ]; then
    cat >/dev/null
    return 0
  fi
  mkdir -p "$(dirname "$target_file")"
  cat > "$target_file"
  BOOTSTRAP_CREATED_FILES+=("$target_file")
  return 0
}

resolve_default_ts_dev_cli_cache_root() {
  if [ -n "${GROBOT_TS_DEV_CLI_CACHE_ROOT:-}" ]; then
    printf '%s' "${GROBOT_TS_DEV_CLI_CACHE_ROOT}"
    return 0
  fi
  if [ -n "${GROBOT_TS_DEV_CACHE_ROOT:-}" ]; then
    printf '%s/ts-dev-cli' "${GROBOT_TS_DEV_CACHE_ROOT%/}"
    return 0
  fi

  local os_name
  os_name="$(uname -s 2>/dev/null || echo unknown)"
  case "$os_name" in
    Darwin)
      printf '%s/Library/Caches/grobot/ts-dev-cli' "${HOME}"
      ;;
    Linux)
      if [ -n "${XDG_CACHE_HOME:-}" ]; then
        printf '%s/grobot/ts-dev-cli' "${XDG_CACHE_HOME%/}"
      else
        printf '%s/.cache/grobot/ts-dev-cli' "${HOME}"
      fi
      ;;
    *)
      if [ -n "${XDG_CACHE_HOME:-}" ]; then
        printf '%s/grobot/ts-dev-cli' "${XDG_CACHE_HOME%/}"
      else
        printf '%s/.cache/grobot/ts-dev-cli' "${HOME}"
      fi
      ;;
  esac
}

remove_dir_if_readme_only() {
  local target_dir="$1"
  local readme_path="$target_dir/README.md"
  if [ ! -d "$target_dir" ]; then
    return 0
  fi
  local entry_count
  entry_count="$(find "$target_dir" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
  if [ "$entry_count" != "1" ] || [ ! -f "$readme_path" ]; then
    return 0
  fi
  rm -f "$readme_path"
  if rmdir "$target_dir" >/dev/null 2>&1; then
    BOOTSTRAP_PRUNED_DIRS+=("$target_dir")
  fi
}

remove_dir_if_empty() {
  local target_dir="$1"
  if [ ! -d "$target_dir" ]; then
    return 0
  fi
  if rmdir "$target_dir" >/dev/null 2>&1; then
    BOOTSTRAP_PRUNED_DIRS+=("$target_dir")
  fi
}

maybe_migrate_legacy_ts_dev_cli_cache() {
  local normalized_home="$1"
  local legacy_cache_root="$normalized_home/cache/ts-dev-cli"
  local target_cache_root
  target_cache_root="$(resolve_default_ts_dev_cli_cache_root)"

  if [ "$legacy_cache_root" = "$target_cache_root" ]; then
    return 0
  fi
  if [ ! -d "$legacy_cache_root" ]; then
    return 0
  fi
  if [ -d "$target_cache_root" ]; then
    BOOTSTRAP_MIGRATION_EVENTS+=("skip legacy ts-dev-cli cache (target exists): $target_cache_root")
    return 0
  fi

  mkdir -p "$(dirname "$target_cache_root")"
  if mv "$legacy_cache_root" "$target_cache_root" >/dev/null 2>&1; then
    BOOTSTRAP_MIGRATION_EVENTS+=("migrated ts-dev-cli cache: $legacy_cache_root -> $target_cache_root")
    remove_dir_if_empty "$normalized_home/cache"
    return 0
  fi
  if cp -R "$legacy_cache_root" "$target_cache_root" >/dev/null 2>&1; then
    rm -rf "$legacy_cache_root" >/dev/null 2>&1 || true
    BOOTSTRAP_MIGRATION_EVENTS+=("copied ts-dev-cli cache: $legacy_cache_root -> $target_cache_root")
    remove_dir_if_empty "$normalized_home/cache"
    return 0
  fi
  BOOTSTRAP_MIGRATION_EVENTS+=("failed to migrate ts-dev-cli cache: $legacy_cache_root")
}

maybe_migrate_legacy_sessions_from_root() {
  local source_root="$1"
  local target_root="$2"
  local source_label="$3"
  if [ ! -d "$source_root" ]; then
    return 0
  fi

  ensure_dir_exists "$target_root"
  local moved_count=0
  local skipped_count=0
  local failed_count=0
  local source_path
  while IFS= read -r -d '' source_path; do
    local base_name
    base_name="$(basename "$source_path")"
    local target_path="$target_root/$base_name"
    if [ -e "$target_path" ]; then
      skipped_count=$((skipped_count + 1))
      continue
    fi
    if mv "$source_path" "$target_path" >/dev/null 2>&1; then
      moved_count=$((moved_count + 1))
    else
      failed_count=$((failed_count + 1))
    fi
  done < <(find "$source_root" -mindepth 1 -maxdepth 1 -print0 2>/dev/null)

  if [ "$moved_count" -gt 0 ]; then
    BOOTSTRAP_MIGRATION_EVENTS+=("migrated sessions from $source_label: moved=$moved_count")
  fi
  if [ "$skipped_count" -gt 0 ]; then
    BOOTSTRAP_MIGRATION_EVENTS+=("migrated sessions from $source_label: skipped_existing=$skipped_count")
  fi
  if [ "$failed_count" -gt 0 ]; then
    BOOTSTRAP_MIGRATION_EVENTS+=("migrated sessions from $source_label: failed=$failed_count")
  fi

  remove_dir_if_empty "$source_root"
}

maybe_migrate_legacy_sessions() {
  local normalized_home="$1"
  local target_root="$normalized_home/sessions"
  maybe_migrate_legacy_sessions_from_root "$normalized_home/session" "$target_root" "$normalized_home/session"
  maybe_migrate_legacy_sessions_from_root "$normalized_home/runtime/sessions" "$target_root" "$normalized_home/runtime/sessions"
}

prune_legacy_surface_dirs() {
  local normalized_home="$1"
  remove_dir_if_readme_only "$normalized_home/runtime"
  remove_dir_if_readme_only "$normalized_home/session"
  remove_dir_if_readme_only "$normalized_home/context"
  remove_dir_if_empty "$normalized_home/cache"
}

bootstrap_global_home() {
  if [ "$BOOTSTRAP_HOME" -ne 1 ]; then
    echo "  home:      bootstrap skipped (--no-home-bootstrap)"
    return 0
  fi

  local normalized_home
  normalized_home="$GROBOT_HOME_DIR"
  local config_template_source="$REPO_ROOT/packages/templates/config.toml.example"
  local builtin_skill_creator_source="$REPO_ROOT/packages/templates/skills/skill-creator"
  local config_example_path="$normalized_home/config.toml.example"
  local config_path="$normalized_home/config.toml"
  local mcp_servers_path="$normalized_home/mcp/servers.toml"
  local builtin_skill_creator_target="$normalized_home/skills/skill-creator"
  local required_dirs=(
    "$normalized_home"
    "$normalized_home/hooks"
    "$normalized_home/hooks/user-prompt-submit"
    "$normalized_home/hooks/before-tool-use"
    "$normalized_home/hooks/after-tool-use"
    "$normalized_home/rules"
    "$normalized_home/skills"
    "$normalized_home/commands"
    "$normalized_home/memory"
    "$normalized_home/wiki"
    "$normalized_home/sessions"
    "$normalized_home/plans"
    "$normalized_home/experience"
    "$normalized_home/mcp"
  )

  local target_dir
  for target_dir in "${required_dirs[@]}"; do
    ensure_dir_exists "$target_dir"
  done

  if [ ! -f "$config_example_path" ]; then
    if ! copy_file_if_missing "$config_template_source" "$config_example_path"; then
      write_text_file_if_missing "$config_example_path" <<'EOF'
# Grobot global configuration example
language = "zh"
EOF
    fi
  fi

  if [ ! -f "$config_path" ]; then
    if [ -f "$config_example_path" ]; then
      cp "$config_example_path" "$config_path"
      BOOTSTRAP_CREATED_FILES+=("$config_path")
    else
      write_text_file_if_missing "$config_path" <<'EOF'
# Grobot global configuration
language = "zh"
EOF
    fi
  fi

  write_text_file_if_missing "$mcp_servers_path" <<'EOF'
# Global MCP registry for grobot
#
# Add one [[servers]] block per server.
#
# [[servers]]
# name = "example"
# command = "npx"
# args = ["-y", "@example/mcp-server"]
# enabled = true
EOF

  write_text_file_if_missing "$normalized_home/hooks/README.md" <<'EOF'
# Hooks

Put executable hook scripts under these event folders:
- hooks/user-prompt-submit/
- hooks/before-tool-use/
- hooks/after-tool-use/
EOF

  write_text_file_if_missing "$normalized_home/skills/README.md" <<'EOF'
# Skills

Put reusable local skill files in this directory.
EOF

  if ! copy_dir_if_missing "$builtin_skill_creator_source" "$builtin_skill_creator_target"; then
    if [ ! -f "$builtin_skill_creator_target/SKILL.md" ]; then
      mkdir -p "$builtin_skill_creator_target"
      BOOTSTRAP_CREATED_DIRS+=("$builtin_skill_creator_target")
      write_text_file_if_missing "$builtin_skill_creator_target/SKILL.md" <<'EOF'
---
name: skill-creator
description: Create and improve skills from user requirements.
---

# Skill Creator

Use this built-in skill to create new skills under `.grobot/skills`.
EOF
    fi
  fi

  write_text_file_if_missing "$normalized_home/commands/README.md" <<'EOF'
# Commands

User-defined slash commands managed via `/commands`.
Only files in this directory are user-manageable; built-in commands are immutable.
EOF

  write_text_file_if_missing "$normalized_home/memory/README.md" <<'EOF'
# Memory

Persistent local memory and retrieval artifacts.
EOF

  write_text_file_if_missing "$normalized_home/wiki/README.md" <<'EOF'
# Wiki

Project and team knowledge snapshots for local retrieval.
EOF

  write_text_file_if_missing "$normalized_home/mcp/README.md" <<'EOF'
# MCP

Global MCP server registry lives in `servers.toml`.
EOF

  write_text_file_if_missing "$normalized_home/rules/README.md" <<'EOF'
# Rules

Global policy/rule snippets and governance references.
EOF

  write_text_file_if_missing "$normalized_home/plans/README.md" <<'EOF'
# Plans

Plan Mode artifacts grouped by session id.
EOF

  write_text_file_if_missing "$normalized_home/experience/README.md" <<'EOF'
# Experience

Global experience snapshots and reusable operational learnings.
EOF

  write_text_file_if_missing "$normalized_home/sessions/README.md" <<'EOF'
# Sessions

Session registries and turn histories.
EOF

  maybe_migrate_legacy_ts_dev_cli_cache "$normalized_home"
  maybe_migrate_legacy_sessions "$normalized_home"
  prune_legacy_surface_dirs "$normalized_home"

  echo "  home:      $normalized_home"
  if [ "${#BOOTSTRAP_CREATED_DIRS[@]}" -gt 0 ]; then
    echo "  bootstrap: created directories:"
    for target_dir in "${BOOTSTRAP_CREATED_DIRS[@]}"; do
      echo "    - $target_dir"
    done
  else
    echo "  bootstrap: directories already present"
  fi

  if [ "${#BOOTSTRAP_CREATED_FILES[@]}" -gt 0 ]; then
    echo "  bootstrap: created files:"
    local target_file
    for target_file in "${BOOTSTRAP_CREATED_FILES[@]}"; do
      echo "    - $target_file"
    done
  else
    echo "  bootstrap: no new scaffold files created"
  fi
  if [ "${#BOOTSTRAP_MIGRATION_EVENTS[@]}" -gt 0 ]; then
    echo "  bootstrap: migration events:"
    local migration_event
    for migration_event in "${BOOTSTRAP_MIGRATION_EVENTS[@]}"; do
      echo "    - $migration_event"
    done
  fi
  if [ "${#BOOTSTRAP_PRUNED_DIRS[@]}" -gt 0 ]; then
    echo "  bootstrap: pruned legacy directories:"
    local pruned_dir
    for pruned_dir in "${BOOTSTRAP_PRUNED_DIRS[@]}"; do
      echo "    - $pruned_dir"
    done
  fi
}

if [ "$BOOTSTRAP_ONLY" -eq 1 ]; then
  echo "Grobot bootstrap-only mode completed."
  echo "  repo_root: $REPO_ROOT"
  bootstrap_global_home
  exit 0
fi

mkdir -p "$BIN_DIR"
chmod +x "$REPO_ROOT/grobot"
ln -sfn "$REPO_ROOT/grobot" "$LINK_PATH"

PATH_LINE="export PATH=\"${BIN_DIR}:\$PATH\""
if [ "$UPDATE_PROFILE" -eq 1 ]; then
  PROFILE_FILE="$(profile_for_shell)"
  ensure_path_line "$PROFILE_FILE" "$PATH_LINE"
fi

echo "Grobot source install completed."
echo "  repo_root: $REPO_ROOT"
echo "  symlink:   $LINK_PATH -> $REPO_ROOT/grobot"

case ":$PATH:" in
  *":${BIN_DIR}:"*)
    echo "  path:      active in current shell"
    ;;
  *)
    echo "  path:      not active in current shell"
    echo "  run:       export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac

if command -v grobot >/dev/null 2>&1; then
  echo "  verify:    $(command -v grobot)"
fi

bootstrap_global_home

run_browser_native_setup() {
  if [ "$RUN_BROWSER_NATIVE_SETUP" -ne 1 ]; then
    echo "  browser:   native setup skipped (--no-browser-native-setup)"
    return 0
  fi

  local setup_script
  setup_script="$REPO_ROOT/adapters/browser-structured-mcp/native-deps-setup.mjs"
  if [ ! -f "$setup_script" ]; then
    echo "  browser:   native setup skipped (script not found: $setup_script)"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "  browser:   native setup skipped (node not found in PATH)"
    return 0
  fi

  echo "  browser:   running native dependency setup..."
  if node "$setup_script" --install --yes --quiet; then
    echo "  browser:   native dependency setup completed"
    return 0
  fi

  echo "  browser:   native dependency setup failed" >&2
  echo "  browser:   run 'npm run browser:native:doctor' for details" >&2
  if [ "$BROWSER_NATIVE_SETUP_STRICT" -eq 1 ]; then
    echo "  browser:   strict mode enabled; aborting install" >&2
    return 1
  fi
  echo "  browser:   continuing install (best-effort mode)" >&2
  return 0
}

run_browser_native_setup
