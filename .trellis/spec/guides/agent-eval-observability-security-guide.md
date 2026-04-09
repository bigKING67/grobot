# Agent Eval, Observability, and Security Guide

> Scope: Release quality gates, trace design, runtime monitoring, and enterprise security controls.

---

## 1. Why This Layer Exists

To make non-flagship models perform reliably for coding workflows, quality must be enforced by:

- reproducible eval harnesses
- strict runtime telemetry
- explicit safety boundaries

Without these, model variance dominates and behavior quality drifts.

---

## 2. Eval System

### 2.1 Eval Types

- Unit evals: tool contract adherence, parser/formatter behavior.
- Integration evals: end-to-end turn behavior with mocked providers/tools.
- Scenario evals: long-horizon coding tasks with realistic repositories.
- Regression evals: historical failure cases replayed before release.

### 2.2 Metrics

- `Task Success Rate`
- `Pass@k` (development exploration)
- `Pass^k` (release confidence across repeated runs)
- `Tool Selection Accuracy`
- `Patch Validity` (build/test pass after generated edits)
- `Recovery Success Rate` after interruption/failure

### 2.3 Release Gates

A release candidate is blocked if any of these fail:

- regression suite below baseline threshold
- high-severity security tests fail
- trace coverage < 100% for required event types
- failover/recovery simulation below minimum success threshold

---

## 3. Observability

### 3.1 Required Event Stream

- `session_start`
- `turn_start`
- `model_request`
- `model_response`
- `tool_start`
- `tool_end`
- `turn_end`
- `turn_failed`
- `session_end`

Each event must include:

- `trace_id`
- `session_key`
- `turn_id`
- `project_id`
- `provider/model`
- status and error code

### 3.2 Dashboards

Minimum production dashboards:

- traffic and concurrency
- latency distribution (TTFT, turn completion)
- provider routing and failover decisions
- tool success/failure heatmap
- memory recall hit quality
- security incidents and policy denials

### 3.3 Alerting

Critical alerts:

- provider outage/failover exhaustion
- queue backlog and saturation
- spike in tool policy denials
- repeated turn timeouts
- abnormal memory recall failures

---

## 4. SLO Targets

- Availability: >= 99.9% gateway uptime.
- P95 TTFT: <= 4s under nominal load.
- P95 non-long-running turn completion: <= 25s.
- Failover success within retry budget: >= 95%.
- Recovery success after worker crash: >= 99%.

SLO breaches require incident review and remediation tasks.

---

## 5. Security Architecture

### 5.1 Threat Model

- Prompt injection from external channels/tool outputs.
- Secret exfiltration via tool calls.
- Over-privileged command execution.
- Cross-session data leakage.
- Unauthorized admin/API access.

### 5.2 Control Layers

- Identity and ACL: platform identity mapping + role-based command control.
- Tool policy: allowlist by capability (`read`, `write`, `net`, `exec`).
- Secret boundary: host-side credential proxy/injection, never direct secret exposure to untrusted tool runtime.
- Sandbox: isolate risky tools in containers/wasm runtime.
- Output sanitization: strip or mask sensitive payloads before channel delivery.

### 5.3 Prompt Injection Defenses

- Treat all external text as untrusted.
- Mark untrusted tool output with explicit boundary tags.
- Enforce policy checks before honoring tool-influenced actions.
- Deny unsafe instructions that attempt policy overrides.

---

## 6. Audit and Compliance

- Keep append-only audit logs for:
  - admin actions
  - policy changes
  - privileged tool invocations
  - incident-response overrides
- Define retention windows by data class.
- Provide export/delete mechanisms for regulated environments.

---

## 7. Incident Response

### 7.1 Severity Levels

- `SEV1`: data leak, broad outage, auth compromise.
- `SEV2`: partial outage, severe latency degradation.
- `SEV3`: localized failures, non-critical regressions.

### 7.2 Standard Response Flow

1. detect and classify
2. isolate blast radius
3. apply mitigation
4. recover service
5. run postmortem with action items

Each incident must produce regression tests to prevent recurrence.

---

## 8. Reference Patterns Applied

- Harness-centered quality strategy from Anthropic engineering guidance.
- Guard pipeline + fail-open/controlled-fallback ideas from production API proxy patterns.
- Session-based traceability and management API observability from cc-connect-style management controls.
