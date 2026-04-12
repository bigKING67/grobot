# Gateway Skeleton

TypeScript gateway skeleton for Grobot.

## Current Scope

1. Canonical `SessionKey` parsing/building.
2. Turn request shape for runtime dispatch.
3. Runtime event envelope shape for channel streaming.
4. Management status endpoint (`GET /api/v1/status`) via `grobot serve`.
5. Management config endpoint (`GET /api/v1/config`) with sensitive-field masking.
6. Management hot reload endpoint (`POST /api/v1/reload`).
7. Management session interrupt endpoint (`POST /api/v1/sessions/{id}/interrupt`).
8. Provider failover with session-history replay (`grobot start`).
9. Session persistence backend (`file` / `redis`).
10. Provider health probe + circuit breaker recovery.
11. Management write-endpoint auth for `reload` / `interrupt` (Bearer token or `X-Grobot-Token`).
12. Management write-endpoint ACL (`[[management.tokens]]`: action allow-list + interrupt session prefix limits).
13. Management config read policy for `GET /api/v1/config` (`auto/public/auth/disabled` + CLI/env/config override).
14. Field-level config visibility ACL (`config_sections` / `public_config_sections`).
15. Built-in config-view profiles (`operator` / `auditor` / `admin`) for faster role setup.
16. Built-in management policy templates (`policy_template`: `ops_read_only` / `audit_read` / `full_admin`).
17. Python unit tests for management policy-template defaults and precedence (`gateway/tests/test_management_policy_templates.py`).
18. Local tool execution for `list` / `glob` / `search` / `read` / `write` / `edit` / `bash` in `grobot start` (OpenAI-compatible `tools` loop, `fd/rg` preferred with Python fallback, `search` supports context lines, and `@file` mention pre-resolution is injected into prompt).
19. `@file` mention index acceleration: in-memory file-path index with incremental refresh (added/removed diff) and trigram-based candidate selection for large repositories.
20. End-to-end smoke test for `grobot start` tool-calling flow (`gateway/tests/test_start_tool_smoke.py`).
21. Agent-level eval harness v0 (`gateway/evals`): optimization/holdout split, multi-variant scoring, gate enforcement, and holdout regression guard.
22. Trace mining bootstrap (`gateway/evals/trace_mining.py`): auto-generate eval datasets from local session traces.
23. Hill-climbing selector (`gateway/evals/hill_climb.py`): choose best variant by optimization gain under holdout non-regression constraints.
24. CI gate mode (`runner --fail-on-gate`): fail-fast with non-zero exit when any gate/regression guard fails.
25. Trace cleaning pipeline (`gateway/evals/trace_clean.py`): mined dataset dedupe/redaction plus review report generation.
26. GitHub Actions gate workflow (`.github/workflows/harness-gate.yml`): runs `npm run check` + `npm run harness:gate:ci`.
27. Unified trace pipeline (`gateway/evals/trace_pipeline.py`): one command with tunable mining/cleaning params.
28. TS migration skeleton for Agent Loop v2 (`context -> runtime -> verify -> persist`) with optional shadow comparison.
29. TS migration options resolver (`gateway_impl` / `runtime_impl` / `shadow_mode`) for dual-track rollout.
30. Python CLI execution-plane resolver (`CLI > env > .grobot/project.toml > default`) with `gateway_impl` / `runtime_impl` / `shadow_mode`.
31. Management status exposure for execution plane in `GET /api/v1/status` (`execution_plane` + per-field source).
32. TS bridge CLI (`gateway/src/bridge-cli.ts`) wired into Python `start` path when `gateway_impl=ts`, using Rust stdio runtime when `runtime_impl=rust`.
33. Gateway TypeScript compile gate via `gateway/tsconfig.json`.
34. TS dev CLI fallback (`gateway/src/dev-cli.ts`) for source-checkout launcher path: `status`, `serve --gateway-impl ts --ts-dev-cli`, and `start --message --gateway-impl ts`.
35. TS `serve --ts-dev-cli` currently exposes `GET /api/v1/status`, `GET /api/v1/config` (auth + masked), `GET /healthz`, `POST /api/v1/reload`, `POST /api/v1/sessions/{id}/interrupt`, `POST /api/v1/mcp/reset`, `POST /api/v1/mcp/servers/{name}/reset`, `GET /api/v1/sessions/{id}/memory`, `GET /api/v1/sessions/{id}/memory/export`, `POST /api/v1/sessions/{id}/memory/import`, `POST /api/v1/sessions/{id}/memory/forget`, `POST /api/v1/sessions/{id}/memory/lifecycle`, and `POST /api/v1/memory/lifecycle/run`.
36. TS `serve --ts-dev-cli` is still a migration subset; full policy template/ACL matrix and durable memory backend parity remain on Python management server.
37. TS memory store backend selection now supports `file` (default) and `redis` (via `--session-store redis` / `GROBOT_SESSION_STORE=redis` / `[runtime.storage].hot_cache=redis`). Status endpoint reports selected backend, Redis key, and fallback reason when Redis bootstrap fails and it falls back to file.
38. TS `serve --ts-dev-cli` now honors config read policy precedence for `GET /api/v1/config` (`--config-read-policy` > `GROBOT_CONFIG_READ_POLICY` > `[management].config_read_policy` > `auto`), with `auto` resolving by bind host (loopback=`public`, non-loopback=`auth`).
39. TS Redis memory store uses a minimal RESP2 client over `node:net` (currently `AUTH`/`SELECT`/`GET`/`SET EX` on `redis://`). `rediss://` is not supported in TS dev CLI yet; when Redis bootstrap fails, runtime falls back to file store and exposes `fallback_reason` in `/api/v1/status`.
40. `POST /api/v1/reload` now refreshes memory store runtime config as well (`file/redis`, source, fallback reason) and reloads in-memory session map from the resolved backend.

## Verification

Run gateway Python checks:

```bash
python3 gateway/tests/test_management_policy_templates.py
python3 gateway/tests/test_local_tools.py
python3 gateway/tests/test_start_tool_smoke.py
python3 gateway/tests/test_agent_harness.py
python3 gateway/tests/test_trace_mining.py
python3 gateway/tests/test_trace_clean.py
python3 gateway/tests/test_hill_climb.py
```

Sample harness run:

```bash
python3 gateway/evals/runner.py \
  --cases gateway/evals/fixtures/cases.sample.jsonl \
  --runs gateway/evals/fixtures/runs.sample.jsonl \
  --gate-policy gateway/evals/gate_policy.default.json \
  --output /tmp/grobot-harness-report.json
```

CI gate mode:

```bash
python3 gateway/evals/runner.py \
  --cases gateway/evals/fixtures/cases.sample.jsonl \
  --runs gateway/evals/fixtures/runs.sample.jsonl \
  --gate-policy gateway/evals/gate_policy.default.json \
  --fail-on-gate
```

## Next Steps

1. Add inbound adapter normalization for Feishu and Telegram.
2. Add retry/circuit handling for Rust runtime stdio client (currently single-shot call).
3. Replace placeholder Rust turn implementation with real model+tool execution pipeline.
