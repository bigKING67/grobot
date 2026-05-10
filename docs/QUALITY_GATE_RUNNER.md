# Grobot Quality Gate Runner

Grobot Quality Runner is the repository-local quality gate runtime. It follows
the same mechanism family as the DataHub runner: registry metadata, affected
selection, DAG scheduling, pass-only cache, and local performance stats. It does
not reduce quality coverage to gain speed; it changes when and how gates run.

## Goals

- **Keep quality coverage**: speed comes from affected selection, cache, and DAG
  scheduling, not from deleting assertions.
- **Run what changed and what can be affected**: daily local checks use the
  working tree as the affected set. Unknown surfaces fall back to a conservative
  quick baseline.
- **Keep failures diagnosable**: each gate has an explicit command, dependency
  list, group, cache policy, duration, and failure output.
- **Avoid monolithic local checks**: the old 300s+ full gateway smoke is still
  available, but it is no longer the default after every small edit.

## Commands

| Command | Purpose |
|---|---|
| `npm run check` | Default local affected gate. Uses current worktree/staged/untracked files only. |
| `npm run check:affected` | Same affected profile without compact output. |
| `npm run check:quick` | Quick baseline profile. |
| `npm run check:prepush` | Broader local protection: quick baseline plus current affected gates. Pass `--base REF` when a branch-diff run is explicitly desired. |
| `npm run check:ci` | Full CI-equivalent static gate profile. CI should run this with `--no-cache`. |
| `npm run check:release` | CI profile plus release-only gates. |
| `npm run check:quality-runner` | Runner self-checks. |
| `npm run check:quality:stats` | Local duration, cache-hit, and slow-gate diagnostics. |

Direct runner examples:

```bash
node scripts/quality-runner.mjs run affected --list --compact
node scripts/quality-runner.mjs run affected --changed-files runtime/src/extensions/handler.rs
node scripts/quality-runner.mjs run quick --json --no-cache
node scripts/quality-runner.mjs run ci --parallel 4
node scripts/quality-runner.mjs plan affected --strategy throughput
node scripts/quality-runner.mjs explain affected --summary
node scripts/quality-runner.mjs explain cache check:quality-runner
node scripts/quality-runner.mjs stats --slow 20
node scripts/quality-runner.mjs cache gc --max-age-days 30
```

## Execution model

### 1. Registry

The gate registry lives in `scripts/lib/quality-gate-registry.mjs`. Each gate is
normalized to:

- `name`: stable gate id.
- `command`: executable command.
- `group`: output grouping such as `core`, `runtime-tools`, `gateway`, or
  `gateway-smoke`.
- `inputs`: files/globs included in the cache key.
- `deps`: hard DAG dependencies.
- `cacheable`: whether a successful result may be reused.
- `parallel`: whether it may run concurrently with other gates.
- `cost`: scheduler hint (`cheap`, `medium`, `expensive`).
- `resourceClass` and `resourceCost`: resource-token scheduling hints such as
  `node`, `typescript`, `rust`, `gateway-smoke`, or `release`.
- `cachePolicy`: cache semantics (`pass-only` or `never` by default).
- `env`: declared environment variables that participate in the action hash.
- `modes`: profiles such as `quick`, `ci`, or `release`.

Gateway smoke is split into suite gates by behavior surface. The suite ids are
declared in `GATEWAY_SUITE_IDS` and verified against
`node gateway/tests/check-gateway-node.mjs --list-suites --json` by
`scripts/checks/quality-runner/gateway-suite-registry.mjs`.

### 2. Affected selection

Affected rules live in `scripts/lib/quality-affected.mjs`.

Default `npm run check` intentionally **does not** diff against
`origin/main...HEAD`, because this checkout can diverge by hundreds of commits
from its upstream reference. Using the upstream branch as the daily local base
would inflate a small edit into thousands of changed files and reintroduce the
old full-smoke behavior. Daily affected selection therefore uses:

- unstaged changes
- staged changes
- untracked files

`check:prepush` is broader because it adds the quick baseline to the current
affected set, but it still avoids implicit `origin/main...HEAD`. This matters in
this checkout because the upstream reference can represent a large historical
divergence rather than the user's current work. A caller can explicitly request
a branch-diff run with `--base REF` or bypass git detection with
`--changed-files a,b`.

The v2 affected selector is surface-graph based: changed files map to named
surfaces, surfaces expand to gates, and selected gates then include hard DAG
dependencies from the registry. The current graph is intentionally conservative
and keeps unknown files on a safe fallback path.

The v3 selector also supports explicit impact closure. A direct surface can
declare downstream `impacts`, and affected explanation reports both the direct
surface and the impacted surfaces. This keeps the daily path narrow without
silently missing cross-layer contracts. Current examples:

