#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hmac
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import textwrap
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from heapq import nsmallest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import tomllib


RESPONSE_TIMEOUT_SECS = 60
DEFAULT_BASE_URL = "https://api.moonshot.cn/v1"
DEFAULT_MODEL = "auto"
DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0"
REDIS_TIMEOUT_SECS = 2.0


CIRCUIT_STATE: dict[str, dict[str, float]] = {}


@dataclass
class ProviderConfig:
    name: str
    api_key: str
    base_url: str
    model: str


@dataclass
class ProjectSelection:
    name: str
    work_dir: Path
    platform: str
    provider: ProviderConfig


@dataclass
class ProviderRoute:
    provider: ProviderConfig
    model: str


@dataclass
class SessionStoreConfig:
    backend: str
    redis_url: str | None
    ttl_secs: int
    root: Path


@dataclass
class CircuitPolicy:
    failure_threshold: int
    cooldown_secs: int


@dataclass
class LocalToolContext:
    work_dir: Path
    allow_tokens: tuple[str, ...]


@dataclass
class MentionPathIndex:
    work_dir: Path
    paths: set[str]
    exact_map: dict[str, set[str]]
    basename_map: dict[str, set[str]]
    trigram_map: dict[str, set[str]]
    query_cache: dict[str, list[str]]
    engine: str
    last_scan_at: float


@dataclass
class MentionIndexState:
    active: MentionPathIndex
    refresh_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    refresh_thread: threading.Thread | None = field(default=None, repr=False)
    pending_active: MentionPathIndex | None = field(default=None, repr=False)
    last_refresh_started_at: float = 0.0
    last_refresh_applied_at: float = 0.0
    last_refresh_error: str | None = None
    last_refresh_status: str = "idle"


@dataclass
class ManagementCredential:
    name: str
    token: str
    source: str
    actions: tuple[str, ...]
    interrupt_session_prefixes: tuple[str, ...]
    config_sections: tuple[str, ...] | None


MANAGEMENT_ACTION_RELOAD = "reload"
MANAGEMENT_ACTION_INTERRUPT = "interrupt"
MANAGEMENT_ACTION_CONFIG_READ = "config_read"
MANAGEMENT_ACTION_ALL = (
    MANAGEMENT_ACTION_RELOAD,
    MANAGEMENT_ACTION_INTERRUPT,
    MANAGEMENT_ACTION_CONFIG_READ,
)

CONFIG_READ_POLICY_AUTO = "auto"
CONFIG_READ_POLICY_PUBLIC = "public"
CONFIG_READ_POLICY_AUTH = "auth"
CONFIG_READ_POLICY_DISABLED = "disabled"
CONFIG_READ_POLICY_ALL = (
    CONFIG_READ_POLICY_AUTO,
    CONFIG_READ_POLICY_PUBLIC,
    CONFIG_READ_POLICY_AUTH,
    CONFIG_READ_POLICY_DISABLED,
)

CONFIG_SECTION_PATHS = "paths"
CONFIG_SECTION_SELECTION = "selection"
CONFIG_SECTION_SESSION_STORE = "session_store"
CONFIG_SECTION_PROJECT_TOML = "project_toml"
CONFIG_SECTION_CONFIG_TOML = "config_toml"
CONFIG_SECTION_ALL = (
    CONFIG_SECTION_PATHS,
    CONFIG_SECTION_SELECTION,
    CONFIG_SECTION_SESSION_STORE,
    CONFIG_SECTION_PROJECT_TOML,
    CONFIG_SECTION_CONFIG_TOML,
)
DEFAULT_PUBLIC_CONFIG_SECTIONS = (
    CONFIG_SECTION_SELECTION,
    CONFIG_SECTION_SESSION_STORE,
)
CONFIG_PROFILE_OPERATOR = "operator"
CONFIG_PROFILE_AUDITOR = "auditor"
CONFIG_PROFILE_ADMIN = "admin"
CONFIG_PROFILE_ALL = (
    CONFIG_PROFILE_OPERATOR,
    CONFIG_PROFILE_AUDITOR,
    CONFIG_PROFILE_ADMIN,
)
CONFIG_PROFILE_SECTION_MAP: dict[str, tuple[str, ...] | None] = {
    CONFIG_PROFILE_OPERATOR: DEFAULT_PUBLIC_CONFIG_SECTIONS,
    CONFIG_PROFILE_AUDITOR: (
        CONFIG_SECTION_PATHS,
        CONFIG_SECTION_SELECTION,
        CONFIG_SECTION_SESSION_STORE,
        CONFIG_SECTION_PROJECT_TOML,
    ),
    CONFIG_PROFILE_ADMIN: None,
}
POLICY_TEMPLATE_OPS_READ_ONLY = "ops_read_only"
POLICY_TEMPLATE_AUDIT_READ = "audit_read"
POLICY_TEMPLATE_FULL_ADMIN = "full_admin"
POLICY_TEMPLATE_ALL = (
    POLICY_TEMPLATE_OPS_READ_ONLY,
    POLICY_TEMPLATE_AUDIT_READ,
    POLICY_TEMPLATE_FULL_ADMIN,
)
POLICY_TEMPLATE_DEFAULTS: dict[str, dict[str, Any]] = {
    POLICY_TEMPLATE_OPS_READ_ONLY: {
        "actions": (MANAGEMENT_ACTION_CONFIG_READ,),
        "config_profile": CONFIG_PROFILE_OPERATOR,
    },
    POLICY_TEMPLATE_AUDIT_READ: {
        "actions": (MANAGEMENT_ACTION_CONFIG_READ,),
        "config_profile": CONFIG_PROFILE_AUDITOR,
    },
    POLICY_TEMPLATE_FULL_ADMIN: {
        "actions": ("all",),
        "config_profile": CONFIG_PROFILE_ADMIN,
    },
}

LOCAL_TOOL_READ = "read"
LOCAL_TOOL_WRITE = "write"
LOCAL_TOOL_EDIT = "edit"
LOCAL_TOOL_BASH = "bash"
LOCAL_TOOL_LIST = "list"
LOCAL_TOOL_GLOB = "glob"
LOCAL_TOOL_SEARCH = "search"
LOCAL_TOOL_ALL = (
    LOCAL_TOOL_READ,
    LOCAL_TOOL_WRITE,
    LOCAL_TOOL_EDIT,
    LOCAL_TOOL_BASH,
    LOCAL_TOOL_LIST,
    LOCAL_TOOL_GLOB,
    LOCAL_TOOL_SEARCH,
)
LOCAL_TOOL_OUTPUT_LIMIT = 12000
LOCAL_TOOL_BASH_DEFAULT_TIMEOUT_SECS = 30
LOCAL_TOOL_BASH_MAX_TIMEOUT_SECS = 120
LOCAL_TOOL_READ_DEFAULT_LIMIT = 200
LOCAL_TOOL_READ_MAX_LIMIT = 2000
LOCAL_TOOL_LIST_DEFAULT_LIMIT = 200
LOCAL_TOOL_LIST_MAX_LIMIT = 2000
LOCAL_TOOL_GLOB_DEFAULT_LIMIT = 200
LOCAL_TOOL_GLOB_MAX_LIMIT = 2000
LOCAL_TOOL_SEARCH_DEFAULT_LIMIT = 200
LOCAL_TOOL_SEARCH_MAX_LIMIT = 2000
LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES = 20
FILE_MENTION_PATTERN = re.compile(r"@([^\s@,，。；：！？、()（）\[\]【】{}<>《》]+)")
FILE_MENTION_MAX_TOKENS = 8
FILE_MENTION_MAX_CANDIDATES = 5
FILE_MENTION_TRAILING_PUNCTUATION = ".,;:!?)]}>,，。；：！？）】》、"
FILE_MENTION_INDEX_REFRESH_SECS = 3.0
FILE_MENTION_INDEX_FORCE_REFRESH_SECS = 30.0
FILE_MENTION_INDEX_MAX_SCAN_FILES = 300000
FILE_MENTION_MAX_POOL_SIZE = 10000
FILE_MENTION_QUERY_CACHE_MAX_ENTRIES = 4096
FILE_MENTION_REFRESH_ERROR_BACKOFF_SECS = 5.0
FILE_MENTION_PYTHON_EXCLUDE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    "node_modules",
    ".next",
    "dist",
    "build",
    "target",
    ".venv",
    "venv",
}


