---
name: skill-creator
description: Create new skills, upgrade existing skills, and run evidence-based optimization loops for trigger quality and output quality. Use this skill whenever the user asks to build a skill, refactor a skill, package a skill, validate skill structure, benchmark with/without-skill behavior, or tune frontmatter descriptions for better triggering across Codex, Claude, and OpenAI-compatible agentic APIs.
---

# Skill Creator

Build high-quality skills end to end: design, scaffold, validate, evaluate, optimize, and package.

This skill combines:
- **Codex-style authoring rigor** (clean SKILL.md, deterministic scaffolding, strict validation)
- **Claude-style evaluation loop** (benchmarking, grading, reviewer workflow, iterative refinement)
- **Adapter-based runtime coverage** (Codex CLI, Claude CLI, OpenAI-compatible APIs)

---

## Core execution model

Use this sequence unless the user explicitly asks for a narrower path.

1. **Clarify intent and trigger boundary**
2. **Scaffold or load skill files**
3. **Write / update SKILL.md + resources**
4. **Run structural validation (`quick_validate.py`)**
5. **Run evaluation loop (qual + quant)**
6. **Package and hand off**

Avoid skipping steps 4-5 for production-grade skills.

---

## Skill creation and upgrade workflow

### Step 1 — Capture intent with concrete examples

Identify:
- what task family the skill should own
- what should trigger it vs. not trigger it
- required outputs and acceptance criteria

Ask for 2-4 realistic user prompts if examples are missing.

### Step 2 — Plan reusable resources

Before writing long prose, decide whether repeated work should become:
- `scripts/` for deterministic execution
- `references/` for large domain docs or schemas
- `assets/` for templates and output artifacts

Rule: if a helper script is rewritten more than once, promote it into `scripts/`.

### Step 3 — Initialize (new skills)

Use:

```bash
python scripts/init_skill.py <skill-name> --path <output-dir> [--resources scripts,references,assets] [--examples]
```

Default install path when unspecified:

```bash
${CODEX_HOME:-$HOME/.codex}/skills
```

### Step 4 — Edit for decision-complete behavior

Write SKILL.md in imperative style. Keep trigger logic in frontmatter description.

When updating existing skills:
- preserve working behaviors unless user asks to remove them
- remove stale or contradictory guidance
- keep references one hop away from SKILL.md (no deep nesting)

### Step 5 — Validate structure

Always run:

```bash
python scripts/quick_validate.py <path-to-skill>
```

### Step 6 — Evaluate and iterate

Run with/without-skill comparisons where possible, then improve based on hard evidence:
- transcripts
- grading outputs
- benchmark deltas
- human review comments

---

## Multi-platform trigger evaluation (adapter architecture)

Use `scripts/run_eval.py` with runner adapters.

### Supported runners

- `claude-cli`: observes real runtime trigger behavior from CLI stream events
- `codex-cli`: performs intent-level trigger classification via Codex CLI
- `openai-compatible`: performs intent-level trigger classification via Chat Completions API

### Command

```bash
python scripts/run_eval.py \
  --eval-set <eval-json> \
  --skill-path <skill-dir> \
  --runner <claude-cli|codex-cli|openai-compatible> \
  --runner-config <json-or-path> \
  --model <model-id> \
  --runs-per-query 3 \
  --trigger-threshold 0.5
```

### Runner config guidance

- `claude-cli`: optional `{"claude_bin":"claude"}`
- `codex-cli`: optional `{"codex_bin":"codex","sandbox":"read-only"}`
- `openai-compatible`: typically
  ```json
  {
    "api_base_url": "https://api.openai.com/v1",
    "api_key_env": "OPENAI_API_KEY",
    "model": "gpt-4.1-mini"
  }
  ```

Prefer passing secrets through environment variables, not plaintext files.

---

## Description optimization loop

Use `scripts/run_loop.py` for iterative optimization.

```bash
python scripts/run_loop.py \
  --eval-set <eval-json> \
  --skill-path <skill-dir> \
  --runner <claude-cli|codex-cli|openai-compatible> \
  --runner-config <json-or-path> \
  --improver-provider <anthropic|openai-compatible> \
  --improver-config <json-or-path> \
  --model <model-id> \
  --max-iterations 5 \
  --holdout 0.4 \
  --verbose
```

Loop behavior:
- split train/test to reduce overfitting
- evaluate trigger outcomes repeatedly
- optimize description from failed trigger patterns
- select best description by held-out score when available

---

## Benchmark and review workflow

After execution runs and grading:

1. Aggregate:
   ```bash
   python -m scripts.aggregate_benchmark <workspace-or-iteration-dir> --skill-name <name>
   ```
2. Generate reviewer page:
   ```bash
   python eval-viewer/generate_review.py <workspace> --skill-name "<name>" --benchmark <benchmark.json>
   ```
3. Collect feedback and feed it into next iteration.

For schema contracts, read `references/schemas.md`.

---

## Packaging and delivery

Package distributable artifact:

```bash
python -m scripts.package_skill <path-to-skill-folder>
```

Before packaging:
- re-run `quick_validate.py`
- ensure no temporary eval artifacts are accidentally bundled

---

## Writing quality rules

1. Keep SKILL.md lean; move detail to `references/`.
2. Prefer constraints that explain **why**, not only rigid MUST statements.
3. Favor reusable scripts over repeated ad-hoc code in transcripts.
4. Include realistic examples, not toy prompts.
5. Avoid overfitting trigger descriptions to a tiny eval set.

---

## What not to include in skill folders

Do not add auxiliary process docs such as:
- `README.md`
- `INSTALLATION_GUIDE.md`
- `CHANGELOG.md`

Keep only operational files needed by the agent runtime.

---

## References map

- `references/openai_yaml.md`: `agents/openai.yaml` field contracts and constraints
- `references/schemas.md`: eval/grading/benchmark JSON schemas
- `agents/grader.md`: grading protocol
- `agents/comparator.md`: blind A/B comparison protocol
- `agents/analyzer.md`: benchmark analysis protocol

