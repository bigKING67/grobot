# Thinking and Architecture Guides

> Purpose: Provide decision-ready guidance before implementation, with emphasis on reliability, cross-layer correctness, and operational safety.

---

## Guide Index

| Guide | Purpose | When to Use |
| --- | --- | --- |
| [Agent Platform Blueprint](./agent-platform-blueprint.md) | Master architecture for TS+Rust multi-channel agent platform | Before major architecture decisions or scope planning |
| [Agent Gateway and Runtime Guide](./agent-gateway-runtime-guide.md) | Runtime contracts, session control, concurrency, routing | When implementing adapters, gateway API, scheduler, failover |
| [Agent Memory and Context Guide](./agent-memory-context-guide.md) | Memory lifecycle, retrieval, compaction, context layering | When implementing memory ingest/recall or context engineering |
| [Agent Eval, Observability, and Security Guide](./agent-eval-observability-security-guide.md) | Release gates, trace schema, SLOs, security controls | Before production rollout or policy-sensitive features |
| [Agent Implementation Roadmap](./agent-implementation-roadmap.md) | MVP to enterprise phase plan with entry/exit criteria | For milestone planning, sequencing, and risk management |

---

## Quick Triggers

### Use Agent Blueprint and Runtime Guides If

- You are changing session lifecycle, queueing, or channel adapters.
- You are introducing new provider routing or tool policy logic.
- You are changing runtime interfaces between TypeScript and Rust.

### Use Memory and Eval/Security Guides If

- You are changing memory recall/ingest behavior.
- You are introducing compaction, summarization, or context policies.
- You are preparing deployment, release gates, or security controls.

---

## Pre-Modification Rule (Critical)

Before changing any contract/config/value, search for all references first:

```bash
rg -n "value_or_symbol_to_change" .
```

---

## Usage Pattern

1. Start with the guide nearest your current task boundary.
2. Confirm constraints and contracts before coding.
3. Add checklist evidence in task/PR notes.
4. Update the relevant guide when a new stable pattern is discovered.