def fail(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_toml(path: Path) -> dict[str, Any]:
    if not path.exists():
        fail(f"TOML file not found: {path}")
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        fail(f"Invalid TOML at {path}: {exc}")
    except OSError as exc:
        fail(f"Failed to read {path}: {exc}")


def first_platform(project: dict[str, Any]) -> str:
    platforms = project.get("platforms")
    if isinstance(platforms, list):
        for item in platforms:
            if isinstance(item, dict):
                platform_type = item.get("type")
                if isinstance(platform_type, str) and platform_type:
                    return platform_type
    return "feishu"


def find_project(config: dict[str, Any], project_name: str | None) -> dict[str, Any]:
    projects = config.get("projects")
    if not isinstance(projects, list) or not projects:
        fail("No [[projects]] found in .grobot/config.toml")

    if project_name is None:
        first = projects[0]
        if not isinstance(first, dict):
            fail("First project entry is invalid")
        return first

    for item in projects:
        if not isinstance(item, dict):
            continue
        if item.get("name") == project_name:
            return item
    fail(f'Project "{project_name}" not found in .grobot/config.toml')
    return {}


def pick_provider(
    project: dict[str, Any],
    override_provider: str | None,
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
) -> ProviderConfig:
    agent = project.get("agent")
    provider_name = override_provider
    providers: list[dict[str, Any]] = []

    if isinstance(agent, dict):
        if provider_name is None and isinstance(agent.get("provider"), str):
            provider_name = agent["provider"]

        maybe_providers = agent.get("providers")
        if isinstance(maybe_providers, list):
            providers = [p for p in maybe_providers if isinstance(p, dict)]

    provider = None
    if providers:
        if provider_name:
            for item in providers:
                if item.get("name") == provider_name:
                    provider = item
                    break
            if provider is None:
                fail(f'Provider "{provider_name}" not found in [projects.agent.providers]')
        else:
            provider = providers[0]
    else:
        provider = {}

    name = str(provider.get("name") or provider_name or "default")
    api_key = override_api_key or str(provider.get("api_key") or os.getenv("GROBOT_API_KEY", ""))
    if not api_key:
        fail(
            "No API key provided. Set [projects.agent.providers].api_key in .grobot/config.toml "
            "or export GROBOT_API_KEY."
        )

    base_url = override_base_url or str(provider.get("base_url") or DEFAULT_BASE_URL)
    model = override_model or str(provider.get("model") or DEFAULT_MODEL)

    return ProviderConfig(name=name, api_key=api_key, base_url=base_url.rstrip("/"), model=model)


def resolve_project(
    config: dict[str, Any],
    project_name: str | None,
    work_dir_override: str | None,
    override_provider: str | None,
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
) -> ProjectSelection:
    project = find_project(config, project_name)
    project_real_name = str(project.get("name") or "default")

    work_dir = None
    agent = project.get("agent")
    if isinstance(agent, dict):
        options = agent.get("options")
        if isinstance(options, dict):
            candidate = options.get("work_dir")
            if isinstance(candidate, str) and candidate:
                work_dir = Path(candidate).expanduser()

    if work_dir_override:
        work_dir = Path(work_dir_override).expanduser()
    if work_dir is None:
        work_dir = Path.cwd()

    platform = first_platform(project)
    provider = pick_provider(
        project=project,
        override_provider=override_provider,
        override_api_key=override_api_key,
        override_base_url=override_base_url,
        override_model=override_model,
    )

    return ProjectSelection(
        name=project_real_name,
        work_dir=work_dir,
        platform=platform,
        provider=provider,
    )


def parse_provider_item(
    item: dict[str, Any],
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
) -> ProviderConfig | None:
    name = item.get("name")
    if not isinstance(name, str) or not name:
        return None

    api_key = override_api_key or str(item.get("api_key") or os.getenv("GROBOT_API_KEY", ""))
    if not api_key:
        return None

    base_url = override_base_url or str(item.get("base_url") or DEFAULT_BASE_URL)
    model = override_model or str(item.get("model") or DEFAULT_MODEL)
    return ProviderConfig(name=name, api_key=api_key, base_url=base_url.rstrip("/"), model=model)


def dedupe_providers(providers: list[ProviderConfig]) -> list[ProviderConfig]:
    seen: set[tuple[str, str]] = set()
    unique: list[ProviderConfig] = []
    for provider in providers:
        key = (provider.name.lower(), provider.base_url.lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(provider)
    return unique


def resolve_provider_pool(
    project: dict[str, Any],
    selected: ProviderConfig,
    override_api_key: str | None,
    override_base_url: str | None,
    override_model: str | None,
) -> list[ProviderConfig]:
    providers = [selected]
    agent = project.get("agent")
    if isinstance(agent, dict):
        maybe_providers = agent.get("providers")
        if isinstance(maybe_providers, list):
            for item in maybe_providers:
                if not isinstance(item, dict):
                    continue
                parsed = parse_provider_item(
                    item=item,
                    override_api_key=override_api_key,
                    override_base_url=override_base_url,
                    override_model=override_model,
                )
                if parsed is not None:
                    providers.append(parsed)
    providers = dedupe_providers(providers)
    if not providers:
        fail("No valid provider available for failover routing")
    return providers


def provider_matches_token(provider: ProviderConfig, token: str) -> bool:
    normalized = token.strip().lower()
    if not normalized:
        return False
    return (
        normalized in provider.name.lower()
        or normalized in provider.model.lower()
        or normalized in provider.base_url.lower()
    )


def default_group_target_order(project_toml: dict[str, Any]) -> list[str]:
    routing = project_toml.get("provider_routing")
    if not isinstance(routing, dict):
        return []

    default_group = routing.get("default_group")
    groups = routing.get("groups")
    if not isinstance(groups, list):
        return []

    chosen_group: dict[str, Any] | None = None
    if isinstance(default_group, str) and default_group:
        for group in groups:
            if isinstance(group, dict) and group.get("name") == default_group:
                chosen_group = group
                break
    if chosen_group is None:
        for group in groups:
            if isinstance(group, dict):
                chosen_group = group
                break
    if chosen_group is None:
        return []

    targets = chosen_group.get("targets")
    if not isinstance(targets, list):
        return []

    weighted_targets: list[tuple[str, int]] = []
    for target in targets:
        if not isinstance(target, dict):
            continue
        provider = target.get("provider")
        if not isinstance(provider, str) or not provider:
            continue
        weight = target.get("weight")
        weighted_targets.append((provider, weight if isinstance(weight, int) else 0))

    weighted_targets.sort(key=lambda item: item[1], reverse=True)
    return [name for name, _ in weighted_targets]


def fallback_tokens(project_toml: dict[str, Any]) -> list[str]:
    routing = project_toml.get("provider_routing")
    if not isinstance(routing, dict):
        return []
    raw = routing.get("fallback_order")
    if not isinstance(raw, list):
        return []
    return [token for token in raw if isinstance(token, str) and token.strip()]


def build_provider_failover_chain(
    *,
    project_toml: dict[str, Any],
    provider_pool: list[ProviderConfig],
    selected_provider: ProviderConfig,
    provider_forced: bool,
) -> list[ProviderConfig]:
    primary = selected_provider
    if not provider_forced:
        for target in default_group_target_order(project_toml):
            matched = next(
                (provider for provider in provider_pool if provider.name.lower() == target.lower()),
                None,
            )
            if matched is not None:
                primary = matched
                break

    remaining = [
        provider
        for provider in provider_pool
        if not (
            provider.name.lower() == primary.name.lower()
            and provider.base_url.lower() == primary.base_url.lower()
        )
    ]
    target_rank = {name.lower(): idx for idx, name in enumerate(default_group_target_order(project_toml))}
    tokens = fallback_tokens(project_toml)

    def rank(provider: ProviderConfig) -> tuple[int, int]:
        token_index = len(tokens) + 1
        for idx, token in enumerate(tokens):
            if provider_matches_token(provider, token):
                token_index = idx
                break
        group_index = target_rank.get(provider.name.lower(), len(target_rank) + 1)
        return token_index, group_index

    remaining.sort(key=rank)
    return [primary, *remaining]


def infer_session_ttl_secs(project_toml: dict[str, Any], override_ttl_secs: int | None) -> int:
    if isinstance(override_ttl_secs, int) and override_ttl_secs > 0:
        return override_ttl_secs

    session_cfg = project_toml.get("session")
    if isinstance(session_cfg, dict):
        ttl = session_cfg.get("resume_ttl_secs")
        if isinstance(ttl, int) and ttl > 0:
            return ttl
    return 1800


def resolve_session_store_config(
    *,
    project_toml: dict[str, Any],
    root: Path,
    session_backend_arg: str,
    redis_url_arg: str | None,
    ttl_secs_arg: int | None,
) -> SessionStoreConfig:
    backend = session_backend_arg
    if backend == "auto":
        runtime_cfg = project_toml.get("runtime")
        hot_cache = None
        if isinstance(runtime_cfg, dict):
            storage_cfg = runtime_cfg.get("storage")
            if isinstance(storage_cfg, dict):
                hot_cache = storage_cfg.get("hot_cache")
        if isinstance(hot_cache, str) and hot_cache.lower() == "redis":
            backend = "redis"
        else:
            backend = "file"

    redis_url = redis_url_arg or os.getenv("GROBOT_REDIS_URL") or DEFAULT_REDIS_URL
    ttl_secs = infer_session_ttl_secs(project_toml, ttl_secs_arg)
    return SessionStoreConfig(
        backend=backend,
        redis_url=redis_url if backend == "redis" else None,
        ttl_secs=ttl_secs,
        root=root / ".grobot" / "sessions",
    )


def session_storage_key(session_key: str) -> str:
    return f"grobot:session:{session_key}"


def sanitize_session_key(session_key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", session_key)


def session_file_path(store: SessionStoreConfig, session_key: str) -> Path:
    return store.root / f"{sanitize_session_key(session_key)}.json"


def normalize_history_messages(raw_messages: Any) -> list[dict[str, str]]:
    if not isinstance(raw_messages, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in raw_messages:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if isinstance(role, str) and isinstance(content, str) and role in {"user", "assistant"} and content:
            normalized.append({"role": role, "content": content})
    return normalized


def read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_json_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def redis_parse_url(redis_url: str) -> tuple[str, int, str | None, str | None, int]:
    parsed = urlparse(redis_url)
    if parsed.scheme not in {"redis", "rediss"}:
        raise RuntimeError(f"Unsupported redis URL scheme: {parsed.scheme}")
    if parsed.scheme == "rediss":
        raise RuntimeError("rediss is not supported by built-in client yet")

    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 6379
    username = parsed.username
    password = parsed.password
    db = 0
    if parsed.path and parsed.path != "/":
        try:
            db = int(parsed.path.lstrip("/"))
        except ValueError as exc:
            raise RuntimeError(f"Invalid redis db index in URL: {parsed.path}") from exc
    return host, port, username, password, db


def redis_encode_command(parts: list[str]) -> bytes:
    out = [f"*{len(parts)}\r\n".encode("utf-8")]
    for part in parts:
        raw = part.encode("utf-8")
        out.append(f"${len(raw)}\r\n".encode("utf-8"))
        out.append(raw)
        out.append(b"\r\n")
    return b"".join(out)


def redis_read_exact(sock: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("Redis connection closed unexpectedly")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def redis_read_line(sock: socket.socket) -> str:
    chunks: list[bytes] = []
    while True:
        ch = sock.recv(1)
        if not ch:
            raise RuntimeError("Redis connection closed unexpectedly")
        chunks.append(ch)
        if len(chunks) >= 2 and chunks[-2] == b"\r" and chunks[-1] == b"\n":
            break
    return b"".join(chunks[:-2]).decode("utf-8", errors="replace")


def redis_read_reply(sock: socket.socket) -> Any:
    prefix = sock.recv(1)
    if not prefix:
        raise RuntimeError("Redis connection closed unexpectedly")

    if prefix == b"+":
        return redis_read_line(sock)
    if prefix == b"-":
        error_line = redis_read_line(sock)
        raise RuntimeError(f"Redis error: {error_line}")
    if prefix == b":":
        return int(redis_read_line(sock))
    if prefix == b"$":
        size = int(redis_read_line(sock))
        if size == -1:
            return None
        payload = redis_read_exact(sock, size)
        _ = redis_read_exact(sock, 2)
        return payload.decode("utf-8", errors="replace")
    if prefix == b"*":
        count = int(redis_read_line(sock))
        if count == -1:
            return None
        return [redis_read_reply(sock) for _ in range(count)]
    raise RuntimeError(f"Unknown Redis reply prefix: {prefix!r}")


def redis_execute(redis_url: str, parts: list[str]) -> Any:
    host, port, username, password, db = redis_parse_url(redis_url)
    with socket.create_connection((host, port), timeout=REDIS_TIMEOUT_SECS) as sock:
        sock.settimeout(REDIS_TIMEOUT_SECS)
        if password:
            auth_parts = ["AUTH"]
            if username:
                auth_parts.extend([username, password])
            else:
                auth_parts.append(password)
            sock.sendall(redis_encode_command(auth_parts))
            _ = redis_read_reply(sock)
        if db > 0:
            sock.sendall(redis_encode_command(["SELECT", str(db)]))
            _ = redis_read_reply(sock)
        sock.sendall(redis_encode_command(parts))
        return redis_read_reply(sock)


def redis_get_json(redis_url: str, key: str) -> dict[str, Any] | None:
    value = redis_execute(redis_url, ["GET", key])
    if value is None:
        return None
    if not isinstance(value, str):
        raise RuntimeError("Redis GET returned non-string payload")
    return json.loads(value)


def redis_set_json(redis_url: str, key: str, payload: dict[str, Any], ttl_secs: int) -> None:
    content = json.dumps(payload, ensure_ascii=False)
    _ = redis_execute(redis_url, ["SET", key, content, "EX", str(ttl_secs)])


def load_history_from_store(
    store: SessionStoreConfig,
    session_key: str,
    max_turns: int,
) -> tuple[list[dict[str, str]], str, list[str]]:
    warnings: list[str] = []
    file_path = session_file_path(store, session_key)

    if store.backend == "redis" and store.redis_url:
        try:
            payload = redis_get_json(store.redis_url, session_storage_key(session_key))
            if payload is not None:
                messages = normalize_history_messages(payload.get("messages"))
                return trim_history_messages(messages, max_turns), "redis", warnings
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis read failed, fallback to file: {exc}")

    payload = read_json_file(file_path)
    if payload is not None:
        messages = normalize_history_messages(payload.get("messages"))
        return trim_history_messages(messages, max_turns), "file", warnings
    return [], "empty", warnings


def save_history_to_store(
    store: SessionStoreConfig,
    session_key: str,
    messages: list[dict[str, str]],
    max_turns: int,
) -> list[str]:
    warnings: list[str] = []
    payload = {
        "version": 1,
        "updated_at": now_utc_iso(),
        "session_key": session_key,
        "messages": trim_history_messages(messages, max_turns),
    }

    if store.backend == "redis" and store.redis_url:
        try:
            redis_set_json(store.redis_url, session_storage_key(session_key), payload, store.ttl_secs)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis write failed, fallback to file only: {exc}")

    file_path = session_file_path(store, session_key)
    try:
        write_json_file(file_path, payload)
    except OSError as exc:
        warnings.append(f"file write failed: {exc}")
    return warnings


def interrupt_file_path(store: SessionStoreConfig) -> Path:
    return store.root / "interrupts.json"


def read_interrupt_map(store: SessionStoreConfig) -> dict[str, Any]:
    path = interrupt_file_path(store)
    payload = read_json_file(path)
    if not isinstance(payload, dict):
        return {"items": {}}
    items = payload.get("items")
    if not isinstance(items, dict):
        payload["items"] = {}
    return payload


def write_interrupt_map(store: SessionStoreConfig, payload: dict[str, Any]) -> None:
    write_json_file(interrupt_file_path(store), payload)


def cleanup_interrupt_map(payload: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    items = payload.get("items")
    if not isinstance(items, dict):
        payload["items"] = {}
        return payload
    keys = list(items.keys())
    for key in keys:
        item = items.get(key)
        if not isinstance(item, dict):
            items.pop(key, None)
            continue
        expires_at = item.get("expires_at")
        if isinstance(expires_at, (int, float)) and expires_at > 0 and float(expires_at) < now:
            items.pop(key, None)
    return payload


def interrupt_storage_key(session_key: str) -> str:
    return f"grobot:interrupt:{session_key}"


def set_interrupt_flag(store: SessionStoreConfig, session_key: str, ttl_secs: int) -> list[str]:
    warnings: list[str] = []
    if store.backend == "redis" and store.redis_url:
        try:
            _ = redis_execute(store.redis_url, ["SET", interrupt_storage_key(session_key), "1", "EX", str(ttl_secs)])
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis interrupt write failed, fallback to file: {exc}")

    try:
        payload = cleanup_interrupt_map(read_interrupt_map(store))
        items = payload.get("items")
        if not isinstance(items, dict):
            items = {}
            payload["items"] = items
        items[session_key] = {
            "requested_at": now_utc_iso(),
            "expires_at": time.time() + float(ttl_secs),
        }
        write_interrupt_map(store, payload)
    except OSError as exc:
        warnings.append(f"interrupt file write failed: {exc}")
    return warnings


def interrupt_flag_exists(store: SessionStoreConfig, session_key: str) -> tuple[bool, list[str]]:
    warnings: list[str] = []
    if store.backend == "redis" and store.redis_url:
        try:
            value = redis_execute(store.redis_url, ["GET", interrupt_storage_key(session_key)])
            if isinstance(value, str) and value:
                return True, warnings
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis interrupt read failed, fallback to file: {exc}")

    try:
        payload = cleanup_interrupt_map(read_interrupt_map(store))
        items = payload.get("items")
        if not isinstance(items, dict):
            return False, warnings
        return session_key in items, warnings
    except OSError as exc:
        warnings.append(f"interrupt file read failed: {exc}")
    return False, warnings


def clear_interrupt_flag(store: SessionStoreConfig, session_key: str) -> list[str]:
    warnings: list[str] = []
    if store.backend == "redis" and store.redis_url:
        try:
            _ = redis_execute(store.redis_url, ["DEL", interrupt_storage_key(session_key)])
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"redis interrupt clear failed, fallback to file: {exc}")

    try:
        payload = cleanup_interrupt_map(read_interrupt_map(store))
        items = payload.get("items")
        if isinstance(items, dict):
            items.pop(session_key, None)
        write_interrupt_map(store, payload)
    except OSError as exc:
        warnings.append(f"interrupt file clear failed: {exc}")
    return warnings


def consume_interrupt_flag(store: SessionStoreConfig, session_key: str) -> tuple[bool, list[str]]:
    requested, warnings = interrupt_flag_exists(store, session_key)
    if not requested:
        return False, warnings
    warnings.extend(clear_interrupt_flag(store, session_key))
    return True, warnings


def mask_sensitive_object(payload: Any) -> Any:
    sensitive_tokens = ("api_key", "secret", "token", "password")
    if isinstance(payload, dict):
        masked: dict[str, Any] = {}
        for key, value in payload.items():
            lower_key = key.lower()
            if any(token in lower_key for token in sensitive_tokens):
                if isinstance(value, str):
                    masked[key] = mask_secret(value)
                else:
                    masked[key] = "<redacted>"
                continue
            masked[key] = mask_sensitive_object(value)
        return masked
    if isinstance(payload, list):
        return [mask_sensitive_object(item) for item in payload]
    return payload


def route_identity(route: ProviderRoute) -> str:
    return f"{route.provider.name}|{route.provider.base_url}|{route.model}"


def route_display_name(route: ProviderRoute) -> str:
    return f"{route.provider.name}/{route.model}"


def probe_provider_health(provider: ProviderConfig) -> tuple[bool, str]:
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Accept": "application/json",
    }
    try:
        _ = http_json_or_raise("GET", f"{provider.base_url}/models", headers, None)
        return True, "ok"
    except RuntimeError as exc:
        return False, str(exc)


def circuit_get(route: ProviderRoute) -> dict[str, float]:
    key = route_identity(route)
    current = CIRCUIT_STATE.get(key)
    if current is None:
        current = {"failures": 0.0, "open_until": 0.0}
        CIRCUIT_STATE[key] = current
    return current


def circuit_mark_success(route: ProviderRoute) -> None:
    state = circuit_get(route)
    state["failures"] = 0.0
    state["open_until"] = 0.0


def circuit_mark_failure(route: ProviderRoute, policy: CircuitPolicy) -> bool:
    state = circuit_get(route)
    failures = int(state.get("failures", 0)) + 1
    state["failures"] = float(failures)
    if failures >= policy.failure_threshold:
        state["open_until"] = time.time() + float(policy.cooldown_secs)
        state["failures"] = 0.0
        return True
    return False


def circuit_is_open(route: ProviderRoute) -> tuple[bool, float]:
    state = circuit_get(route)
    open_until = float(state.get("open_until", 0.0))
    return time.time() < open_until, open_until


def format_circuit_health(routes: list[ProviderRoute]) -> list[str]:
    lines: list[str] = []
    now = time.time()
    for route in routes:
        state = circuit_get(route)
        open_until = float(state.get("open_until", 0.0))
        failures = int(state.get("failures", 0.0))
        if open_until > now:
            lines.append(
                f"  {route_display_name(route)}: OPEN ({int(open_until - now)}s left)"
            )
        elif open_until > 0:
            lines.append(f"  {route_display_name(route)}: HALF_OPEN (ready for probe)")
        else:
            lines.append(f"  {route_display_name(route)}: CLOSED (failures={failures})")
    return lines


def safe_subject_from_path(path: Path) -> str:
    raw = path.name or "workspace"
    sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", raw)
    return sanitized[:80] or "workspace"


def build_session_key(project_name: str, platform: str, work_dir: Path) -> str:
    tenant = re.sub(r"[^a-zA-Z0-9._-]", "_", project_name)[:40] or "default"
    subject = safe_subject_from_path(work_dir)
    return f"{platform}:{tenant}:dm:{subject}"


def http_json_or_raise(
    method: str,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(url=url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=RESPONSE_TIMEOUT_SECS) as response:
            body = response.read().decode("utf-8", errors="replace")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from model API: {body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error when calling model API: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Model API returned invalid JSON: {exc}") from exc
    return {}


def http_json(method: str, url: str, headers: dict[str, str], payload: dict[str, Any] | None) -> dict[str, Any]:
    try:
        return http_json_or_raise(method, url, headers, payload)
    except RuntimeError as exc:
        fail(str(exc))
    return {}


def resolve_model_or_raise(provider: ProviderConfig) -> str:
    if provider.model and provider.model != "auto":
        return provider.model

    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Accept": "application/json",
    }
    result = http_json_or_raise("GET", f"{provider.base_url}/models", headers, None)
    data = result.get("data")
    if isinstance(data, list):
        model_ids: list[str] = []
        for item in data:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                model_ids.append(item["id"])

        preferred = [m for m in model_ids if "kimi" in m.lower() or "moonshot" in m.lower()]
        if preferred:
            return preferred[0]
        if model_ids:
            return model_ids[0]

    raise RuntimeError("Could not auto-resolve model from /models. Please set provider.model explicitly.")


def resolve_model(provider: ProviderConfig) -> str:
    try:
        return resolve_model_or_raise(provider)
    except RuntimeError as exc:
        fail(str(exc))
    return ""


def extract_text_from_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                chunks.append(item["text"])
        return "\n".join(chunks).strip()
    return ""


def build_system_prompt(session_key: str, work_dir: Path) -> str:
    return textwrap.dedent(
        f"""
        You are Grobot, an engineering coding assistant.
        Session key: {session_key}
        Working directory: {work_dir}
        Available local tools: list, glob, search, read, write, edit, bash.
        Use tools when needed, then summarize concise actionable results.
        Keep replies concise and actionable.
        """
    ).strip()


def call_model_with_messages_or_raise(
    provider: ProviderConfig,
    model: str,
    messages: list[dict[str, str]],
    tool_context: LocalToolContext,
) -> str:
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    def request_once(message_list: list[dict[str, Any]], enable_tools: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": model,
            "messages": message_list,
            "temperature": 0.2,
        }
        if enable_tools:
            payload["tools"] = build_model_tools()
            payload["tool_choice"] = "auto"
        return http_json_or_raise("POST", f"{provider.base_url}/chat/completions", headers, payload)

    def parse_choice(result: dict[str, Any]) -> dict[str, Any]:
        choices = result.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("Model API returned no choices")
        first = choices[0]
        if not isinstance(first, dict):
            raise RuntimeError("Model API returned malformed choice")
        message = first.get("message")
        if not isinstance(message, dict):
            raise RuntimeError("Model API returned malformed message")
        return message

    conversation: list[dict[str, Any]] = [dict(item) for item in messages]
    max_tool_rounds = 8
    tools_enabled = True

    for _ in range(max_tool_rounds):
        try:
            result = request_once(conversation, tools_enabled)
        except RuntimeError as exc:
            if tools_enabled and model_likely_rejects_tools(str(exc)):
                tools_enabled = False
                continue
            raise

        message = parse_choice(result)
        content = extract_text_from_message_content(message.get("content"))
        tool_calls = message.get("tool_calls")

        if (
            tools_enabled
            and isinstance(tool_calls, list)
            and tool_calls
        ):
            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": content or "",
                "tool_calls": tool_calls,
            }
            conversation.append(assistant_message)
            for call in tool_calls:
                call_id = call.get("id") if isinstance(call, dict) else None
                fn = call.get("function") if isinstance(call, dict) else None
                tool_name = fn.get("name") if isinstance(fn, dict) else None
                raw_args = fn.get("arguments") if isinstance(fn, dict) else None
                if not isinstance(call_id, str) or not call_id:
                    continue
                if not isinstance(tool_name, str) or not tool_name:
                    tool_payload: dict[str, Any] = {
                        "ok": False,
                        "error": "missing tool function name",
                    }
                else:
                    try:
                        args_obj = parse_tool_arguments(raw_args)
                        tool_result = execute_local_tool(tool_name, args_obj, tool_context)
                        tool_payload = {
                            "ok": True,
                            "tool": tool_name,
                            "result": tool_result,
                        }
                    except RuntimeError as exc:
                        tool_payload = {
                            "ok": False,
                            "tool": tool_name,
                            "error": str(exc),
                        }
                conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": json.dumps(tool_payload, ensure_ascii=False),
                    }
                )
            continue

        if content:
            return content
        raise RuntimeError("Model API returned empty content")

    raise RuntimeError("Model API exceeded max tool rounds without final answer")


def trim_history_messages(history_messages: list[dict[str, str]], max_turns: int) -> list[dict[str, str]]:
    if max_turns <= 0:
        return []
    max_messages = max_turns * 2
    if len(history_messages) <= max_messages:
        return history_messages
    return history_messages[-max_messages:]


def build_chat_messages(
    *,
    system_prompt: str,
    history_messages: list[dict[str, str]],
    user_prompt: str,
    max_history_turns: int,
) -> list[dict[str, str]]:
    trimmed_history = trim_history_messages(history_messages, max_history_turns)
    return [
        {"role": "system", "content": system_prompt},
        *trimmed_history,
        {"role": "user", "content": user_prompt},
    ]


def normalize_file_mention_token(raw_token: str) -> str:
    token = raw_token.strip().strip("\"'`“”‘’")
    while token and token[-1] in FILE_MENTION_TRAILING_PUNCTUATION:
        token = token[:-1]
    return token.strip()


def extract_file_mentions(user_prompt: str) -> list[str]:
    mentions: list[str] = []
    for matched in FILE_MENTION_PATTERN.finditer(user_prompt):
        if matched.start() > 0 and user_prompt[matched.start() - 1] in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._%+-":
            continue
        token = normalize_file_mention_token(matched.group(1))
        if not token:
            continue
        if token not in mentions:
            mentions.append(token)
        if len(mentions) >= FILE_MENTION_MAX_TOKENS:
            break
    return mentions


def mention_path_ngrams(path_text: str) -> set[str]:
    normalized = path_text.lower()
    if len(normalized) < 3:
        return {normalized} if normalized else set()
    return {normalized[idx : idx + 3] for idx in range(0, len(normalized) - 2)}


def mention_query_cache_key(token_lower: str, limit: int) -> str:
    safe_limit = max(1, limit)
    return f"{token_lower}::{safe_limit}"


def mention_query_cache_get(index: MentionPathIndex, token_lower: str, limit: int) -> list[str] | None:
    if not isinstance(index.query_cache, OrderedDict):
        return None
    cached = index.query_cache.get(mention_query_cache_key(token_lower, limit))
    if cached is None:
        return None
    index.query_cache.move_to_end(mention_query_cache_key(token_lower, limit))
    return list(cached)


def mention_query_cache_put(
    index: MentionPathIndex,
    token_lower: str,
    limit: int,
    value: list[str],
) -> None:
    if not isinstance(index.query_cache, OrderedDict):
        return
    query_key = mention_query_cache_key(token_lower, limit)
    index.query_cache[query_key] = list(value)
    index.query_cache.move_to_end(query_key)
    while len(index.query_cache) > FILE_MENTION_QUERY_CACHE_MAX_ENTRIES:
        index.query_cache.popitem(last=False)


def mention_index_add_path(index: MentionPathIndex, rel_path: str) -> None:
    if rel_path in index.paths:
        return
    lower_path = rel_path.lower()
    basename = Path(rel_path).name.lower()
    index.paths.add(rel_path)
    index.exact_map.setdefault(lower_path, set()).add(rel_path)
    index.basename_map.setdefault(basename, set()).add(rel_path)
    for token in mention_path_ngrams(lower_path):
        index.trigram_map.setdefault(token, set()).add(rel_path)
    index.query_cache.clear()


def mention_index_remove_path(index: MentionPathIndex, rel_path: str) -> None:
    if rel_path not in index.paths:
        return
    index.paths.remove(rel_path)
    lower_path = rel_path.lower()
    basename = Path(rel_path).name.lower()

    exact_bucket = index.exact_map.get(lower_path)
    if isinstance(exact_bucket, set):
        exact_bucket.discard(rel_path)
        if not exact_bucket:
            index.exact_map.pop(lower_path, None)

    basename_bucket = index.basename_map.get(basename)
    if isinstance(basename_bucket, set):
        basename_bucket.discard(rel_path)
        if not basename_bucket:
            index.basename_map.pop(basename, None)

    for token in mention_path_ngrams(lower_path):
        trigram_bucket = index.trigram_map.get(token)
        if isinstance(trigram_bucket, set):
            trigram_bucket.discard(rel_path)
            if not trigram_bucket:
                index.trigram_map.pop(token, None)
    index.query_cache.clear()


def scan_all_file_paths_with_fd(work_dir: Path) -> tuple[set[str], str]:
    cmd = [
        "fd",
        "--color",
        "never",
        "--type",
        "f",
        "--base-directory",
        str(work_dir),
        ".",
        ".",
    ]
    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(work_dir),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise RuntimeError(f"fd file scan failed: {truncate_text(proc.stderr or proc.stdout or '')}")

    paths: set[str] = set()
    for line in (proc.stdout or "").splitlines():
        rel = line.strip().removeprefix("./")
        if not rel:
            continue
        paths.add(rel)
        if len(paths) >= FILE_MENTION_INDEX_MAX_SCAN_FILES:
            break
    return paths, "fd"


def scan_all_file_paths_with_python(work_dir: Path) -> tuple[set[str], str]:
    paths: set[str] = set()
    root = work_dir.resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if dirname not in FILE_MENTION_PYTHON_EXCLUDE_DIRS and not dirname.startswith(".")
        ]
        current_dir = Path(dirpath)
        for filename in filenames:
            if filename.startswith("."):
                continue
            full_path = current_dir / filename
            if not full_path.is_file():
                continue
            rel = full_path.relative_to(root).as_posix()
            paths.add(rel)
            if len(paths) >= FILE_MENTION_INDEX_MAX_SCAN_FILES:
                return paths, "python"
    return paths, "python"


def scan_all_file_paths(work_dir: Path) -> tuple[set[str], str]:
    if shutil.which("fd"):
        try:
            return scan_all_file_paths_with_fd(work_dir)
        except RuntimeError:
            return scan_all_file_paths_with_python(work_dir)
    return scan_all_file_paths_with_python(work_dir)


def build_mention_path_index(work_dir: Path) -> MentionPathIndex:
    scanned_paths, engine = scan_all_file_paths(work_dir.resolve())
    index = MentionPathIndex(
        work_dir=work_dir.resolve(),
        paths=set(),
        exact_map={},
        basename_map={},
        trigram_map={},
        query_cache=OrderedDict(),
        engine=engine,
        last_scan_at=time.time(),
    )
    for rel_path in sorted(scanned_paths):
        mention_index_add_path(index, rel_path)
    return index


def refresh_mention_path_index(index: MentionPathIndex, *, force: bool = False) -> MentionPathIndex:
    now = time.time()
    if not force and (now - index.last_scan_at) < FILE_MENTION_INDEX_REFRESH_SECS:
        return index

    latest_paths, engine = scan_all_file_paths(index.work_dir)
    removed_paths = index.paths - latest_paths
    added_paths = latest_paths - index.paths
    for rel_path in removed_paths:
        mention_index_remove_path(index, rel_path)
    for rel_path in added_paths:
        mention_index_add_path(index, rel_path)

    index.last_scan_at = now
    index.engine = engine
    return index


def mention_token_candidate_pool(index: MentionPathIndex, token: str) -> set[str]:
    token_lower = token.lower()
    if len(token_lower) < 3:
        shortlist: set[str] = set()
        for basename, paths in index.basename_map.items():
            if token_lower in basename:
                shortlist.update(paths)
                if len(shortlist) >= (FILE_MENTION_MAX_CANDIDATES * 8):
                    break
        if shortlist:
            return shortlist
        return set(index.paths)

    grams = mention_path_ngrams(token_lower)
    posting_lists: list[set[str]] = []
    for gram in grams:
        posting = index.trigram_map.get(gram)
        if not posting:
            return set()
        posting_lists.append(posting)
    posting_lists.sort(key=len)
    merged = set(posting_lists[0])
    for posting in posting_lists[1:]:
        merged.intersection_update(posting)
        if not merged:
            break
        if len(merged) > FILE_MENTION_MAX_POOL_SIZE:
            merged = set(nsmallest(FILE_MENTION_MAX_POOL_SIZE, merged))
            break
    return merged


def mention_path_rank(rel_path: str, token: str) -> tuple[int, int, str]:
    lower = rel_path.lower()
    token_lower = token.lower()
    basename = Path(rel_path).name.lower()
    if lower == token_lower:
        score = 0
    elif basename == token_lower:
        score = 1
    elif lower.endswith("/" + token_lower):
        score = 2
    elif token_lower in basename:
        score = 3
    elif token_lower in lower:
        score = 4
    else:
        score = 9
    return score, len(lower), lower


def mention_index_age_secs(index: MentionPathIndex) -> float:
    return max(0.0, time.time() - index.last_scan_at)


def mention_state_adopt_pending_snapshot(state: MentionIndexState) -> bool:
    pending: MentionPathIndex | None = None
    with state.refresh_lock:
        if state.pending_active is None:
            return False
        pending = state.pending_active
        state.pending_active = None
    state.active = pending
    state.last_refresh_applied_at = time.time()
    state.last_refresh_status = "applied"
    return True


def mention_state_refresh_worker(state: MentionIndexState, work_dir: Path) -> None:
    try:
        refreshed = build_mention_path_index(work_dir)
        with state.refresh_lock:
            state.pending_active = refreshed
            state.last_refresh_error = None
    except Exception as exc:  # noqa: BLE001
        with state.refresh_lock:
            state.last_refresh_error = str(exc)
    finally:
        with state.refresh_lock:
            state.refresh_thread = None


def mention_state_schedule_async_refresh(state: MentionIndexState) -> bool:
    now = time.time()
    with state.refresh_lock:
        if state.pending_active is not None:
            state.last_refresh_status = "pending"
            return False
        if state.refresh_thread is not None and state.refresh_thread.is_alive():
            state.last_refresh_status = "inflight"
            return False
        if (
            isinstance(state.last_refresh_error, str)
            and state.last_refresh_error
            and (now - state.last_refresh_started_at) < FILE_MENTION_REFRESH_ERROR_BACKOFF_SECS
        ):
            state.last_refresh_status = "backoff"
            return False
        worker = threading.Thread(
            target=mention_state_refresh_worker,
            args=(state, state.active.work_dir),
            daemon=True,
            name="grobot-mention-refresh",
        )
        state.refresh_thread = worker
        state.last_refresh_started_at = now
        state.last_refresh_status = "scheduled"
        worker.start()
        return True


def mention_state_from_input(
    mention_index: MentionIndexState | MentionPathIndex | None,
    work_dir: Path,
) -> MentionIndexState:
    resolved_work_dir = work_dir.resolve()
    if isinstance(mention_index, MentionIndexState):
        _ = mention_state_adopt_pending_snapshot(mention_index)
        if mention_index.active.work_dir == resolved_work_dir:
            return mention_index
        return MentionIndexState(active=build_mention_path_index(resolved_work_dir))
    if isinstance(mention_index, MentionPathIndex) and mention_index.work_dir == resolved_work_dir:
        return MentionIndexState(active=mention_index)
    return MentionIndexState(active=build_mention_path_index(resolved_work_dir))


def filter_existing_mention_candidates(index: MentionPathIndex, candidates: list[str]) -> list[str]:
    existing: list[str] = []
    for rel_path in candidates:
        candidate_path = index.work_dir / rel_path
        if candidate_path.is_file():
            existing.append(rel_path)
    return existing


def mention_token_looks_explicit(token: str) -> bool:
    normalized = token.strip()
    if not normalized:
        return False
    if "/" in normalized or "\\" in normalized:
        return True
    return "." in Path(normalized).name


def find_mention_candidates(index: MentionPathIndex, token: str, limit: int) -> list[str]:
    token_lower = token.lower()
    cached = mention_query_cache_get(index, token_lower, limit)
    if isinstance(cached, list):
        return cached[:limit]

    exact_candidates: set[str] = set(index.exact_map.get(token_lower, set()))
    exact_candidates.update(index.basename_map.get(token_lower, set()))
    if exact_candidates and mention_token_looks_explicit(token):
        explicit_best = nsmallest(limit, exact_candidates, key=lambda item: mention_path_rank(item, token))
        mention_query_cache_put(index, token_lower, limit, explicit_best)
        return explicit_best

    candidates: set[str] = set(exact_candidates)
    if len(candidates) < limit:
        candidates.update(mention_token_candidate_pool(index, token))
    matched = [
        rel_path
        for rel_path in candidates
        if token_lower in rel_path.lower() or rel_path.lower() == token_lower
    ]
    best = nsmallest(limit, matched, key=lambda item: mention_path_rank(item, token))
    mention_query_cache_put(index, token_lower, limit, best)
    return best


def enrich_user_prompt_with_file_mentions(
    user_prompt: str,
    context: LocalToolContext,
    mention_index: MentionIndexState | MentionPathIndex | None,
) -> tuple[str, list[str], MentionIndexState | None]:
    mentions = extract_file_mentions(user_prompt)
    if not mentions:
        return user_prompt, [], mention_index

    state = mention_state_from_input(mention_index, context.work_dir)
    _ = mention_state_adopt_pending_snapshot(state)
    state.last_refresh_status = "idle"
    index = state.active
    age_secs = mention_index_age_secs(index)
    hard_stale = age_secs >= FILE_MENTION_INDEX_FORCE_REFRESH_SECS
    soft_stale = age_secs >= FILE_MENTION_INDEX_REFRESH_SECS

    token_candidates: dict[str, list[str]] = {}
    unresolved_tokens: list[str] = []
    for token in mentions:
        candidates = find_mention_candidates(
            index,
            token,
            FILE_MENTION_MAX_CANDIDATES,
        )
        if hard_stale and candidates:
            candidates = filter_existing_mention_candidates(index, candidates)
        token_candidates[token] = candidates
        if not candidates:
            unresolved_tokens.append(token)

    if unresolved_tokens and (soft_stale or hard_stale):
        _ = mention_state_schedule_async_refresh(state)

    lines: list[str] = []
    for token in mentions:
        candidates = token_candidates.get(token, [])
        if len(candidates) == 1:
            lines.append(f"@{token} => {candidates[0]}")
            continue
        if len(candidates) > 1:
            lines.append(
                f"@{token} => ambiguous: {', '.join(candidates[:FILE_MENTION_MAX_CANDIDATES])}"
            )
            continue
        lines.append(f"@{token} => not_found")

    if not lines:
        return user_prompt, [], state

    resolution_block = "\n".join(lines)
    enriched = (
        f"{user_prompt}\n\n"
        "[Resolved @file mentions]\n"
        f"{resolution_block}\n"
        "Prefer resolved paths above when calling tools."
    )
    return enriched, lines, state


def truncate_text(raw: str, limit: int = LOCAL_TOOL_OUTPUT_LIMIT) -> str:
    if len(raw) <= limit:
        return raw
    omitted = len(raw) - limit
    return raw[:limit] + f"\n...[truncated {omitted} chars]"


def normalize_tool_allow_tokens(raw_allow: Any) -> tuple[str, ...]:
    if not isinstance(raw_allow, list):
        return LOCAL_TOOL_ALL
    normalized: list[str] = []
    for item in raw_allow:
        if not isinstance(item, str):
            continue
        token = item.strip().lower()
        if not token:
            continue
        if token in {"*", "all"}:
            return ("all",)
        if token not in normalized:
            normalized.append(token)
    return tuple(normalized)


def resolve_local_tool_context(project_toml: dict[str, Any], work_dir: Path) -> LocalToolContext:
    tools_cfg = project_toml.get("tools")
    allow_raw = None
    if isinstance(tools_cfg, dict):
        allow_raw = tools_cfg.get("allow")
    allow_tokens = normalize_tool_allow_tokens(allow_raw)
    return LocalToolContext(work_dir=work_dir, allow_tokens=allow_tokens)


def allow_all_tokens(allow_tokens: tuple[str, ...]) -> bool:
    return "all" in allow_tokens


def is_local_tool_allowed(tool_name: str, context: LocalToolContext) -> bool:
    if allow_all_tokens(context.allow_tokens):
        return True
    if tool_name in {
        LOCAL_TOOL_READ,
        LOCAL_TOOL_WRITE,
        LOCAL_TOOL_EDIT,
        LOCAL_TOOL_LIST,
        LOCAL_TOOL_GLOB,
        LOCAL_TOOL_SEARCH,
    }:
        return tool_name in context.allow_tokens
    if tool_name == LOCAL_TOOL_BASH:
        return (
            LOCAL_TOOL_BASH in context.allow_tokens
            or "shell" in context.allow_tokens
        )
    return False


def ensure_local_tool_allowed(tool_name: str, context: LocalToolContext) -> None:
    if not is_local_tool_allowed(tool_name, context):
        raise RuntimeError(
            f'Tool "{tool_name}" is not allowed by [tools].allow in .grobot/project.toml'
        )


def resolve_path_in_work_dir(work_dir: Path, raw_path: Any) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise RuntimeError("path is required")
    candidate = Path(raw_path.strip()).expanduser()
    if not candidate.is_absolute():
        candidate = work_dir / candidate
    resolved = candidate.resolve()
    root = work_dir.resolve()
    if resolved != root and root not in resolved.parents:
        raise RuntimeError(f"path out of work_dir boundary: {raw_path}")
    return resolved


def resolve_path_or_work_dir(work_dir: Path, raw_path: Any) -> Path:
    if raw_path is None:
        return work_dir.resolve()
    return resolve_path_in_work_dir(work_dir, raw_path)


def resolve_tool_limit(raw_limit: Any, default_limit: int, max_limit: int) -> int:
    if isinstance(raw_limit, int) and raw_limit > 0:
        return min(raw_limit, max_limit)
    return default_limit


def normalize_list_kind(raw_kind: Any) -> str:
    if not isinstance(raw_kind, str):
        return "all"
    kind = raw_kind.strip().lower()
    if kind in {"all", "file", "dir"}:
        return kind
    raise RuntimeError('kind must be "all", "file", or "dir"')


def is_hidden_relative_path(path: Path) -> bool:
    return any(part.startswith(".") for part in path.parts if part not in {"", "."})


def list_entries_with_fd(
    *,
    base_path: Path,
    pattern: str,
    kind: str,
    include_hidden: bool,
    limit: int,
) -> tuple[list[dict[str, Any]], str]:
    cmd = [
        "fd",
        "--color",
        "never",
        "--glob",
        "--base-directory",
        str(base_path),
        "--max-results",
        str(limit),
    ]
    if include_hidden:
        cmd.extend(["--hidden", "--no-ignore"])
    if kind == "file":
        cmd.extend(["--type", "f"])
    elif kind == "dir":
        cmd.extend(["--type", "d"])
    cmd.extend([pattern or "*", "."])

    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(base_path),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise RuntimeError(f"fd failed: {truncate_text(proc.stderr or proc.stdout or '')}")

    entries: list[dict[str, Any]] = []
    for line in (proc.stdout or "").splitlines():
        item = line.strip()
        if not item:
            continue
        rel = item.removeprefix("./")
        path = (base_path / rel).resolve()
        entry_kind = "dir" if path.is_dir() else "file"
        entries.append({"path": rel, "kind": entry_kind})
        if len(entries) >= limit:
            break
    return entries, "fd"


def list_entries_with_python(
    *,
    base_path: Path,
    pattern: str,
    kind: str,
    include_hidden: bool,
    limit: int,
) -> tuple[list[dict[str, Any]], str]:
    entries: list[dict[str, Any]] = []
    glob_pattern = pattern or "*"
    for node in sorted(base_path.rglob("*")):
        rel = node.relative_to(base_path)
        if not include_hidden and is_hidden_relative_path(rel):
            continue
        rel_text = rel.as_posix()
        if not fnmatch.fnmatch(rel_text, glob_pattern):
            continue
        node_kind = "dir" if node.is_dir() else "file"
        if kind == "file" and node_kind != "file":
            continue
        if kind == "dir" and node_kind != "dir":
            continue
        entries.append({"path": rel_text, "kind": node_kind})
        if len(entries) >= limit:
            break
    return entries, "python"


def tool_list_entries(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    base_path = resolve_path_or_work_dir(context.work_dir, arguments.get("path"))
    if not base_path.exists():
        raise RuntimeError(f"path does not exist: {base_path}")
    if not base_path.is_dir():
        raise RuntimeError("list path must be a directory")

    pattern_raw = arguments.get("pattern")
    pattern = pattern_raw if isinstance(pattern_raw, str) and pattern_raw.strip() else "*"
    kind = normalize_list_kind(arguments.get("kind"))
    include_hidden = bool(arguments.get("include_hidden", False))
    limit = resolve_tool_limit(
        arguments.get("limit"),
        LOCAL_TOOL_LIST_DEFAULT_LIMIT,
        LOCAL_TOOL_LIST_MAX_LIMIT,
    )

    if shutil.which("fd"):
        entries, engine = list_entries_with_fd(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )
    else:
        entries, engine = list_entries_with_python(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )

    return {
        "base_path": str(base_path),
        "pattern": pattern,
        "kind": kind,
        "include_hidden": include_hidden,
        "limit": limit,
        "engine": engine,
        "count": len(entries),
        "entries": entries,
    }


def tool_glob_entries(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    base_path = resolve_path_or_work_dir(context.work_dir, arguments.get("path"))
    if not base_path.exists():
        raise RuntimeError(f"path does not exist: {base_path}")
    if not base_path.is_dir():
        raise RuntimeError("glob path must be a directory")

    pattern_raw = arguments.get("pattern")
    if not isinstance(pattern_raw, str) or not pattern_raw.strip():
        raise RuntimeError("pattern must be non-empty string")
    pattern = pattern_raw.strip()
    kind = normalize_list_kind(arguments.get("kind"))
    include_hidden = bool(arguments.get("include_hidden", False))
    limit = resolve_tool_limit(
        arguments.get("limit"),
        LOCAL_TOOL_GLOB_DEFAULT_LIMIT,
        LOCAL_TOOL_GLOB_MAX_LIMIT,
    )

    if shutil.which("fd"):
        entries, engine = list_entries_with_fd(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )
    else:
        entries, engine = list_entries_with_python(
            base_path=base_path,
            pattern=pattern,
            kind=kind,
            include_hidden=include_hidden,
            limit=limit,
        )

    return {
        "base_path": str(base_path),
        "pattern": pattern,
        "kind": kind,
        "include_hidden": include_hidden,
        "limit": limit,
        "engine": engine,
        "count": len(entries),
        "matches": [entry["path"] for entry in entries],
    }


def resolve_context_lines(raw_value: Any) -> int:
    if isinstance(raw_value, int) and raw_value >= 0:
        return min(raw_value, LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES)
    return 0


def search_with_rg(
    *,
    base_path: Path,
    work_dir: Path,
    query: str,
    glob_pattern: str,
    use_regex: bool,
    case_sensitive: bool,
    include_hidden: bool,
    limit: int,
    context_before: int,
    context_after: int,
) -> tuple[list[dict[str, Any]], str, int]:
    cmd = [
        "rg",
        "--json",
        "--color",
        "never",
        "--max-count",
        str(limit),
    ]
    if not case_sensitive:
        cmd.append("-i")
    if not use_regex:
        cmd.append("-F")
    if include_hidden:
        cmd.extend(["--hidden", "--no-ignore"])
    if context_before > 0:
        cmd.extend(["-B", str(context_before)])
    if context_after > 0:
        cmd.extend(["-A", str(context_after)])
    if glob_pattern:
        cmd.extend(["-g", glob_pattern])
    cmd.extend([query, str(base_path)])

    proc = subprocess.run(  # noqa: S603
        cmd,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise RuntimeError(f"rg failed: {truncate_text(proc.stderr or proc.stdout or '')}")

    matches: list[dict[str, Any]] = []
    match_count = 0
    for raw_event in (proc.stdout or "").splitlines():
        try:
            event = json.loads(raw_event)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        if event_type not in {"match", "context"}:
            continue
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        path_obj = data.get("path")
        if not isinstance(path_obj, dict):
            continue
        path_text = path_obj.get("text")
        if not isinstance(path_text, str) or not path_text:
            continue
        line_no = data.get("line_number")
        if not isinstance(line_no, int) or line_no <= 0:
            continue
        lines_obj = data.get("lines")
        content = lines_obj.get("text") if isinstance(lines_obj, dict) else ""
        if not isinstance(content, str):
            content = ""
        content = content.rstrip("\r\n")
        column = 0
        is_match = event_type == "match"
        if is_match:
            column = 1
            submatches = data.get("submatches")
            if isinstance(submatches, list) and submatches:
                first_submatch = submatches[0]
                if isinstance(first_submatch, dict):
                    start_col = first_submatch.get("start")
                    if isinstance(start_col, int) and start_col >= 0:
                        column = start_col + 1
            match_count += 1
        path = Path(path_text)
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()
        matches.append(
            {
                "path": relativize_to_work_dir(path, work_dir),
                "line": line_no,
                "column": column,
                "text": truncate_text(content, limit=300),
                "match": is_match,
            }
        )
    return matches, "rg", match_count


def relativize_to_work_dir(path: Path, work_dir: Path) -> str:
    try:
        return path.resolve().relative_to(work_dir.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def iter_search_files(base_path: Path, include_hidden: bool) -> list[Path]:
    if base_path.is_file():
        return [base_path]
    files: list[Path] = []
    for node in base_path.rglob("*"):
        if not node.is_file():
            continue
        rel = node.relative_to(base_path)
        if not include_hidden and is_hidden_relative_path(rel):
            continue
        files.append(node)
    return files


def search_with_python(
    *,
    base_path: Path,
    work_dir: Path,
    query: str,
    glob_pattern: str,
    use_regex: bool,
    case_sensitive: bool,
    include_hidden: bool,
    limit: int,
    context_before: int,
    context_after: int,
) -> tuple[list[dict[str, Any]], str, int]:
    files = iter_search_files(base_path, include_hidden)
    matches: list[dict[str, Any]] = []
    regex = None
    if use_regex:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(query, flags=flags)
        except re.error as exc:
            raise RuntimeError(f"invalid regex: {exc}") from exc
    needle = query if case_sensitive else query.lower()
    match_count = 0

    def append_record(path_value: Path, line_no: int, column: int, line_text: str, is_match: bool) -> None:
        matches.append(
            {
                "path": relativize_to_work_dir(path_value, work_dir),
                "line": line_no,
                "column": column,
                "text": truncate_text(line_text, limit=300),
                "match": is_match,
            }
        )

    for file_path in files:
        rel_to_scope = (
            file_path.relative_to(base_path).as_posix()
            if base_path.is_dir()
            else file_path.name
        )
        if glob_pattern and not fnmatch.fnmatch(rel_to_scope, glob_pattern):
            continue
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = content.splitlines()
        total_lines = len(lines)
        for idx, line in enumerate(lines, start=1):
            column = -1
            if regex is not None:
                found = regex.search(line)
                if found is not None:
                    column = found.start() + 1
            else:
                hay = line if case_sensitive else line.lower()
                pos = hay.find(needle)
                if pos >= 0:
                    column = pos + 1
            if column < 0:
                continue
            match_count += 1
            if context_before <= 0 and context_after <= 0:
                append_record(file_path, idx, column, line, True)
            else:
                start_line = max(1, idx - context_before)
                end_line = min(total_lines, idx + context_after)
                for context_line_no in range(start_line, end_line + 1):
                    context_line_text = lines[context_line_no - 1]
                    is_match_line = context_line_no == idx
                    append_record(
                        file_path,
                        context_line_no,
                        column if is_match_line else 0,
                        context_line_text,
                        is_match_line,
                    )
            if match_count >= limit:
                return matches, "python", match_count
    return matches, "python", match_count


def tool_search_text(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    query = arguments.get("query")
    if not isinstance(query, str) or not query.strip():
        raise RuntimeError("query must be non-empty string")
    base_path = resolve_path_or_work_dir(context.work_dir, arguments.get("path"))
    if not base_path.exists():
        raise RuntimeError(f"path does not exist: {base_path}")

    glob_pattern_raw = arguments.get("glob")
    glob_pattern = glob_pattern_raw.strip() if isinstance(glob_pattern_raw, str) else ""
    use_regex = bool(arguments.get("regex", False))
    case_sensitive = bool(arguments.get("case_sensitive", False))
    include_hidden = bool(arguments.get("include_hidden", False))
    context_before = resolve_context_lines(arguments.get("context_before"))
    context_after = resolve_context_lines(arguments.get("context_after"))
    limit = resolve_tool_limit(
        arguments.get("limit"),
        LOCAL_TOOL_SEARCH_DEFAULT_LIMIT,
        LOCAL_TOOL_SEARCH_MAX_LIMIT,
    )

    if shutil.which("rg"):
        try:
            matches, engine, match_count = search_with_rg(
                base_path=base_path,
                work_dir=context.work_dir,
                query=query,
                glob_pattern=glob_pattern,
                use_regex=use_regex,
                case_sensitive=case_sensitive,
                include_hidden=include_hidden,
                limit=limit,
                context_before=context_before,
                context_after=context_after,
            )
        except RuntimeError:
            matches, engine, match_count = search_with_python(
                base_path=base_path,
                work_dir=context.work_dir,
                query=query,
                glob_pattern=glob_pattern,
                use_regex=use_regex,
                case_sensitive=case_sensitive,
                include_hidden=include_hidden,
                limit=limit,
                context_before=context_before,
                context_after=context_after,
            )
    else:
        matches, engine, match_count = search_with_python(
            base_path=base_path,
            work_dir=context.work_dir,
            query=query,
            glob_pattern=glob_pattern,
            use_regex=use_regex,
            case_sensitive=case_sensitive,
            include_hidden=include_hidden,
            limit=limit,
            context_before=context_before,
            context_after=context_after,
        )

    return {
        "base_path": str(base_path),
        "query": query,
        "glob": glob_pattern or None,
        "regex": use_regex,
        "case_sensitive": case_sensitive,
        "include_hidden": include_hidden,
        "context_before": context_before,
        "context_after": context_after,
        "limit": limit,
        "engine": engine,
        "count": match_count,
        "records": len(matches),
        "matches": matches,
    }


def tool_read_file(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    path = resolve_path_in_work_dir(context.work_dir, arguments.get("path"))
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"read failed: {exc}") from exc

    offset_raw = arguments.get("offset", 1)
    limit_raw = arguments.get("limit", LOCAL_TOOL_READ_DEFAULT_LIMIT)
    offset = offset_raw if isinstance(offset_raw, int) and offset_raw > 0 else 1
    limit = (
        limit_raw
        if isinstance(limit_raw, int) and 1 <= limit_raw <= LOCAL_TOOL_READ_MAX_LIMIT
        else LOCAL_TOOL_READ_DEFAULT_LIMIT
    )

    lines = raw.splitlines()
    total = len(lines)
    start_idx = max(offset - 1, 0)
    if start_idx >= total:
        selected: list[str] = []
    else:
        selected = lines[start_idx : start_idx + limit]
    end_line = start_idx + len(selected)
    content = "\n".join(selected)

    return {
        "path": str(path),
        "offset": offset,
        "limit": limit,
        "line_start": start_idx + 1 if selected else offset,
        "line_end": end_line if selected else offset - 1,
        "total_lines": total,
        "content": truncate_text(content),
    }


def tool_write_file(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    path = resolve_path_in_work_dir(context.work_dir, arguments.get("path"))
    content = arguments.get("content")
    if not isinstance(content, str):
        raise RuntimeError("content must be string")

    existed = path.exists()
    previous_size = path.stat().st_size if existed else 0
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"write failed: {exc}") from exc

    return {
        "path": str(path),
        "replaced": existed,
        "previous_size": previous_size,
        "bytes_written": len(content.encode("utf-8")),
    }


def tool_edit_file(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    path = resolve_path_in_work_dir(context.work_dir, arguments.get("path"))
    old_text = arguments.get("old_text")
    new_text = arguments.get("new_text")
    replace_all = arguments.get("replace_all", False)
    if not isinstance(old_text, str) or old_text == "":
        raise RuntimeError("old_text must be non-empty string")
    if not isinstance(new_text, str):
        raise RuntimeError("new_text must be string")
    if not isinstance(replace_all, bool):
        replace_all = False

    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"edit read failed: {exc}") from exc

    occurrences = raw.count(old_text)
    if occurrences <= 0:
        raise RuntimeError("old_text not found")
    if replace_all:
        updated = raw.replace(old_text, new_text)
        replacements = occurrences
    else:
        updated = raw.replace(old_text, new_text, 1)
        replacements = 1

    try:
        path.write_text(updated, encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"edit write failed: {exc}") from exc

    return {
        "path": str(path),
        "replace_all": replace_all,
        "occurrences_found": occurrences,
        "replacements": replacements,
    }


def resolve_bash_timeout_secs(raw_timeout: Any) -> int:
    if isinstance(raw_timeout, int) and raw_timeout > 0:
        return min(raw_timeout, LOCAL_TOOL_BASH_MAX_TIMEOUT_SECS)
    return LOCAL_TOOL_BASH_DEFAULT_TIMEOUT_SECS


def first_command_token(command: str) -> str | None:
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    if not parts:
        return None
    return parts[0]


def ensure_bash_command_allowed(command: str, context: LocalToolContext) -> None:
    if allow_all_tokens(context.allow_tokens):
        return
    if "shell" in context.allow_tokens or LOCAL_TOOL_BASH in context.allow_tokens:
        return
    first = first_command_token(command)
    if first and first in context.allow_tokens:
        return
    raise RuntimeError(
        f'bash command not allowed by [tools].allow: "{first or "<empty>"}"'
    )


def tool_run_bash(arguments: dict[str, Any], context: LocalToolContext) -> dict[str, Any]:
    command = arguments.get("command")
    if not isinstance(command, str) or not command.strip():
        raise RuntimeError("command must be non-empty string")
    timeout_secs = resolve_bash_timeout_secs(arguments.get("timeout_secs"))
    ensure_bash_command_allowed(command, context)

    try:
        proc = subprocess.run(  # noqa: S603
            ["/bin/zsh", "-lc", command],
            cwd=str(context.work_dir),
            text=True,
            capture_output=True,
            timeout=timeout_secs,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        stderr = exc.stderr if isinstance(exc.stderr, str) else ""
        raise RuntimeError(
            f"bash timeout after {timeout_secs}s; "
            f"stdout={truncate_text(stdout)!r}; stderr={truncate_text(stderr)!r}"
        ) from exc
    except OSError as exc:
        raise RuntimeError(f"bash failed: {exc}") from exc

    return {
        "command": command,
        "exit_code": proc.returncode,
        "stdout": truncate_text(proc.stdout or ""),
        "stderr": truncate_text(proc.stderr or ""),
    }


def execute_local_tool(
    tool_name: str,
    arguments: dict[str, Any],
    context: LocalToolContext,
) -> dict[str, Any]:
    if tool_name == LOCAL_TOOL_LIST:
        ensure_local_tool_allowed(tool_name, context)
        return tool_list_entries(arguments, context)
    if tool_name == LOCAL_TOOL_GLOB:
        ensure_local_tool_allowed(tool_name, context)
        return tool_glob_entries(arguments, context)
    if tool_name == LOCAL_TOOL_SEARCH:
        ensure_local_tool_allowed(tool_name, context)
        return tool_search_text(arguments, context)
    if tool_name == LOCAL_TOOL_READ:
        ensure_local_tool_allowed(tool_name, context)
        return tool_read_file(arguments, context)
    if tool_name == LOCAL_TOOL_WRITE:
        ensure_local_tool_allowed(tool_name, context)
        return tool_write_file(arguments, context)
    if tool_name == LOCAL_TOOL_EDIT:
        ensure_local_tool_allowed(tool_name, context)
        return tool_edit_file(arguments, context)
    if tool_name == LOCAL_TOOL_BASH:
        return tool_run_bash(arguments, context)
    raise RuntimeError(f"unsupported tool: {tool_name}")


def build_model_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_LIST,
                "description": "List files/directories under work_dir (fd preferred, python fallback).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "pattern": {"type": "string"},
                        "kind": {"type": "string", "enum": ["all", "file", "dir"]},
                        "include_hidden": {"type": "boolean"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_LIST_MAX_LIMIT},
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_GLOB,
                "description": "Glob files/directories under work_dir by pattern (fd preferred, python fallback).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "pattern": {"type": "string"},
                        "kind": {"type": "string", "enum": ["all", "file", "dir"]},
                        "include_hidden": {"type": "boolean"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_GLOB_MAX_LIMIT},
                    },
                    "required": ["pattern"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_SEARCH,
                "description": "Search text in files (ripgrep preferred, python fallback).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "path": {"type": "string"},
                        "glob": {"type": "string"},
                        "regex": {"type": "boolean"},
                        "case_sensitive": {"type": "boolean"},
                        "include_hidden": {"type": "boolean"},
                        "context_before": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES,
                        },
                        "context_after": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": LOCAL_TOOL_SEARCH_MAX_CONTEXT_LINES,
                        },
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_SEARCH_MAX_LIMIT},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_READ,
                "description": "Read a UTF-8 text file in work_dir with line offset and limit.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "offset": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_READ_MAX_LIMIT},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_WRITE,
                "description": "Write UTF-8 content to a file in work_dir.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_EDIT,
                "description": "Edit file text by replacing old_text with new_text.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "old_text": {"type": "string"},
                        "new_text": {"type": "string"},
                        "replace_all": {"type": "boolean"},
                    },
                    "required": ["path", "old_text", "new_text"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": LOCAL_TOOL_BASH,
                "description": "Run a shell command in work_dir and return exit_code/stdout/stderr.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "timeout_secs": {"type": "integer", "minimum": 1, "maximum": LOCAL_TOOL_BASH_MAX_TIMEOUT_SECS},
                    },
                    "required": ["command"],
                    "additionalProperties": False,
                },
            },
        },
    ]


