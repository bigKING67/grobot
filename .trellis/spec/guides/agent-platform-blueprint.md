# Agent Platform Blueprint (TypeScript + Rust)

> Purpose: Define a decision-complete architecture for a production coding-agent platform that supports 100 concurrent sessions, Feishu/Telegram integration, and high-quality outcomes with non-flagship models through strong engineering harnesses.

---

## 1. Goals

### 1.1 Product Goals

- Build an enterprise-ready multi-channel agent platform that can be invoked from IM channels (first launch: Feishu + Telegram).
- Reach stable quality close to premium coding-agent behavior by improving process quality (harness, tools, context, memory, eval), not only by using expensive models.
- Support at least 100 concurrent active sessions with strict session isolation and recoverable long-running workflows.

### 1.2 Engineering Goals

- Keep orchestration and integrations in TypeScript for developer productivity.
- Put high-concurrency execution, scheduling, and runtime policy enforcement in Rust.
- Keep provider/model strategy pluggable so Kimi 2.5, GPT-5.4-class, and OpenAI-compatible models can be swapped without architecture changes.

### 1.3 Non-Goals (v1)

- No full multi-tenant enterprise control plane in v1 (single enterprise tenant with multi-project isolation only).
- No broad all-channel launch in v1 (Slack/Discord/WhatsApp follow after Feishu+Telegram stabilization).
- No monolithic "one prompt fixes all" approach; quality must be enforceable by mechanisms.

---

## 2. Design Principles

- Harness-first, model-second: reliability comes from boundaries, tests, and feedback loops.
- Decouple brain and hands: model reasoning and tool execution remain separate subsystems.
- Session as first-class unit: all queueing, isolation, cancellation, memory recall, and audit are session-scoped.
- Context is layered, not dumped: stable policy + dynamic runtime + retrieved memory + task-local evidence.
- Observability is non-optional: every major transition emits a structured event.
- Security before capability: any new tool/channel must pass boundary checks before enablement.

---

## 3. Target Topology

### 3.1 Runtime Components

| Layer | Component | Language | Responsibility |
| --- | --- | --- | --- |
| Channel Edge | IM adapters (Feishu, Telegram) | TypeScript | Parse inbound events, normalize payloads, send replies/stream updates |
| Gateway | API + session ingress + management API | TypeScript | Auth, routing, command ACL, project binding, webhook/bridge endpoints |
| Orchestration | Session coordinator | TypeScript | Create/restore session, dispatch turns to runtime core, merge outputs |
| Runtime Core | Turn engine + scheduler + policy executor | Rust | Session mailbox, turn state machine, tool calls, retries, failover |
| Tool Plane | Tool workers / hook runner / MCP bridge | Rust + TypeScript | Execute tools under policy, normalize tool outputs, emit audit events |
| Memory Plane | Recall/ingest service + lifecycle jobs | TypeScript + Rust | Hybrid retrieval, memory extraction, dedupe, promote/decay/archive |
| Data Plane | Postgres + Redis + object storage | N/A | Durable state, vector index, hot session cache, queue/state recovery |
| Governance Plane | Eval runner + tracing + dashboards | TypeScript | Regression gates, pass@k tracking, SLO, release quality decisions |

### 3.2 Deployment Profiles

- `MVP`: single-node (TS gateway + Rust runtime + Postgres + Redis).
- `Scale`: split gateway and runtime into multiple instances behind L4/L7 load balancer.
- `Enterprise`: HA Postgres/Redis, blue-green runtime rollout, policy and audit controls.

---

## 4. End-to-End Control Flow

### 4.1 Turn Lifecycle

1. Channel adapter receives user message and creates canonical `SessionKey`.
2. Gateway validates ACL/rate-limit, resolves project config, and enqueues a turn request.
3. Runtime core dequeues by session mailbox (one in-progress turn per session).
4. Runtime composes context layers and calls model router.
5. Model may issue tool calls; runtime executes tools via policy-controlled tool plane.
6. Runtime loops until final text/action response is produced or turn fails.
7. Gateway streams intermediate/final updates to channel.
8. Memory ingestion job records durable memory candidates post-turn.
9. Trace/eval events are written for observability and regression analysis.

### 4.2 Recovery Path

- If gateway crashes: session state remains in Redis/Postgres, runtime continues current turns.
- If runtime instance crashes: unacked turns return to queue after lease timeout; new worker resumes from persisted turn snapshot.
- If provider fails: routing policy performs bounded retries/failover and records decision chain.

---

## 5. Model Strategy (Cheap Models, High Outcome)