- `runtime.extensions` impacts `runtime.tool-contracts`.
- `gateway.memory` impacts `gateway.context`.
- `gateway.plan` impacts `runtime.plan`.

High-value surfaces:

- `runtime/src/extensions/**`: Rust check/test, runtime-tool schema/report/parity,
  and `runtime:status`. It intentionally does not run broad runtime controls by
  default; those controls protect CLI/env fail-closed surfaces and are selected
  by their own test/source surfaces.
- `runtime/**`: Rust check/test plus `runtime:status` smoke.
- `gateway/tests/check-gateway-node/runtime-smoke/*`: maps to the matching
  runtime suite (`runtime:status`, `runtime:controls`,
  `runtime:failover-core`, `runtime:provider-routing`,
  `runtime:provider-status`, `runtime:namespace-controls`,
  `runtime:start-controls`, `runtime:model-controls`,
  `runtime:status-controls`, `runtime:experience-state-controls`,
  `runtime:tool-context-controls`, `runtime:management-gc-controls`,
  `runtime:tool-loop`, `runtime:mcp-call`, `runtime:mcp-session`,
  `runtime:mcp-server`, `runtime:tool-diagnostics`, `runtime:context`,
  `runtime:plan`, `runtime:recovery`, or `runtime:describe`) instead of
  falling back to generic smoke. The former broad failover/provider/tool/MCP
  bundle is split by behavior surface so local affected runs do not pay a 60s+
  suite when only one helper changed.
- `gateway/src/cli/tui/**` and ask-user UI: gateway TS and `gateway:tui` suite.
- `gateway/src/cli/start/**` or plan paths: gateway TS plus gateway/runtime plan
  suites.
- context/history paths: gateway TS plus context suites.
- memory/experience paths: gateway TS plus memory/context suites.
- `gateway/src/extensions/contracts/runtime-tool-*` and
  `shared/contracts/runtime-tool-quality-v1.json`: focused runtime-tool gates.
- package/toolchain changes: conservative local baseline and suite registry
  checks, but not release-only gates.
- `.cache/**`, `runtime/target/**`, `target/**`, `gateway/dist/**`, and `dist/**`:
  generated/local output ignored for affected selection.

Unknown files fall back to `SAFE_FALLBACK_GATES`, which is intentionally
conservative and includes layer, TypeScript, runtime, and runtime-tool baseline
checks. Use `node scripts/quality-runner.mjs explain affected` to see the file
to surface to gate chain.

### 3. DAG scheduler

The scheduler lives in `scripts/lib/quality-scheduler.mjs`.

- Default parallelism is `min(cpu - 1, 6)`.
- Selected gates automatically include their hard dependencies.
- Dependency failure marks downstream gates as skipped failures so a run cannot
  turn green by omission.
- Scheduler strategy can be `interactive` or `throughput`. Interactive mode
  prioritizes cheap feedback first. Throughput mode uses local historical timing
  and critical-path scores so long DAG paths start earlier.
- Resource tokens prevent oversubscription. Rust and TypeScript compiler gates
  use dedicated resource classes; gateway smoke suites share a separate
  `gateway-smoke` pool instead of consuming all generic Node capacity.
- `parallel: false` gates run in an exclusive window. This is used for shared
  compiler/build-resource gates such as `tsc`, `cargo`, and release scripts.
  Most gateway smoke suites run as isolated child processes with temp workdirs
  and are allowed to run in parallel after their hard dependencies pass.
  Timing benchmarks such as `gateway:semantic-benchmark` stay exclusive and use
  broad ceiling assertions plus structured warning output for trend jitter,
  rather than brittle wall-clock ordering comparisons.
- `node scripts/quality-runner.mjs plan <mode>` prints the executable plan with
  dependency level, estimated duration, critical-path score, resource class, and
  cacheability before running anything.

### 4. Pass-only action cache

Cache files are stored under `.cache/grobot-quality/` and are git-ignored.

Rules:

- Only successful results are cached; failures are never cached.
- Cache keys are action hashes. They include schema version, gate name, command,
  platform, declared env, Node/npm versions, input file contents, and for Rust
  gates `rustc`/`cargo` versions.
- v2 writes an action-cache entry under `ac/<gate>/<hash>.json` and stores
  stdout/stderr payloads in a local content-addressable store under `cas/`.
  The legacy `results/` pass cache is still written for backward compatibility.
- A single runner process reuses git file lists, glob expansion, file digests,
  and tool version probes to reduce repeated scanning.
- v3 persists a best-effort file digest manifest under
  `manifests/file-digests.json`. Each entry is keyed by repo-relative path and
  guarded by `mtimeMs` plus file size. Unchanged files reuse their digest instead
  of being re-read for every action hash, while changed files are immediately
  rehashed and the manifest is refreshed.