def parse_tool_arguments(raw_arguments: Any) -> dict[str, Any]:
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if isinstance(raw_arguments, str):
        try:
            parsed = json.loads(raw_arguments)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"invalid tool arguments JSON: {exc}") from exc
        if isinstance(parsed, dict):
            return parsed
    raise RuntimeError("tool arguments must be JSON object")


def model_likely_rejects_tools(error_message: str) -> bool:
    lower = error_message.lower()
    markers = (
        "tools",
        "tool_choice",
        "tool_calls",
        "function call",
        "unsupported",
        "unknown field",
        "invalid request",
    )
    return any(marker in lower for marker in markers)


def resolve_provider_routes(provider_chain: list[ProviderConfig]) -> tuple[list[ProviderRoute], list[str]]:
    routes: list[ProviderRoute] = []
    skipped: list[str] = []
    for provider in provider_chain:
        try:
            model = resolve_model_or_raise(provider)
        except RuntimeError as exc:
            skipped.append(f"{provider.name}: {exc}")
            continue
        routes.append(ProviderRoute(provider=provider, model=model))
    return routes, skipped


def call_with_failover(
    *,
    routes: list[ProviderRoute],
    messages: list[dict[str, str]],
    tool_context: LocalToolContext,
    policy: CircuitPolicy,
    enable_probe_recovery: bool,
) -> tuple[str, ProviderRoute, list[str]]:
    errors: list[str] = []
    for route in routes:
        is_open, open_until = circuit_is_open(route)
        if is_open:
            left_secs = int(max(open_until - time.time(), 0))
            errors.append(f"{route_display_name(route)}: circuit_open ({left_secs}s left)")
            continue

        if open_until > 0 and not is_open and enable_probe_recovery:
            ok, detail = probe_provider_health(route.provider)
            if not ok:
                state = circuit_get(route)
                state["open_until"] = time.time() + float(policy.cooldown_secs)
                errors.append(f"{route_display_name(route)}: recovery_probe_failed: {detail}")
                continue
            circuit_mark_success(route)

        try:
            reply = call_model_with_messages_or_raise(
                route.provider,
                route.model,
                messages,
                tool_context,
            )
            circuit_mark_success(route)
            return reply, route, errors
        except RuntimeError as exc:
            opened = circuit_mark_failure(route, policy)
            suffix = " (circuit_opened)" if opened else ""
            errors.append(f"{route_display_name(route)}: {exc}{suffix}")
            continue
    fail("All providers failed: " + " | ".join(errors[:3]))
    return "", routes[0], errors


