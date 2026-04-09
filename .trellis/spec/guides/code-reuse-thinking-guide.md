# Code Reuse Thinking Guide

> Purpose: Avoid copy-paste growth and preserve maintainability by reusing stable patterns before adding new helpers, constants, or adapters.

---

## 1. Core Rule

Before adding any new utility or abstraction, search for existing behavior first.

```bash
rg -n "keyword_or_behavior" .
```

If the behavior already exists, prefer extension over duplication.

---

## 2. Reuse Decision Framework

Use this decision order:

1. Existing function can be reused as-is.
2. Existing function can be reused with a parameterized extension.
3. Existing function can be split into composable pieces.
4. Create new implementation only when 1-3 are infeasible.

---

## 3. Duplicate Detection Signals

Strong duplicate signals:

- Similar branch logic appears in 3+ files.
- Identical constants diverge by naming only.
- Same validation/parsing logic appears in gateway, runtime, and tools.
- Same error message mapping repeated with slight variations.

Weak duplicate signals (do not force abstraction yet):

- One-off logic for a temporary migration.
- Domain-specific behavior with incompatible constraints.

---

## 4. Reuse Priority by Artifact Type

Apply reuse in this priority:

1. Domain contracts and schemas (highest reuse value).
2. Error code and response envelope mapping.
3. Validation and normalization logic.
4. Low-level utility wrappers.
5. Presentation-only formatting helpers.

---

## 5. Safe Refactor Pattern

When converging duplicates:

1. Identify all callers and behavior variants.
2. Write characterization tests for current behavior.
3. Introduce shared implementation behind stable interface.
4. Migrate callers incrementally.
5. Delete dead paths after tests pass.

Never merge duplicates blindly without preserving variant semantics.

---

## 6. Naming and Ownership Rules

- Reusable modules must have domain-driven names, not task-ticket names.
- Shared contracts live near boundaries, not deep inside feature folders.
- Utility ownership must be clear: gateway-shared, runtime-shared, or project-local.

---

## 7. Review Checklist

Before merging code with new helpers/constants:

- Did we search for existing implementation?
- Is there a single source of truth for this contract?
- Are we introducing a generic helper without 2+ real call sites?
- Did we preserve error and telemetry semantics?
- Is there any dead code left after reuse migration?

---

## 8. Anti-Patterns

- Creating `utils/common.ts` as a dump for unrelated helpers.
- Premature abstractions based on guessed future needs.
- Rewriting stable reused logic because local style differs.
- Duplicating schemas between TypeScript and Rust without contract generation.

---

## 9. Project-Specific Application

For this agent platform:

- Keep session/event/tool contracts centralized and versioned.
- Share policy error codes across gateway and runtime.
- Keep provider routing schema as single config truth.
- Reuse memory lifecycle primitives across ingestion and recall paths.

