# Agent Memory and Context Guide

> Scope: Memory architecture, lifecycle, retrieval quality, and context composition for long-running multi-session coding agents.

---

## 1. Memory Goals

- Preserve continuity across sessions without flooding context windows.
- Keep memory interpretable, editable, and auditable.
- Improve answer/tool quality through relevant recall, not full history replay.
- Provide enterprise-safe controls for retention, deletion, and redaction.

---

## 2. Memory Layers

### 2.1 Working Memory

- Horizon: short-term (`24-72h`).
- Content: recent task steps, pending TODOs, unresolved blockers.
- Characteristics: high recency weight, high churn.

### 2.2 Episodic Memory

- Horizon: session/task episodes.
- Content: what happened, what decisions were made, what failed.
- Characteristics: chronological anchors for replay and debugging.

### 2.3 Semantic and Procedural Memory

- Semantic: user/team preferences, architecture facts, stable constraints.
- Procedural: reusable workflows, learned patterns, skill-like guidance.
- Characteristics: low churn, high value across sessions.

### 2.4 Archive Memory

- Horizon: long tail storage.
- Content: compressed, low-access historical memory.
- Characteristics: cheap retention, recoverable on relevance hit.

---

## 3. Storage Model

### 3.1 Core Tables

- `memory_items`
  - `id`, `tenant_id`, `project_id`, `session_scope`, `memory_type`, `content`, `summary`, `source_ref`, `confidence`, `importance`, `created_at`, `updated_at`
- `memory_edges`
  - graph links between memory entities/concepts
- `memory_events`
  - ingest/update/delete/promote/decay/audit operations
- `memory_recall_log`
  - recall query, selected items, ranking scores, injection result

### 3.2 Indexing

- PostgreSQL full-text (BM25-like lexical retrieval).
- `pgvector` semantic embedding index.
- Optional graph traversal index for multi-hop relation expansion.

### 3.3 Cache

- Redis for hot recall and session-local memory snapshots.
- TTL-based invalidation on memory updates.

---

## 4. Write Path

1. Turn finishes.
2. Extract candidate memories using dual channel:
   - fast extractor (rules/regex)
   - deep extractor (LLM-based)
3. Categorize by memory type and sensitivity.
4. Deduplicate with 4-tier strategy:
   - exact match -> skip
   - near-exact -> replace/update
   - semantic overlap -> LLM adjudication
   - new -> insert
5. Persist memory item and memory event.
6. Update lifecycle metadata (`access_count`, `decay_counter`).

---

## 5. Read Path

1. Normalize query and session context.
2. Generate 2-3 query variants (optional expansion for complex tasks).
3. Retrieve candidates from lexical + vector + graph channels.
4. Fuse rankings (RRF or weighted fusion).
5. Apply reranker for top-N.
6. Apply priority injection policy:
   - hard constraints first
   - user preferences second
   - task-relevant episodic context third
7. Inject bounded memory snippets into context layer.
8. Log recall decision for observability and future evals.

---

## 6. Lifecycle Engine

### 6.1 Promotion

- Promote Working -> Episodic/Semantic when:
  - high access frequency
  - high confidence
  - explicit user confirmation ("remember this")

### 6.2 Decay

- Decay from active tiers when stale and low-access.
- Use configurable decay windows by memory type.

### 6.3 Archive and Rehydration

- Archive compressed summaries instead of hard deletion (unless policy requires deletion).
- Rehydrate archive memory into active tiers when relevance threshold is crossed.

---

## 7. Context Composition Rules

### 7.1 Context Budgeting

- Reserve budget for:
  - policy/system constraints
  - active task evidence
  - memory recall block
  - tool outputs
- Hard cap memory injection to prevent context rot.

### 7.2 Compaction Trigger

Trigger compaction when estimated usage ratio crosses threshold (example: >= 0.5 for early compaction, stricter under high-load mode).

Compaction must preserve:

- identifiers (IDs, hashes, URLs, paths)
- unresolved TODOs
- active branch/plan state

---

## 8. Governance and Privacy

- Memory classification levels: `public`, `internal`, `restricted`, `secret`.
- Restricted/secret memory is excluded from broad recall unless explicitly required.
- Deletion policy supports:
  - hard delete (compliance)
  - tombstone + audit (operational)
- Export policy supports per-user data portability.

---

## 9. Practical Integration Pattern

- Keep `MEMORY.md` as index file, not raw memory dump.
- Store memory entries in topic files and reference them from index.
- Keep index concise and searchable; avoid verbose entries.
- Use session logs (jsonl) for replay and memory extraction provenance.

---

## 10. Validation Checklist

- Recall precision for top-5 memory candidates meets target.
- Memory duplication rate remains below threshold.
- Decay/promote jobs run successfully on schedule.
- Sensitive memories are never injected into unauthorized contexts.
- Memory-related regressions are covered in release eval suite.

---

## 11. References

- MemOS architecture and scheduler notes: https://github.com/MemTensor/MemOS
- Cortex lifecycle and hybrid retrieval pattern: https://github.com/rikouu/cortex
- Anthropic context engineering guidance: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Karpathy persistent wiki pattern: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