### 5.1 Task Classes

- `T0`: deterministic command/action (no deep reasoning).
- `T1`: straightforward coding/edit tasks.
- `T2`: multi-step engineering/debug tasks.
- `T3`: high-risk architecture/refactor/security tasks.

### 5.2 Routing Policy

- Default route: economy or balanced model for `T0/T1`.
- Escalation route: stronger model profile for `T2/T3` or when confidence drops.
- Forced fallback: if tool-selection mismatch, failing eval pattern, or repeated retries, promote to higher profile.

### 5.3 Quality Multipliers (Required)

- Strong tool contracts (ACI-oriented descriptions and structured errors).
- High-quality harness validations per turn (format checks, policy checks, result checks).
- Persistent memory with relevance ranking (not raw history stuffing).
- Continuous regression eval suite with release gates.

---

## 6. Concurrency and Session Isolation

### 6.1 Concurrency Target

- Support at least `100 active concurrent sessions`.
- Keep `one active turn per session` for deterministic session state.
- Allow many sessions to execute in parallel via worker pool.

### 6.2 Isolation Boundaries

- Separate session mailbox and lock key per `SessionKey`.
- Tool execution context includes `session_id`, `agent_id`, `project_id`, and scoped credentials.
- Session memory scope defaults to project+user; shared/team memory must be explicit.

### 6.3 Backpressure and Timeouts

- Queue with bounded depth per project/session class.
- Turn timeout budget with per-step sub-timeouts (model/tool/network).
- Explicit cancellation semantics (`/stop`, channel interrupt, admin terminate).

---

## 7. Context Engineering Baseline

### 7.1 Context Layers

- Layer A (persistent): immutable policy and project guardrails.
- Layer B (dynamic): session metadata, runtime flags, channel context.
- Layer C (retrieved): top-ranked memory and relevant prior decisions.
- Layer D (task evidence): current files, tool outputs, diagnostics.

### 7.2 Compaction Rules

- Trigger compaction when estimated token usage crosses threshold.
- Preserve identifiers exactly (IDs, hashes, URLs, ports, file paths).
- Replace stale verbose tool logs with structured summaries.
- Store compressed snapshots for replay/debug.

### 7.3 Skill and Hook Usage

- Skills are loaded by trigger conditions, not globally preloaded.
- Hooks remain system-level enforcement and should not pollute model context.
- Hook outputs produce trace events and optional policy side effects.

---

## 8. Enterprise Safety Baseline

- Secrets never exposed to tool sandboxes directly; use host-side injection/proxy.
- Endpoint/tool allowlist and denylist policies are mandatory.
- Prompt injection defenses: content sanitization + policy tagging + tool scope checks.
- Full audit chain: who triggered, what tool executed, what external call happened.
- Security modes: `strict`, `balanced`, `dev`, with `strict` as production default.

---

## 9. Performance and SLO Targets

- P95 time-to-first-stream-token: <= 4s for standard tasks under normal load.
- P95 turn completion (non-long-running): <= 25s.
- Session recovery success after worker crash: >= 99%.
- Failover success for provider outages (within retry budget): >= 95%.
- Trace coverage for turn/tool events: 100% of production traffic.

---

## 10. Technical Decisions Locked

- Language split: TS orchestration + Rust runtime core.
- Initial channels: Feishu + Telegram.
- Initial tenant model: single enterprise tenant, multi-project isolation.
- Primary data stack: PostgreSQL + Redis.
- Contract-first runtime APIs with typed event schemas.

---

## 11. References

- Anthropic Managed Agents engineering page: https://www.anthropic.com/engineering/managed-agents
- Anthropic harness design: https://www.anthropic.com/engineering/harness-design-long-running-apps
- Anthropic context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic evals: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- cc-connect: https://github.com/chenhg5/cc-connect
- cc-connect bridge protocol: https://raw.githubusercontent.com/chenhg5/cc-connect/main/docs/bridge-protocol.md
- cc-connect management API: https://raw.githubusercontent.com/chenhg5/cc-connect/main/docs/management-api.md
- MemOS: https://github.com/MemTensor/MemOS
- Cortex: https://github.com/rikouu/cortex
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- IronClaw: https://github.com/nearai/ironclaw
- Pi Mono: https://github.com/badlogic/pi-mono
- Claude Code Hub: https://github.com/ding113/claude-code-hub
- Karpathy LLM Wiki pattern: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Note: The managed-agents publication date is inferred from Anthropic page metadata timestamps in the 2026-04-08 window.