def mask_secret(secret: str) -> str:
    if not secret:
        return "<empty>"
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}...{secret[-4:]}"


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_bind_address(bind: str) -> tuple[str, int]:
    host, sep, port_text = bind.rpartition(":")
    if sep == "" or not host or not port_text:
        fail(f'Invalid bind address "{bind}". Expected format: host:port')
    try:
        port = int(port_text)
    except ValueError:
        fail(f'Invalid port in bind address "{bind}"')
        return "", 0
    if port < 1 or port > 65535:
        fail(f'Port out of range in bind address "{bind}"')
    return host, port


def normalize_management_actions(raw_actions: Any) -> tuple[str, ...]:
    if not isinstance(raw_actions, (list, tuple)):
        return MANAGEMENT_ACTION_ALL

    normalized: list[str] = []
    for item in raw_actions:
        if not isinstance(item, str):
            continue
        token = item.strip().lower()
        if token in {"*", "all"}:
            return MANAGEMENT_ACTION_ALL
        if token in MANAGEMENT_ACTION_ALL and token not in normalized:
            normalized.append(token)
    return tuple(normalized)


def normalize_interrupt_prefixes(raw_prefixes: Any) -> tuple[str, ...]:
    if not isinstance(raw_prefixes, (list, tuple)):
        return ()
    normalized: list[str] = []
    for item in raw_prefixes:
        if not isinstance(item, str):
            continue
        prefix = item.strip()
        if prefix and prefix not in normalized:
            normalized.append(prefix)
    return tuple(normalized)


