# Agent Implementation Roadmap (MVP -> Enterprise)

> Scope: staged delivery plan for a TypeScript + Rust agent platform with Feishu/Telegram first launch and 100-concurrency enterprise target.

---

## Phase 0: Spec Freeze (Current)

### Objective

Freeze architecture, interfaces, and quality gates before coding.

### Deliverables

- Blueprint and specialized guides in `.trellis/spec/guides/`.
- Root README as project navigation entry.
- Contract definitions for sessions/events/tools/routing/memory.

### Exit Criteria

- Documentation is complete, linked, and internally consistent.
- Engineering team accepts component boundaries and runtime contracts.

---

## Phase 1: MVP (Single Node)

### Objective

Ship a usable coding agent bridge for Feishu and Telegram with stable core loop.

### Scope

- TypeScript gateway + adapters + management endpoints.
- Rust runtime core with session mailbox and basic scheduler.
- Basic provider router with weighted strategy and bounded failover.
- Memory v1 (working + episodic + semantic basic recall).
- Trace v1 (required runtime events).

### Exit Criteria

- E2E IM workflow works for Feishu/Telegram.
- 30 concurrent sessions stable in soak testing.
- Crash recovery works for in-flight turns.
- Baseline eval suite established and passing.

---

## Phase 2: Scale to 100 Concurrent Sessions

### Objective

Harden runtime and operations to reliably handle 100 concurrent active sessions.

### Scope

- Multi-instance gateway/runtime deployment profile.
- Durable queue/lease recovery for turn execution.
- Improved backpressure and overload handling.
- Provider routing improvements: stickiness, circuit breaker, failover telemetry.
- Memory lifecycle engine: promotion/decay/archive jobs.
- Dashboard and alerting for SLO and queue/provider health.

### Exit Criteria

- 100 concurrent session load test meets SLO targets.
- Failover/recovery pass rates meet defined thresholds.
- On-call runbooks and incident templates validated.

---

## Phase 3: Enterprise Readiness (GA)

### Objective

Deliver enterprise governance, security, and release reliability.

### Scope

- Security hardening mode as default production profile.
- Full audit trail and policy management controls.
- Expanded eval harness with replay and pass^k reporting.
- Blue-green deployment and rollback automation.
- Optional multi-tenant isolation groundwork.

### Exit Criteria

- Security and compliance checklist signed off.
- Regression/eval gate integrated into CI release flow.
- Production readiness review passed.

---

## Cross-Phase Workstreams

### Workstream A: Runtime and Routing

- Session mailbox and scheduler evolution.
- Routing policy maturity and provider governance.

### Workstream B: Memory and Context

- Retrieval quality improvements.
- Lifecycle jobs and memory governance.

### Workstream C: Safety and Security

- Tool and secret boundaries.
- Prompt injection defenses and auditability.

### Workstream D: Eval and Ops

- Build benchmark corpus from real tasks.
- Keep release gates strict and evidence-driven.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Overfocus on model upgrades | Cost increase, unstable quality | Prioritize harness/eval/tool contracts first |
| Queue starvation under bursts | High latency, failed turns | Weighted scheduler + backpressure + per-session limits |
| Memory quality drift | Wrong recall, poor decisions | Recall evals, dedupe strategy, memory review jobs |
| Provider instability | Outages and retries | Multi-provider routing + circuit breaker + health probes |
| Security bypass via tools | Data leakage risk | Capability policies + sandbox + secret boundary checks |

---

## Rollback Strategy

- Runtime release rollback by versioned image tags.
- Config rollback by immutable config snapshots.
- Policy rollback by signed policy revision history.
- Memory pipeline rollback by disabling ingestion and retaining read-only recall.

---

## Milestone Checklist

- [ ] Phase 0 docs accepted
- [ ] Phase 1 MVP validated in staging
- [ ] Phase 2 100-concurrency gate passed
- [ ] Phase 3 GA gate passed