- Runtime smoke, gateway smoke, release gates, and `cargo test` are not cached
  by default because they are stateful or expensive enough to deserve fresh
  execution when selected.
- `--no-cache` disables the outer runner cache.
- `node scripts/quality-runner.mjs explain cache <gate>` reports the current
  action hash, cache status, input count, latest cached action, and miss reason.
- `node scripts/quality-runner.mjs cache gc --max-age-days N` performs
  best-effort local cache garbage collection.

### 5. Gateway smoke case/shard registry

The gateway smoke harness supports suite and case discovery:

```bash
node gateway/tests/check-gateway-node.mjs --list-suites --json
npm run check:gateway:list-cases -- --json
node gateway/tests/check-gateway-node.mjs --case runtime:status:full --json
node gateway/tests/check-gateway-node.mjs --suite runtime:status --shard 1/1 --json
node gateway/tests/check-gateway-node.mjs --runtime-smoke-only --workers 4 --json
```

Case ids include stable suite fallbacks (`<suite>:full`) and real split cases
for high-value composite smoke surfaces. Current split cases include:

- `gateway:context:history`
- `gateway:context:prompt-quality`
- `gateway:context:graph`
- `runtime:controls:context-engine`
- `runtime:controls:experience-scheduler`
- `runtime:controls:experience-runtime`
- `runtime:controls:tool-surface-profile`
- `runtime:controls:runtime-bin`
- `runtime:controls:mcp-instruction`
- `runtime:controls:status-line`
- `runtime:context:mcp-instruction`
- `runtime:context:pre-send-head-trim`
- `runtime:context:quality-guard`
- `runtime:context:memory-autotune-tighten`
- `runtime:context:memory-autotune-relax`
- `runtime:context:memory-autotune-hysteresis`
- `runtime:context:graph-autotune`
- `runtime:context:graph-autotune-hysteresis`
- `runtime:context:graph-autotune-adaptive-sequence`

Suite selection expands to split cases when a suite has them; direct
`<suite>:full` cases remain available for aggregate reproduction. Shards are
deterministic and 1-based (`N/TOTAL`). When timing data exists, the shard
partitioner uses greedy longest-processing-time bin packing from
`.cache/grobot-quality/gateway-timings.json`; without timing data it falls back
to stable deterministic distribution. Each case run updates the timing file so
later shards become better balanced.

Gateway smoke also supports replayable run plans:

```bash
node gateway/tests/check-gateway-node.mjs --suite gateway:context --write-run-plan /tmp/gateway-context-plan.json
node gateway/tests/check-gateway-node.mjs --run-plan /tmp/gateway-context-plan.json --workers 3 --json
```

Plan files use schema `1`:

```json
{
  "schema": 1,
  "cases": ["gateway:context:history", "gateway:context:prompt-quality"]
}
```

`--workers N` runs selected cases through isolated child-process workers using
the same timing-aware bin packing, so large gateway smoke profiles can
parallelize internally without forcing the outer quality-runner to know every
suite implementation detail. Parent JSON reports keep the run diagnosable:
worker executions add structured worker bucket entries and aggregate child case
results, while parent `steps` records one `gateway-worker-N` step per worker.
Heavy split suites (`runtime:context`, `runtime:controls`, and
`gateway:context`) are invoked with internal workers from the quality gate
registry so full CI gets the same coverage with less monolithic wall time.

### 6. Events and stats

Every real run appends one line to `.cache/grobot-quality/events.jsonl`.

Use:

```bash
npm run check:quality:stats
node scripts/quality-runner.mjs stats --json
node scripts/quality-runner.mjs stats --slow 20
```

This output is for local tuning only. It helps decide whether the next
optimization should be affected mapping, input narrowing, batching, fixture
reuse, or cache policy. It is safe to delete `.cache/grobot-quality/` and start
over.

Stats now include p50/p90/p95, failure rate, cold durations, and recommendation
hints. Slow uncached smoke gates are intentionally reported as candidates for
case splitting or timing-based sharding, not for blind caching.

## Adding or changing a gate

1. Add or update the gate in `scripts/lib/quality-gate-registry.mjs`.
2. Provide precise `inputs`, `deps`, `modes`, `cacheable`, and `parallel`
   metadata.
3. Add affected rules in `scripts/lib/quality-affected.mjs` if the gate protects
   a new file surface.
4. Update self-checks in `scripts/checks/quality-runner/behavior.mjs` or add a
   focused check under `scripts/checks/quality-runner/`.
5. Run:

```bash
npm run check:quality-runner
node scripts/checks/quality-runner/gateway-suite-registry.mjs
node scripts/quality-runner.mjs plan affected --json
npm run check
```

For CI-equivalent validation:

```bash
npm run check:ci -- --no-cache
```