def normalize_config_sections(raw_sections: Any) -> tuple[str, ...] | None:
    if not isinstance(raw_sections, (list, tuple)):
        return None
    normalized: list[str] = []
    for item in raw_sections:
        if not isinstance(item, str):
            continue
        token = item.strip().lower()
        if token in {"*", "all"}:
            return None
        if token in CONFIG_SECTION_ALL and token not in normalized:
            normalized.append(token)
    return tuple(normalized)


def normalize_config_profile(raw_profile: Any) -> str | None:
    if not isinstance(raw_profile, str):
        return None
    normalized = raw_profile.strip().lower()
    return normalized if normalized else None


def normalize_policy_template(raw_template: Any) -> str | None:
    if not isinstance(raw_template, str):
        return None
    normalized = raw_template.strip().lower()
    return normalized if normalized else None


def resolve_management_policy_template(raw_template: Any, scope: str) -> dict[str, Any]:
    template = normalize_policy_template(raw_template)
    if template is None:
        return {}
    defaults = POLICY_TEMPLATE_DEFAULTS.get(template)
    if defaults is None:
        fail(
            f'Unknown policy template "{template}" for {scope}. '
            f"Supported: {', '.join(POLICY_TEMPLATE_ALL)}"
        )
    return defaults


def resolve_config_sections_by_profile(raw_profile: Any, scope: str) -> tuple[str, ...] | None:
    profile = normalize_config_profile(raw_profile)
    if profile is None:
        return None
    if profile not in CONFIG_PROFILE_SECTION_MAP:
        fail(
            f'Unknown config profile "{profile}" for {scope}. '
            f"Supported: {', '.join(CONFIG_PROFILE_ALL)}"
        )
    return CONFIG_PROFILE_SECTION_MAP[profile]


