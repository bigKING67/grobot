# Gateway Skeleton

TypeScript gateway skeleton for Grobot.

版本号规范见根文档 [`../README.md`](../README.md#版本号规范)；Gateway 不单独定义产品版本，统一使用根 `package.json.version` 与 `runtime/Cargo.toml` 对齐后的版本。

## Architecture Positioning

Gateway follows a `4 execution layers + 1 governance plane` structure:

1. `models` (`gateway/src/models`): canonical data shapes and session/context modeling.
2. `tools` (`gateway/src/tools`): runtime/tool adapters and persistence-side executors.
3. `extensions` (`gateway/src/extensions`): cross-boundary bridge/contracts and external integration entrypoints.
4. `orchestration` (`gateway/src/orchestration`): command entrypoints and runtime orchestration flow.
5. `governance` (`gateway/src/governance`): evaluation/testing/auto-optimization loop (policy gates, regression checks, report generation).

Governance plane is intentionally separated from the request hot path. It drives quality control and iterative optimization, not online turn execution.

## Layer Directory Contract (Gateway)

1. 职责
   - Gateway 负责模型/工具/扩展/编排的入口装配与管理 API，不承载 Runtime 的重执行逻辑。
   - 治理平面负责评测、回归、优化闭环，保持与在线热路径解耦。
2. 边界约束
   - `gateway/src/tools/*` 以适配器与状态管理为主；工具核心执行逻辑归 `runtime/src/tools/*`。
   - `gateway/src/orchestration/*` 负责 CLI/serve/start 流程组织；模型与工具执行细节不下沉到此层。
   - `gateway/src/governance/*` 与 `gateway/evals/*` 共同组成治理平面，不与在线请求链路混写。
3. 新增模块流程
   - 先确定层边界，再在对应层目录新增能力文件；避免跨层“就近塞代码”。
   - 涉及治理能力时，必须同步更新 `gateway/evals/README.md` 的策略与运行入口说明。
4. 评审检查点
   - 是否出现 runtime 执行逻辑误入 gateway tools/orchestration。
   - 是否出现治理代码侵入 `start/serve` 热路径。
   - 是否保持管理 API、契约测试与文档一致。

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
17. Node contract checks for management policy-template defaults and execution smoke (`gateway/tests/check-gateway-node.mjs`).
18. Local tool execution for `list` / `glob` / `search` / `read` / `write` / `edit` / `semantic_search` / `prompt_enhancer` / `bash` in `grobot start` (OpenAI-compatible `tools` loop, `fd/rg` preferred with built-in fallback and no Python runtime dependency, `search` supports context lines, `semantic_search`/`prompt_enhancer` are bridged to ContextWeaver, and `@file` mention pre-resolution is injected into prompt).
19. `@file` mention index acceleration: in-memory file-path index with incremental refresh (added/removed diff) and trigram-based candidate selection for large repositories.
20. End-to-end smoke checks for `grobot start` / execution-plane contracts (`gateway/tests/check-gateway-node.mjs`, including `start-smoke-contract` scenarios).
21. Agent-level eval harness v0 (`gateway/evals`): optimization/holdout split, multi-variant scoring, gate enforcement, and holdout regression guard.
22. Trace mining bootstrap (`gateway/src/governance/evals/trace-mining.ts`): auto-generate eval datasets from local session traces.
23. Hill-climbing selector (`gateway/src/governance/evals/hill-climb.ts`): choose best variant by optimization gain under holdout non-regression constraints.
24. CI gate mode (`runner --fail-on-gate`): fail-fast with non-zero exit when any gate/regression guard fails.
25. Trace cleaning pipeline (`gateway/src/governance/evals/trace-clean.ts`): mined dataset dedupe/redaction plus review report generation.
26. GitHub Actions gate workflow (`.github/workflows/harness-gate.yml`): runs `npm run check` + `npm run harness:gate:ci`.
27. Unified trace pipeline (`gateway/src/governance/evals/trace-pipeline.ts`): one command with tunable mining/cleaning params.
28. TS migration skeleton for Agent Loop v2 (`context -> runtime -> verify -> persist`) with optional shadow comparison.
29. TS migration options resolver (`gateway_impl` / `runtime_impl` / `shadow_mode`) for dual-track rollout.
30. TS dev CLI execution-plane resolver (`CLI > env > .grobot/project.toml > default`) with `gateway_impl` / `runtime_impl` / `shadow_mode`.
31. Management status exposure for execution plane in `GET /api/v1/status` (`execution_plane` + per-field source).
32. TS bridge CLI (`gateway/src/extensions/bridge-cli.ts`) wired into the TS `start` path when `gateway_impl=ts`, using Rust stdio runtime when `runtime_impl=rust`.
33. Gateway TypeScript compile gate via `gateway/tsconfig.json`.
34. TS dev CLI fallback (`scripts/run-ts-dev-cli.sh`, compiling `gateway/src/cli/main.ts`) for source-checkout launcher path: `status`, `serve --gateway-impl ts --ts-dev-cli`, and `start --message --gateway-impl ts`.
35. TS `serve --ts-dev-cli` currently exposes `GET /api/v1/status`, `GET /api/v1/config` (auth + masked), `GET /healthz`, `POST /api/v1/reload`, `POST /api/v1/sessions/{id}/interrupt`, `POST /api/v1/mcp/reset`, `POST /api/v1/mcp/servers/{name}/reset`, `GET /api/v1/sessions/{id}/memory`, `GET /api/v1/sessions/{id}/memory/export`, `POST /api/v1/sessions/{id}/memory/import`, `POST /api/v1/sessions/{id}/memory/forget`, `POST /api/v1/sessions/{id}/memory/lifecycle`, and `POST /api/v1/memory/lifecycle/run`.
36. TS `start/status/serve` 参数层已覆盖常用路径与会话参数（`--home`/`--project-root`/`--config-path`/`--session-scope`/`--session-subject`/`--session-backend` 别名）；`serve` 还支持从 `[management].token` 自动读取管理令牌。
37. TS memory store backend selection now supports `file` (default) and `redis` (via `--session-store redis` / `GROBOT_SESSION_STORE=redis` / `[runtime.storage].hot_cache=redis`). Status endpoint reports selected backend, Redis key, and fallback reason when Redis bootstrap fails and it falls back to file.
38. TS `serve --ts-dev-cli` now honors config read policy precedence for `GET /api/v1/config` (`--config-read-policy` > `GROBOT_CONFIG_READ_POLICY` > `[management].config_read_policy` > `auto`), with `auto` resolving by bind host (loopback=`public`, non-loopback=`auth`).
39. TS Redis memory store uses a minimal RESP2 client over `node:net` (currently `AUTH`/`SELECT`/`GET`/`SET EX` on `redis://`). `rediss://` is not supported in TS dev CLI yet; when Redis bootstrap fails, runtime falls back to file store and exposes `fallback_reason` in `/api/v1/status`.
40. `POST /api/v1/reload` now refreshes memory store runtime config as well (`file/redis`, source, fallback reason) and reloads in-memory session map from the resolved backend.
41. Skill-router eval baseline/ci-gate/report pipeline is TS-only (`gateway/src/governance/evals/skill-router-*.ts`).
42. TS `status --probe` now performs a real OpenAI-compatible `/models` probe (credential precedence: CLI > env > selected project provider in `config.toml`), reports HTTP status/model count, and exits non-zero on probe failure.
43. The product CLI implementation lives under `gateway/src/cli`; the old `gateway/src/orchestration/entrypoints/dev-cli` source path has been retired and is blocked by the layer contract.
44. Legacy Python execution retirement record is documented in `gateway/LEGACY_EXECUTION_BOUNDARY.md`.
45. `gateway/src/cli` now separates argument parsing and runtime health probing into dedicated modules (`cli-args.ts`, `runtime-health.ts`) to reduce single-file coupling without changing command behavior.
46. Runtime tool-context recovery knobs are wired end-to-end (`GROBOT_NO_TOOL_FALLBACK_MODE`, `GROBOT_MAX_RECOVERY_ROUNDS`) and forwarded to Rust runtime as `no_tool_fallback_mode` / `max_recovery_rounds`.
47. Runtime event normalization now includes no-tool lifecycle diagnostics (`no_tool_fallback_triggered` / `no_tool_fallback_succeeded` / `no_tool_fallback_exhausted`) in addition to core turn/tool events.

## Runtime Tool Context Env

`grobot start` and `grobot status` support these runtime recovery envs:

- `GROBOT_NO_TOOL_FALLBACK_MODE`: `off | safe | strict` (default `safe`)
- `GROBOT_MAX_RECOVERY_ROUNDS`: `0..8` (default `2`)

Use `grobot status` to confirm effective values:

- `runtime_tool_no_tool_fallback_mode`
- `runtime_tool_max_recovery_rounds`

`grobot status` also exposes runtime-tools observability fields:

- `runtime_tool_context` (enabled with source hint)
- `runtime_tool_enabled_tools_source` (`runtime.tools.describe | start-default`)
- `runtime_tool_enabled_tools_source_detail` (present when source falls back to `start-default`)
- `runtime_tool_manifest_fingerprint`
- `runtime_tool_manifest_tool_count`
- `runtime_tool_manifest_default_enabled_count`
- `runtime_tool_enabled_tools`

Machine-readable status snapshot:

- `grobot status --json` emits one JSON object (snapshot shape, not JSONL stream).
- Default `grobot status` output remains line-based text for human readability.

## Semantic Tool Bridge (ContextWeaver)

`grobot start` now exposes two additional local tools:

- `semantic_search`: semantic retrieval across `code | memory | wiki` sources.
- `prompt_enhancer`: prompt enrichment with evidence snippets and extracted terms.

### Bridge script resolution

Runtime resolves bridge script in this order:

1. Tool argument override: `bridge_script`
2. Environment: `GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT`
3. Built-in fallback path in checkout: `adapters/contextweaver/bridge/cli.mjs`

### ContextWeaver runtime resolution

Bridge resolves executable in this order:

1. `CONTEXTWEAVER_BIN`
2. `GROBOT_CONTEXTWEAVER_ROOT` or `CONTEXTWEAVER_ROOT` (expects `<root>/dist/index.js`)
3. `contextweaver` from `PATH`

### Retrieval config source of truth

For embedding/rerank settings, bridge now reads **only**:

1. `<repo>/.grobot/config.toml` `[retrieval]`
2. `<repo>/.grobot/config.toml` `[retrieval.embedding]`
3. `<repo>/.grobot/config.toml` `[retrieval.rerank]`

Hard constraints:
- Missing `<repo>/.grobot/config.toml` fails fast.
- Legacy `[context_retrieval]` in `.grobot/config.toml`, `.grobot/project.toml`, or `<repo>/config.toml` fails fast.
- `retrieval.base_url`, `retrieval.api_key`, `retrieval.embedding.model`, `retrieval.embedding.dimensions`, `retrieval.rerank.model` are required (placeholder values are treated as missing).
- No env override precedence for retrieval settings.
- No global `~/.grobot/config.toml` fallback.
- No default model inference.

`retrieval.base_url = https://.../v1` is still normalized to endpoint URLs (`.../v1/embeddings`, `.../v1/rerank`).

### Common semantic bridge failures

- `semantic_index_required`: run `cw index <repo-path> -y`.
- `semantic_index_config_invalid`: update `cwconfig.json` include patterns so files can be indexed.
- `semantic_config_missing`: check `<repo>/.grobot/config.toml` `[retrieval.*]` fields.
- `semantic_config_missing` with `Embedding API HTTP 404`: current URL/model likely does not expose embedding endpoint; set retrieval-specific embedding base URL/model.

## Verification

Run gateway checks:

```bash
npm run check:gateway
```

Sample harness run:

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/governance/evals/runner.ts \
  --cases gateway/evals/fixtures/cases.sample.jsonl \
  --runs gateway/evals/fixtures/runs.sample.jsonl \
  --gate-policy gateway/evals/gate_policy.default.json \
  --output /tmp/grobot-harness-report.json
```

CI gate mode:

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/governance/evals/runner.ts \
  --cases gateway/evals/fixtures/cases.sample.jsonl \
  --runs gateway/evals/fixtures/runs.sample.jsonl \
  --gate-policy gateway/evals/gate_policy.default.json \
  --fail-on-gate
```

## Next Steps

1. Add inbound adapter normalization for Feishu and Telegram.
2. Add retry/circuit handling for Rust runtime stdio client (currently single-shot call).
3. Replace placeholder Rust turn implementation with real model+tool execution pipeline.