def build_management_credential(
    *,
    token: Any,
    source: str,
    name: str,
    raw_policy_template: Any = None,
    raw_actions: Any = None,
    raw_interrupt_prefixes: Any = None,
    raw_config_sections: Any = None,
    raw_config_profile: Any = None,
) -> ManagementCredential | None:
    if not isinstance(token, str) or not token.strip():
        return None
    template_defaults = resolve_management_policy_template(
        raw_policy_template,
        f'management credential "{name}"',
    )

    resolved_raw_actions = raw_actions
    if not isinstance(resolved_raw_actions, (list, tuple)):
        resolved_raw_actions = template_defaults.get("actions")

    resolved_raw_interrupt_prefixes = raw_interrupt_prefixes
    if not isinstance(resolved_raw_interrupt_prefixes, (list, tuple)):
        resolved_raw_interrupt_prefixes = template_defaults.get("interrupt_session_prefixes")

    resolved_raw_config_sections = raw_config_sections
    if not isinstance(resolved_raw_config_sections, (list, tuple)):
        resolved_raw_config_sections = template_defaults.get("config_sections")

    resolved_raw_config_profile = raw_config_profile
    if normalize_config_profile(resolved_raw_config_profile) is None:
        resolved_raw_config_profile = template_defaults.get("config_profile")

    actions = normalize_management_actions(resolved_raw_actions)
    config_sections = normalize_config_sections(resolved_raw_config_sections)
    # Explicit section list (including ["all"]) has higher priority than profile preset.
    if not isinstance(resolved_raw_config_sections, (list, tuple)):
        config_sections = resolve_config_sections_by_profile(
            resolved_raw_config_profile,
            f'management credential "{name}"',
        )

    return ManagementCredential(
        name=name,
        token=token.strip(),
        source=source,
        actions=actions,
        interrupt_session_prefixes=normalize_interrupt_prefixes(resolved_raw_interrupt_prefixes),
        config_sections=config_sections,
    )


def dedupe_management_credentials(credentials: list[ManagementCredential]) -> list[ManagementCredential]:
    deduped: list[ManagementCredential] = []
    for credential in credentials:
        if any(existing.token == credential.token for existing in deduped):
            continue
        deduped.append(credential)
    return deduped


def normalize_config_read_policy(raw_policy: Any) -> str | None:
    if not isinstance(raw_policy, str):
        return None
    normalized = raw_policy.strip().lower()
    if normalized in CONFIG_READ_POLICY_ALL:
        return normalized
    return None


def resolve_config_read_policy(
    config_toml: dict[str, Any],
    override_policy: str | None,
) -> tuple[str, str]:
    from_cli = normalize_config_read_policy(override_policy)
    if from_cli:
        return from_cli, "cli"

    from_env = normalize_config_read_policy(os.getenv("GROBOT_CONFIG_READ_POLICY"))
    if from_env:
        return from_env, "env"

    management_cfg = config_toml.get("management")
    if isinstance(management_cfg, dict):
        from_config = normalize_config_read_policy(management_cfg.get("config_read_policy"))
        if from_config:
            return from_config, "config"
    return CONFIG_READ_POLICY_AUTO, "default"


def resolve_public_config_sections(config_toml: dict[str, Any]) -> tuple[tuple[str, ...], str, str | None]:
    management_cfg = config_toml.get("management")
    if isinstance(management_cfg, dict):
        raw = management_cfg.get("public_config_sections")
        if isinstance(raw, list):
            parsed = normalize_config_sections(raw)
            if parsed is None:
                return CONFIG_SECTION_ALL, "config_sections_all", None
            return parsed, "config_sections", None

        profile_name = normalize_config_profile(management_cfg.get("public_config_profile"))
        if profile_name is not None:
            sections_from_profile = resolve_config_sections_by_profile(
                profile_name,
                "management.public_config_profile",
            )
            if sections_from_profile is None:
                return CONFIG_SECTION_ALL, "config_profile", profile_name
            return sections_from_profile, "config_profile", profile_name

    return DEFAULT_PUBLIC_CONFIG_SECTIONS, "default", CONFIG_PROFILE_OPERATOR


def is_loopback_host(host: str) -> bool:
    normalized = host.strip().lower()
    return normalized in {"127.0.0.1", "localhost", "::1"}


def resolve_effective_config_read_policy(configured_policy: str, bind_host: str) -> tuple[str, str]:
    if configured_policy == CONFIG_READ_POLICY_AUTO:
        if is_loopback_host(bind_host):
            return CONFIG_READ_POLICY_PUBLIC, "auto_loopback"
        return CONFIG_READ_POLICY_AUTH, "auto_non_loopback"
    return configured_policy, "explicit"


def apply_config_read_policy_state(state: dict[str, Any], bind_host: str) -> None:
    configured = state.get("config_read_policy_configured")
    if not isinstance(configured, str):
        configured = CONFIG_READ_POLICY_AUTO
    effective_policy, reason = resolve_effective_config_read_policy(configured, bind_host)
    state["config_read_policy"] = effective_policy
    state["config_read_policy_reason"] = reason


def mask_redis_url(redis_url: str | None) -> str | None:
    if not isinstance(redis_url, str) or not redis_url:
        return redis_url
    parsed = urlparse(redis_url)
    if parsed.scheme not in {"redis", "rediss"}:
        return redis_url
    if not parsed.password:
        return redis_url

    host = parsed.hostname or ""
    user = parsed.username or ""
    auth = f"{user}:{mask_secret(parsed.password)}@" if user else f":{mask_secret(parsed.password)}@"
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{auth}{host}{port}"
    return parsed._replace(netloc=netloc).geturl()


def resolve_management_credentials(
    config_toml: dict[str, Any],
    override_token: str | None,
) -> tuple[list[ManagementCredential], str]:
    if isinstance(override_token, str) and override_token.strip():
        credential = build_management_credential(
            token=override_token,
            source="cli",
            name="cli_override",
            raw_actions=list(MANAGEMENT_ACTION_ALL),
        )
        return ([credential] if credential else []), "cli"

    env_token = os.getenv("GROBOT_MANAGEMENT_TOKEN", "").strip()
    if env_token:
        credential = build_management_credential(
            token=env_token,
            source="env",
            name="env_token",
            raw_actions=list(MANAGEMENT_ACTION_ALL),
        )
        return ([credential] if credential else []), "env"

    management_cfg = config_toml.get("management")
    if not isinstance(management_cfg, dict):
        return [], "none"

    credentials: list[ManagementCredential] = []
    source_tokens: list[str] = []

    tokens_cfg = management_cfg.get("tokens")
    if isinstance(tokens_cfg, list):
        for index, item in enumerate(tokens_cfg):
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            credential = build_management_credential(
                token=item.get("token"),
                source="config_tokens",
                name=name if isinstance(name, str) and name.strip() else f"token_{index + 1}",
                raw_policy_template=item.get("policy_template"),
                raw_actions=item.get("actions"),
                raw_interrupt_prefixes=item.get("interrupt_session_prefixes"),
                raw_config_sections=item.get("config_sections"),
                raw_config_profile=item.get("config_profile"),
            )
            if credential is not None:
                credentials.append(credential)
        if credentials:
            source_tokens.append("config_tokens")

    single = build_management_credential(
        token=management_cfg.get("token"),
        source="config",
        name="management.token",
        raw_policy_template=management_cfg.get("policy_template"),
        raw_actions=management_cfg.get("actions"),
        raw_interrupt_prefixes=management_cfg.get("interrupt_session_prefixes"),
        raw_config_sections=management_cfg.get("config_sections"),
        raw_config_profile=management_cfg.get("config_profile"),
    )
    if single is not None:
        credentials.append(single)
        source_tokens.append("config")

    credentials = dedupe_management_credentials(credentials)
    if not credentials:
        return [], "none"
    return credentials, "+".join(source_tokens) if source_tokens else "config"


def get_management_bind(project_toml: dict[str, Any], bind_override: str | None) -> str:
    if bind_override:
        return bind_override

    gateway = project_toml.get("gateway")
    if isinstance(gateway, dict):
        management = gateway.get("management")
        if isinstance(management, dict):
            bind = management.get("bind")
            if isinstance(bind, str) and bind:
                return bind
    return "127.0.0.1:8080"


def summarize_provider_routing(project_toml: dict[str, Any]) -> dict[str, Any]:
    routing = project_toml.get("provider_routing")
    if not isinstance(routing, dict):
        return {
            "enabled": False,
            "reason": "provider_routing not configured in .grobot/project.toml",
        }

    groups_raw = routing.get("groups")
    groups_summary: list[dict[str, Any]] = []
    if isinstance(groups_raw, list):
        for group in groups_raw:
            if not isinstance(group, dict):
                continue
            targets_raw = group.get("targets")
            targets_summary: list[dict[str, Any]] = []
            if isinstance(targets_raw, list):
                for target in targets_raw:
                    if not isinstance(target, dict):
                        continue
                    provider = target.get("provider")
                    weight = target.get("weight")
                    if isinstance(provider, str) and provider:
                        targets_summary.append(
                            {
                                "provider": provider,
                                "weight": weight if isinstance(weight, int) else None,
                            }
                        )

            groups_summary.append(
                {
                    "name": group.get("name") if isinstance(group.get("name"), str) else None,
                    "model_class": group.get("model_class")
                    if isinstance(group.get("model_class"), str)
                    else None,
                    "targets": targets_summary,
                }
            )

    fallback_order = routing.get("fallback_order")
    fallback_summary = fallback_order if isinstance(fallback_order, list) else []
    default_group = routing.get("default_group") if isinstance(routing.get("default_group"), str) else None

    return {
        "enabled": True,
        "default_group": default_group,
        "fallback_order": fallback_summary,
        "groups": groups_summary,
    }


def build_management_status_payload(
    *,
    root: Path,
    project_toml: dict[str, Any],
    selection: ProjectSelection,
    session_key: str,
    bind: str,
) -> dict[str, Any]:
    session_cfg = project_toml.get("session")
    runtime_cfg = project_toml.get("runtime")
    gateway_cfg = project_toml.get("gateway")
    runtime_storage_cfg = runtime_cfg.get("storage") if isinstance(runtime_cfg, dict) else None

    management_enabled = None
    if isinstance(gateway_cfg, dict):
        management = gateway_cfg.get("management")
        if isinstance(management, dict):
            enabled = management.get("enabled")
            if isinstance(enabled, bool):
                management_enabled = enabled

    return {
        "status": "ok",
        "service": "grobot-management",
        "timestamp": now_utc_iso(),
        "endpoints": {
            "status": "/api/v1/status",
        },
        "repo": str(root),
        "project": {
            "name": selection.name,
            "schema_version": project_toml.get("schema_version"),
            "mode": project_toml.get("mode"),
        },
        "session": {
            "platform": selection.platform,
            "work_dir": str(selection.work_dir),
            "session_preview": session_key,
            "key_format": session_cfg.get("key_format") if isinstance(session_cfg, dict) else None,
            "heartbeat_secs": session_cfg.get("heartbeat_secs") if isinstance(session_cfg, dict) else None,
        },
        "provider": {
            "name": selection.provider.name,
            "base_url": selection.provider.base_url,
            "model_config": selection.provider.model,
            "api_key_masked": mask_secret(selection.provider.api_key),
        },
        "management_api": {
            "bind": bind,
            "enabled_in_project_toml": management_enabled,
        },
        "runtime": {
            "engine": runtime_cfg.get("engine") if isinstance(runtime_cfg, dict) else None,
            "target_concurrency": runtime_cfg.get("target_concurrency")
            if isinstance(runtime_cfg, dict)
            else None,
            "workers_per_node": runtime_cfg.get("workers_per_node") if isinstance(runtime_cfg, dict) else None,
            "hot_cache": runtime_storage_cfg.get("hot_cache")
            if isinstance(runtime_storage_cfg, dict)
            else None,
            "durable_state": runtime_storage_cfg.get("durable_state")
            if isinstance(runtime_storage_cfg, dict)
            else None,
        },
        "provider_routing": summarize_provider_routing(project_toml),
    }


def print_local_help() -> None:
    print("Local commands:")
    print("  /model    Show current provider/model/session info")
    print("  /health   Show provider circuit health")
    print("  @file     Mention a file/path in prompt for fast resolution")
    print("  /help     Show local commands")
    print("  /exit     Quit")
    print("")


def print_model_info(provider: ProviderConfig, model: str, work_dir: Path, session_key: str) -> None:
    print("Current model context:")
    print(f"  provider:  {provider.name}")
    print(f"  model:     {model}")
    print(f"  base_url:  {provider.base_url}")
    print(f"  work_dir:  {work_dir}")
    print(f"  session:   {session_key}")
    print("")


def format_route_chain(routes: list[ProviderRoute]) -> str:
    return " -> ".join(f"{route.provider.name}/{route.model}" for route in routes)


def summarize_errors(errors: list[str], limit: int = 2) -> str:
    if not errors:
        return ""
    preview = errors[:limit]
    suffix = "" if len(errors) <= limit else f" ... (+{len(errors) - limit} more)"
    return " | ".join(preview) + suffix


def mention_refresh_status_message(mention_index: MentionIndexState | MentionPathIndex | None) -> str | None:
    if not isinstance(mention_index, MentionIndexState):
        return None
    status = mention_index.last_refresh_status
    if status == "scheduled":
        return "index_refresh=scheduled_async"
    if status == "inflight":
        return "index_refresh=inflight"
    if status == "pending":
        return "index_refresh=pending_snapshot"
    if status == "applied":
        return "index_refresh=applied_snapshot"
    if status == "backoff":
        return "index_refresh=backoff_after_error"
    return None


def run_status(args: argparse.Namespace) -> int:
    root = repo_root()
    project_toml = load_toml(root / ".grobot" / "project.toml")
    config_path = root / ".grobot" / "config.toml"
    if args.config:
        config_path = Path(args.config).expanduser()

    config_toml = load_toml(config_path)
    selection = resolve_project(
        config=config_toml,
        project_name=args.project,
        work_dir_override=args.work_dir,
        override_provider=args.provider,
        override_api_key=args.api_key,
        override_base_url=args.base_url,
        override_model=args.model,
    )
    session_key = build_session_key(selection.name, selection.platform, selection.work_dir)
    session_store = resolve_session_store_config(
        project_toml=project_toml,
        root=root,
        session_backend_arg="auto",
        redis_url_arg=None,
        ttl_secs_arg=None,
    )

    print("Grobot status")
    print(f"  repo:              {root}")
    print(f"  config:            {config_path}")
    print(f"  project:           {selection.name}")
    print(f"  platform:          {selection.platform}")
    print(f"  work_dir:          {selection.work_dir}")
    print(f"  provider:          {selection.provider.name}")
    print(f"  base_url:          {selection.provider.base_url}")
    print(f"  model_config:      {selection.provider.model}")
    print(f"  api_key:           {mask_secret(selection.provider.api_key)}")
    print(f"  session_preview:   {session_key}")
    print(f"  session_store:     {session_store.backend} (ttl={session_store.ttl_secs}s)")

    if not args.probe:
        print("  probe:             skipped (use --probe to verify /models)")
        return 0

    resolved_model = resolve_model(selection.provider)
    print(f"  probe:             ok")
    print(f"  model_resolved:    {resolved_model}")
    return 0


def run_serve(args: argparse.Namespace) -> int:
    root = repo_root()
    project_path = root / ".grobot" / "project.toml"
    config_path = root / ".grobot" / "config.toml"
    if args.config:
        config_path = Path(args.config).expanduser()

    def build_runtime_state() -> dict[str, Any]:
        project_toml = load_toml(project_path)
        config_toml = load_toml(config_path)
        project_cfg = find_project(config_toml, args.project)
        selection = resolve_project(
            config=config_toml,
            project_name=args.project,
            work_dir_override=args.work_dir,
            override_provider=args.provider,
            override_api_key=args.api_key,
            override_base_url=args.base_url,
            override_model=args.model,
        )
        provider_pool = resolve_provider_pool(
            project=project_cfg,
            selected=selection.provider,
            override_api_key=args.api_key,
            override_base_url=args.base_url,
            override_model=args.model,
        )
        provider_chain = build_provider_failover_chain(
            project_toml=project_toml,
            provider_pool=provider_pool,
            selected_provider=selection.provider,
            provider_forced=bool(args.provider),
        )
        session_key = build_session_key(selection.name, selection.platform, selection.work_dir)
        session_store = resolve_session_store_config(
            project_toml=project_toml,
            root=root,
            session_backend_arg=args.session_backend,
            redis_url_arg=args.redis_url,
            ttl_secs_arg=args.session_ttl_secs,
        )
        management_credentials, management_auth_source = resolve_management_credentials(
            config_toml, args.management_token
        )
        config_read_policy_configured, config_read_policy_source = resolve_config_read_policy(
            config_toml, args.config_read_policy
        )
        (
            public_config_sections,
            public_config_sections_source,
            public_config_sections_profile,
        ) = resolve_public_config_sections(config_toml)
        return {
            "project_toml": project_toml,
            "config_toml": config_toml,
            "selection": selection,
            "session_key": session_key,
            "bind": get_management_bind(project_toml, args.bind),
            "provider_chain": provider_chain,
            "session_store": session_store,
            "management_credentials": management_credentials,
            "management_auth_source": management_auth_source,
            "config_read_policy_configured": config_read_policy_configured,
            "config_read_policy_source": config_read_policy_source,
            "public_config_sections": public_config_sections,
            "public_config_sections_source": public_config_sections_source,
            "public_config_sections_profile": public_config_sections_profile,
        }

    state = build_runtime_state()
    state["reload_count"] = 0
    state["reload_warning"] = None
    host, port = parse_bind_address(state["bind"])
    state["bind_runtime"] = f"{host}:{port}"
    apply_config_read_policy_state(state, host)

    def state_status_payload() -> dict[str, Any]:
        payload = build_management_status_payload(
            root=root,
            project_toml=state["project_toml"],
            selection=state["selection"],
            session_key=state["session_key"],
            bind=state["bind_runtime"],
        )
        payload["endpoints"] = {
            "status": "/api/v1/status",
            "config": "/api/v1/config",
            "reload": "/api/v1/reload",
            "session_interrupt": "/api/v1/sessions/{id}/interrupt",
            "healthz": "/healthz",
        }
        payload["reload_count"] = state["reload_count"]
        payload["session_store"] = {
            "backend": state["session_store"].backend,
            "ttl_secs": state["session_store"].ttl_secs,
        }
        payload["provider_failover"] = {
            "chain": [f"{provider.name}/{provider.model}" for provider in state["provider_chain"]],
        }
        management_credentials = state["management_credentials"]
        acl_enabled = any(
            (
                set(credential.actions) != set(MANAGEMENT_ACTION_ALL)
                or bool(credential.interrupt_session_prefixes)
                or (credential.config_sections is not None)
            )
            for credential in management_credentials
        )
        payload["management_auth"] = {
            "enabled": bool(management_credentials),
            "source": state["management_auth_source"],
            "credential_count": len(management_credentials),
            "acl_enabled": acl_enabled,
            "config_read_policy": state["config_read_policy"],
            "config_read_policy_configured": state["config_read_policy_configured"],
            "config_read_policy_source": state["config_read_policy_source"],
            "config_read_policy_reason": state["config_read_policy_reason"],
            "public_config_sections": list(state["public_config_sections"]),
            "public_config_sections_source": state["public_config_sections_source"],
            "public_config_sections_profile": state["public_config_sections_profile"],
            "config_endpoint_requires_auth": state["config_read_policy"] == CONFIG_READ_POLICY_AUTH,
            "config_endpoint_disabled": state["config_read_policy"] == CONFIG_READ_POLICY_DISABLED,
            "write_headers": ["Authorization: Bearer <token>", "X-Grobot-Token: <token>"],
            "protected_endpoints": [
                "POST /api/v1/reload",
                "POST /api/v1/sessions/{id}/interrupt",
            ],
        }
        if isinstance(state.get("reload_warning"), str) and state["reload_warning"]:
            payload["reload_warning"] = state["reload_warning"]
        return payload

    def state_config_payload(visible_sections: tuple[str, ...] | None) -> dict[str, Any]:
        selection: ProjectSelection = state["selection"]
        payload: dict[str, Any] = {
            "status": "ok",
            "timestamp": now_utc_iso(),
            "reload_count": state["reload_count"],
            "management_auth": {
                "credential_count": len(state["management_credentials"]),
                "config_read_policy": state["config_read_policy"],
                "config_read_policy_configured": state["config_read_policy_configured"],
                "config_read_policy_source": state["config_read_policy_source"],
                "config_read_policy_reason": state["config_read_policy_reason"],
                "public_config_sections": list(state["public_config_sections"]),
                "public_config_sections_source": state["public_config_sections_source"],
                "public_config_sections_profile": state["public_config_sections_profile"],
            },
        }

        sections: dict[str, Any] = {
            CONFIG_SECTION_PATHS: {
                "project_toml": str(project_path),
                "config_toml": str(config_path),
            },
            CONFIG_SECTION_SELECTION: {
                "project": selection.name,
                "platform": selection.platform,
                "work_dir": str(selection.work_dir),
                "session_preview": state["session_key"],
                "provider": selection.provider.name,
            },
            CONFIG_SECTION_SESSION_STORE: {
                "backend": state["session_store"].backend,
                "ttl_secs": state["session_store"].ttl_secs,
                "redis_url": mask_redis_url(state["session_store"].redis_url),
            },
            CONFIG_SECTION_PROJECT_TOML: mask_sensitive_object(state["project_toml"]),
            CONFIG_SECTION_CONFIG_TOML: mask_sensitive_object(state["config_toml"]),
        }

        allowed_sections = set(CONFIG_SECTION_ALL if visible_sections is None else visible_sections)
        for section_key in CONFIG_SECTION_ALL:
            if section_key in allowed_sections:
                payload[section_key] = sections[section_key]

        payload["visible_sections"] = sorted([section for section in CONFIG_SECTION_ALL if section in allowed_sections])
        return payload

    def apply_reload() -> dict[str, Any]:
        old_bind = state["bind_runtime"]
        old_host, _ = parse_bind_address(old_bind)
        reloaded = build_runtime_state()
        reloaded["reload_count"] = int(state["reload_count"]) + 1
        reloaded["bind_runtime"] = old_bind
        reloaded["reload_warning"] = None
        if reloaded["bind"] != old_bind:
            reloaded["reload_warning"] = (
                f"configured bind changed to {reloaded['bind']}, "
                f"but runtime bind remains {old_bind}; restart required"
            )

        state.clear()
        state.update(reloaded)
        apply_config_read_policy_state(state, old_host)
        return {
            "status": "ok",
            "timestamp": now_utc_iso(),
            "reload_count": state["reload_count"],
            "runtime_bind": old_bind,
            "configured_bind": state["bind"],
            "warning": state["reload_warning"],
        }

    class ManagementHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *handler_args: Any) -> None:  # noqa: A003
            return

        def _request_management_token(self) -> str | None:
            authorization = self.headers.get("Authorization")
            if isinstance(authorization, str):
                parts = authorization.strip().split(None, 1)
                if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
                    return parts[1].strip()

            legacy = self.headers.get("X-Grobot-Token")
            if isinstance(legacy, str) and legacy.strip():
                return legacy.strip()
            return None

        def _match_management_credential(self, provided_token: str) -> ManagementCredential | None:
            credentials = state.get("management_credentials")
            if not isinstance(credentials, list):
                return None
            for credential in credentials:
                if not isinstance(credential, ManagementCredential):
                    continue
                if hmac.compare_digest(provided_token, credential.token):
                    return credential
            return None

        def _require_management_auth(
            self,
            action: str,
            session_id: str | None = None,
        ) -> ManagementCredential | None:
            credentials = state.get("management_credentials")
            if not isinstance(credentials, list) or not credentials:
                self._write_json(
                    503,
                    {
                        "error": "management_token_not_configured",
                        "detail": (
                            "Set [management].token or [[management.tokens]] in config, "
                            "or use GROBOT_MANAGEMENT_TOKEN / --management-token"
                        ),
                    },
                )
                return None

            provided = self._request_management_token()
            if not provided:
                self._write_json(
                    401,
                    {
                        "error": "management_auth_required",
                        "detail": "Missing Authorization: Bearer <token> or X-Grobot-Token header",
                    },
                )
                return None

            credential = self._match_management_credential(provided)
            if credential is None:
                self._write_json(403, {"error": "management_auth_invalid"})
                return None

            if action not in credential.actions:
                self._write_json(
                    403,
                    {
                        "error": "management_acl_denied",
                        "detail": f'credential "{credential.name}" does not allow action "{action}"',
                    },
                )
                return None

            if (
                action == MANAGEMENT_ACTION_INTERRUPT
                and isinstance(session_id, str)
                and credential.interrupt_session_prefixes
                and not any(session_id.startswith(prefix) for prefix in credential.interrupt_session_prefixes)
            ):
                self._write_json(
                    403,
                    {
                        "error": "management_acl_denied",
                        "detail": (
                            f'credential "{credential.name}" cannot interrupt session "{session_id}" '
                            "by interrupt_session_prefixes"
                        ),
                    },
                )
                return None
            return credential

        def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict[str, Any]:
            length_text = self.headers.get("Content-Length", "0")
            try:
                length = int(length_text)
            except ValueError:
                raise ValueError("Invalid Content-Length header")
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            if not raw:
                return {}
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON body: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError("JSON body must be an object")
            return parsed

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/api/v1/status":
                query = parse_qs(parsed.query)
                payload = state_status_payload()
                payload["timestamp"] = now_utc_iso()
                payload["request"] = {
                    "path": parsed.path,
                    "query": query,
                }
                self._write_json(200, payload)
                return
            if parsed.path == "/api/v1/config":
                policy = state.get("config_read_policy")
                if policy == CONFIG_READ_POLICY_DISABLED:
                    self._write_json(404, {"error": "not_found", "path": parsed.path})
                    return
                visible_sections: tuple[str, ...] | None = None
                if policy == CONFIG_READ_POLICY_AUTH:
                    credential = self._require_management_auth(MANAGEMENT_ACTION_CONFIG_READ)
                    if credential is None:
                        return
                    visible_sections = credential.config_sections
                elif policy == CONFIG_READ_POLICY_PUBLIC:
                    public_sections = state.get("public_config_sections")
                    if isinstance(public_sections, tuple):
                        visible_sections = public_sections
                payload = state_config_payload(visible_sections)
                payload["request"] = {"path": parsed.path}
                self._write_json(200, payload)
                return
            if parsed.path == "/healthz":
                self._write_json(200, {"status": "ok", "timestamp": now_utc_iso()})
                return
            self._write_json(404, {"error": "not_found", "path": parsed.path})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/api/v1/reload":
                credential = self._require_management_auth(MANAGEMENT_ACTION_RELOAD)
                if credential is None:
                    return
                try:
                    payload = apply_reload()
                except Exception as exc:  # noqa: BLE001
                    self._write_json(500, {"error": "reload_failed", "detail": str(exc)})
                    return
                self._write_json(200, payload)
                return

            match = re.fullmatch(r"/api/v1/sessions/(.+)/interrupt", parsed.path)
            if match:
                session_id = unquote(match.group(1)).strip()
                if not session_id:
                    self._write_json(400, {"error": "invalid_session_id"})
                    return
                credential = self._require_management_auth(MANAGEMENT_ACTION_INTERRUPT, session_id=session_id)
                if credential is None:
                    return

                ttl_secs = state["session_store"].ttl_secs
                try:
                    body = self._read_json()
                    ttl_from_body = body.get("ttl_secs")
                    if isinstance(ttl_from_body, int) and ttl_from_body > 0:
                        ttl_secs = ttl_from_body
                except ValueError as exc:
                    self._write_json(400, {"error": "invalid_json", "detail": str(exc)})
                    return

                warnings = set_interrupt_flag(state["session_store"], session_id, ttl_secs)
                self._write_json(
                    200,
                    {
                        "status": "ok",
                        "timestamp": now_utc_iso(),
                        "session_id": session_id,
                        "ttl_secs": ttl_secs,
                        "backend": state["session_store"].backend,
                        "warnings": warnings,
                    },
                )
                return

            self._write_json(404, {"error": "not_found", "path": parsed.path})

    server = ThreadingHTTPServer((host, port), ManagementHandler)
    print("Grobot management API started")
    print(f"  bind:      http://{host}:{port}")
    print("  endpoint:  GET /api/v1/status")
    print("  endpoint:  GET /api/v1/config")
    print("  endpoint:  POST /api/v1/reload")
    print("  endpoint:  POST /api/v1/sessions/{id}/interrupt")
    print("  healthz:   GET /healthz")
    credential_count = len(state["management_credentials"]) if isinstance(state["management_credentials"], list) else 0
    print(
        f"  auth:      {'enabled' if credential_count > 0 else 'disabled'} "
        f"({state['management_auth_source']}, credentials={credential_count})"
    )
    print(
        "  cfg_read:  "
        f"{state['config_read_policy']} "
        f"(configured={state['config_read_policy_configured']}, reason={state['config_read_policy_reason']})"
    )
    print(
        "  cfg_view:  "
        f"public_sections={list(state['public_config_sections'])} "
        f"(source={state['public_config_sections_source']}, "
        f"profile={state['public_config_sections_profile'] or 'none'})"
    )
    if credential_count > 0:
        print("  auth_hdr:  Authorization: Bearer <token> (or X-Grobot-Token)")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping management API...")
    finally:
        server.server_close()
    return 0


def run_start(args: argparse.Namespace) -> int:
    root = repo_root()
    project_toml = load_toml(root / ".grobot" / "project.toml")
    config_path = root / ".grobot" / "config.toml"
    if args.config:
        config_path = Path(args.config).expanduser()
    config_toml = load_toml(config_path)
    project_cfg = find_project(config_toml, args.project)

    selection = resolve_project(
        config=config_toml,
        project_name=args.project,
        work_dir_override=args.work_dir,
        override_provider=args.provider,
        override_api_key=args.api_key,
        override_base_url=args.base_url,
        override_model=args.model,
    )
    provider_pool = resolve_provider_pool(
        project=project_cfg,
        selected=selection.provider,
        override_api_key=args.api_key,
        override_base_url=args.base_url,
        override_model=args.model,
    )
    provider_chain = build_provider_failover_chain(
        project_toml=project_toml,
        provider_pool=provider_pool,
        selected_provider=selection.provider,
        provider_forced=bool(args.provider),
    )
    routes, route_skips = resolve_provider_routes(provider_chain)
    if not routes:
        fail("No available provider route. " + summarize_errors(route_skips, limit=3))
    active_route = routes[0]
    session_key = build_session_key(selection.name, selection.platform, selection.work_dir)
    session_store = resolve_session_store_config(
        project_toml=project_toml,
        root=root,
        session_backend_arg=args.session_backend,
        redis_url_arg=args.redis_url,
        ttl_secs_arg=args.session_ttl_secs,
    )
    history_messages, restore_source, store_read_warnings = load_history_from_store(
        session_store,
        session_key,
        args.history_turns,
    )
    local_tool_context = resolve_local_tool_context(project_toml, selection.work_dir)
    mention_index: MentionIndexState | MentionPathIndex | None = None
    system_prompt = build_system_prompt(session_key=session_key, work_dir=selection.work_dir)
    circuit_policy = CircuitPolicy(
        failure_threshold=max(1, args.circuit_failures),
        cooldown_secs=max(1, args.circuit_cooldown_secs),
    )

    print("Grobot started")
    print(f"  repo:      {root}")
    print(f"  project:   {selection.name}")
    print(f"  platform:  {selection.platform}")
    print(f"  work_dir:  {selection.work_dir}")
    print(f"  provider:  {active_route.provider.name}")
    print(f"  model:     {active_route.model}")
    print(f"  failover:  {format_route_chain(routes)}")
    print(f"  session:   {session_key}")
    print(f"  store:     {session_store.backend} (ttl={session_store.ttl_secs}s)")
    print(f"  tools:     {', '.join(local_tool_context.allow_tokens)}")
    print(
        f"  circuit:   threshold={circuit_policy.failure_threshold}, cooldown={circuit_policy.cooldown_secs}s, "
        f"probe_recovery={'on' if not args.no_probe_recovery else 'off'}"
    )
    if history_messages:
        print(f"  restored:  {len(history_messages) // 2} turns from {restore_source}")
    if route_skips:
        print(f"  skipped:   {summarize_errors(route_skips)}")
    for warning in store_read_warnings:
        print(f"[store] {warning}", file=sys.stderr)
    print("")

    if args.message:
        interrupted, interrupt_warnings = consume_interrupt_flag(session_store, session_key)
        for warning in interrupt_warnings:
            print(f"[interrupt] {warning}", file=sys.stderr)
        if interrupted:
            print(
                "Session interrupted by management API. This request was skipped; send again if needed.",
                file=sys.stderr,
            )
            return 0

        effective_prompt, mention_lines, mention_index = enrich_user_prompt_with_file_mentions(
            args.message,
            local_tool_context,
            mention_index,
        )
        for line in mention_lines:
            print(f"[mentions] {line}", file=sys.stderr)
        refresh_message = mention_refresh_status_message(mention_index)
        if refresh_message:
            print(f"[mentions] {refresh_message}", file=sys.stderr)

        messages = build_chat_messages(
            system_prompt=system_prompt,
            history_messages=history_messages,
            user_prompt=effective_prompt,
            max_history_turns=args.history_turns,
        )
        reply, used_route, errors = call_with_failover(
            routes=routes,
            messages=messages,
            tool_context=local_tool_context,
            policy=circuit_policy,
            enable_probe_recovery=not args.no_probe_recovery,
        )
        active_route = used_route
        if errors:
            print(f"[failover] {summarize_errors(errors)}", file=sys.stderr)
        history_messages.extend(
            [
                {"role": "user", "content": args.message},
                {"role": "assistant", "content": reply},
            ]
        )
        history_messages = trim_history_messages(history_messages, args.history_turns)
        save_warnings = save_history_to_store(session_store, session_key, history_messages, args.history_turns)
        for warning in save_warnings:
            print(f"[store] {warning}", file=sys.stderr)
        print(reply)
        return 0

    print("Enter message (`/model`, `/health`, `/help`, `/exit`):")
    while True:
        try:
            user_input = input("grobot> ").strip()
        except EOFError:
            print("")
            break
        except KeyboardInterrupt:
            print("\nInterrupted")
            break

        if not user_input:
            continue
        if user_input in {"/exit", "exit", "quit"}:
            break
        if user_input == "/help":
            print_local_help()
            continue
        if user_input == "/model":
            print_model_info(active_route.provider, active_route.model, selection.work_dir, session_key)
            print(f"  failover:  {format_route_chain(routes)}")
            print(f"  store:     {session_store.backend} (ttl={session_store.ttl_secs}s)")
            print("")
            continue
        if user_input == "/health":
            print("Circuit health:")
            for line in format_circuit_health(routes):
                print(line)
            print("")
            continue

        interrupted, interrupt_warnings = consume_interrupt_flag(session_store, session_key)
        for warning in interrupt_warnings:
            print(f"[interrupt] {warning}")
        if interrupted:
            print("Session interrupted by management API. Current input skipped.")
            print("")
            continue

        effective_prompt, mention_lines, mention_index = enrich_user_prompt_with_file_mentions(
            user_input,
            local_tool_context,
            mention_index,
        )
        for line in mention_lines:
            print(f"[mentions] {line}")
        refresh_message = mention_refresh_status_message(mention_index)
        if refresh_message:
            print(f"[mentions] {refresh_message}")

        messages = build_chat_messages(
            system_prompt=system_prompt,
            history_messages=history_messages,
            user_prompt=effective_prompt,
            max_history_turns=args.history_turns,
        )
        reply, used_route, errors = call_with_failover(
            routes=routes,
            messages=messages,
            tool_context=local_tool_context,
            policy=circuit_policy,
            enable_probe_recovery=not args.no_probe_recovery,
        )
        active_route = used_route
        if errors:
            print(f"[failover] {summarize_errors(errors)}")
        history_messages.extend(
            [
                {"role": "user", "content": user_input},
                {"role": "assistant", "content": reply},
            ]
        )
        history_messages = trim_history_messages(history_messages, args.history_turns)
        save_warnings = save_history_to_store(session_store, session_key, history_messages, args.history_turns)
        for warning in save_warnings:
            print(f"[store] {warning}")
        print(reply)
        print("")

    _ = project_toml.get("schema_version")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Grobot local launcher")
    sub = parser.add_subparsers(dest="command")

    status = sub.add_parser("status", help="Show grobot runtime status")
    status.add_argument("--project", help="Project name in .grobot/config.toml")
    status.add_argument("--work-dir", help="Override target work directory")
    status.add_argument("--config", help="Path to runtime config.toml")
    status.add_argument("--provider", help="Provider name from [projects.agent.providers]")
    status.add_argument("--api-key", help="Override API key")
    status.add_argument("--base-url", help="Override OpenAI-compatible base URL")
    status.add_argument("--model", help="Override model id (or auto)")
    status.add_argument("--probe", action="store_true", help="Call provider /models to verify connectivity")
    status.set_defaults(func=run_status)

    serve = sub.add_parser("serve", help="Run management API server")
    serve.add_argument("--project", help="Project name in .grobot/config.toml")
    serve.add_argument("--work-dir", help="Override target work directory")
    serve.add_argument("--config", help="Path to runtime config.toml")
    serve.add_argument("--provider", help="Provider name from [projects.agent.providers]")
    serve.add_argument("--api-key", help="Override API key")
    serve.add_argument("--base-url", help="Override OpenAI-compatible base URL")
    serve.add_argument("--model", help="Override model id (or auto)")
    serve.add_argument("--bind", help="Override management bind, e.g. 127.0.0.1:8080")
    serve.add_argument(
        "--management-token",
        help="Override management token for management endpoints (reload/interrupt/config_read)",
    )
    serve.add_argument(
        "--config-read-policy",
        choices=["auto", "public", "auth", "disabled"],
        help="Policy for GET /api/v1/config: auto/public/auth/disabled",
    )
    serve.add_argument(
        "--session-backend",
        choices=["auto", "redis", "file"],
        default="auto",
        help="Session persistence backend for management operations",
    )
    serve.add_argument("--redis-url", help="Redis URL for management operations")
    serve.add_argument("--session-ttl-secs", type=int, help="Session TTL seconds for management operations")
    serve.set_defaults(func=run_serve)

    start = sub.add_parser("start", help="Start grobot session")
    start.add_argument("--project", help="Project name in .grobot/config.toml")
    start.add_argument("--work-dir", help="Override target work directory")
    start.add_argument("--message", help="Run one-shot message and exit")
    start.add_argument("--config", help="Path to runtime config.toml")
    start.add_argument("--provider", help="Provider name from [projects.agent.providers]")
    start.add_argument("--api-key", help="Override API key")
    start.add_argument("--base-url", help="Override OpenAI-compatible base URL")
    start.add_argument("--model", help="Override model id (or auto)")
    start.add_argument("--history-turns", type=int, default=12, help="Max retained turns for context replay")
    start.add_argument(
        "--session-backend",
        choices=["auto", "redis", "file"],
        default="auto",
        help="Session persistence backend",
    )
    start.add_argument("--redis-url", help="Redis URL, e.g. redis://127.0.0.1:6379/0")
    start.add_argument("--session-ttl-secs", type=int, help="Session TTL seconds for persistence")
    start.add_argument("--circuit-failures", type=int, default=2, help="Failures before opening circuit")
    start.add_argument("--circuit-cooldown-secs", type=int, default=30, help="Circuit open cooldown seconds")
    start.add_argument(
        "--no-probe-recovery",
        action="store_true",
        help="Disable recovery probe (/models) before re-entering an open circuit",
    )
    start.set_defaults(func=run_start)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return 1
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
