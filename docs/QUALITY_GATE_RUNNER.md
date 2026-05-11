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
  `node`, `typescript`, `rust`, `gateway-smoke`, or `release`. Runtime gateway
  smoke suites with internal workers reserve three `gateway-smoke` tokens so
  the outer scheduler does not stack multiple process-heavy suites on the same
  machine and turn a 7s isolated suite into a 20s+ noisy overlap.
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
- `runtime:mcp-session` keeps the idle-reap correctness contract but uses a
  test-local one-second MCP session TTL. This avoids paying a production-like
  ten-second wall-clock wait in every CI run while still proving the runtime
  reaps and respawns an idle MCP process.
- `gateway/src/extensions/contracts/runtime-smoke-contract/mcp-cases.mjs` maps
  directly to the MCP call/session/server suites, so edits to shared MCP
  contract helpers cannot silently fall back to unrelated gateway smoke.
- Timing estimates use the current gate command fingerprint and a recency
  weighted cold window before falling back to historical averages. This keeps
  scheduler plans responsive after a slow suite is split or a fixed wait is
  removed, instead of letting stale samples dominate critical-path ordering.
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
- Cache hits are resolved before a gate consumes worker parallelism or resource
  tokens, while still satisfying dependencies and restoring declared outputs.
  Repeated runs therefore do not let many already-cached gates delay the few
  remaining cold gates.
- Resource tokens prevent oversubscription. Rust and TypeScript compiler gates
  use dedicated resource classes; gateway smoke suites share a separate
  `gateway-smoke` pool instead of consuming all generic Node capacity.
- `parallel: false` gates use scoped exclusive groups instead of a blanket
  global lock. Rust gates serialize only the `rust` resource class, TypeScript
  gates serialize only the `typescript` class, and release gates serialize only
  `release`. This keeps compiler/build resources safe without blocking
  unrelated gateway smoke work. Timing benchmarks such as
  `gateway:semantic-benchmark` explicitly use `exclusiveGroup=global`, stay
  globally exclusive, and use broad ceiling assertions plus structured warning
  output for trend jitter rather than brittle wall-clock ordering comparisons.
  The default CI/prepush semantic benchmark gate runs the quick case directly:
  `node gateway/tests/check-gateway-node.mjs --case gateway:semantic-benchmark:smoke --json`.
  That case uses the `benchmark-smoke` profile so daily gates keep a stable
  signal without paying the full sample matrix. The full benchmark remains
  available as the release-only suite `gateway:semantic-benchmark-full` and as
  the aggregate reproduction case `gateway:semantic-benchmark:aggregate`; it
  must stay globally exclusive rather than being sharded with other smoke work.
  Most gateway smoke suites run as isolated child processes with temp workdirs
  and are allowed to run in parallel after their hard dependencies pass.
- `node scripts/quality-runner.mjs plan <mode>` prints the executable plan with
  dependency level, estimated duration, critical-path score, resource class, and
  cacheability before running anything.

### 4. Normalized action contracts and pass-only cache

Cache files are stored under `.cache/grobot-quality/` and are git-ignored.

Each registry gate is normalized into an explicit action contract before it is
planned, timed, or cached. The contract is the quality-runner equivalent of a
small hermetic build action:

- `name`, `command`, and `workdir`.
- declared `inputs` and `outputs`.
- declared environment allowlist `env`.
- declared toolchain dimensions (`node`, `npm`, and for Rust gates `cargo` /
  `rustc`).
- `deps`, `group`, `modes`, `resourceClass`, `resourceCost`,
  `exclusiveGroup`, and cache policy.

The action contract has its own `sha256:` fingerprint. Timing fingerprints and
cache action hashes are derived from this normalized contract instead of
rebuilding separate ad-hoc hashes from loose gate fields. `plan --json` exposes
`actionContractFingerprint`, and `explain cache <gate>` prints both the current
action hash and the contract fingerprint. This makes cache misses and timing
model resets auditable: changing a command, declared input set, resource
contract, cache policy, or declared env boundary intentionally creates a new
action identity.
Action cache entries also store component digests for `contract`, `env`,
`files`, `platform`, and `toolchains`. When `explain cache <gate>` misses but a
previous action entry exists, the miss reason names the changed component set
instead of only reporting an opaque hash drift. This is intentionally similar to
modern build runners: cache misses must be debuggable before the cache can be
trusted for broader or remote use.

Rules:

- Only successful results are cached; failures are never cached.
- Cache keys are action hashes. They include schema version, gate name, command,
  platform, declared env values, declared toolchain versions, and input file
  contents through the normalized action contract. Undeclared environment
variables intentionally do not affect the hash.
- v2 writes an action-cache entry under `ac/<gate>/<hash>.json` and stores
  stdout/stderr payloads in a local content-addressable store under `cas/`.
  The legacy `results/` pass cache is still written for backward compatibility.
- Action cache entries record declared output manifests. Gates with
  `outputs=[]` are explicitly tagged `outputRestorePolicy=no-output` so a cache
  hit never pretends to restore artifacts. Gates that declare outputs are tagged
  `outputRestorePolicy=declared-outputs` and store path/type/size/digest
  metadata for each declared file output, with file bytes stored in the local
  CAS. On cache hit, declared file outputs are restored before the gate is
  reported as cached; if a required CAS entry is missing, the cache entry is not
  reused and `explain cache` reports `cached output missing from CAS: <path>`.
  `explain cache` verifies that declared outputs are restorable without
  mutating the worktree; only an actual cache-hit run restores files. Output
  declarations must be normalized repo-relative paths: absolute paths, empty
  paths, and `..` parent-directory segments are rejected before cache lookup or
  restore. Output declaration changes are part of the action contract
  fingerprint.
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
- Runtime model tests keep fail-closed config assertions on a deterministic
  no-request mock-server path. Tests that prove invalid config fails before
  `/models` should not register unused canned responses, because joining an
  unused response slot waits for the mock listener deadline and creates a hidden
  five-second tail without adding coverage.
- `--no-cache` disables the outer runner cache.
- `node scripts/quality-runner.mjs explain cache <gate>` reports the current
  action hash, action contract fingerprint, cache status, input/output count,
  output restore policy, latest cached action, and miss reason.
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
- `gateway:plan:input-keybinding`
- `gateway:plan:failure-policy`
- `gateway:plan:mode`
- `gateway:plan:user-commands`
- `gateway:plan:agents-instructions`
- `gateway:plan:slash-suggestions`
- `gateway:plan:bridge-cli`
- `gateway:plan:bridge-apply-failure`
- `gateway:plan:bridge-error-codes`
- `gateway:plan:events-policy`
- `gateway:plan:quality-benchmark`
- `gateway:semantic-benchmark:smoke`
- `gateway:semantic-benchmark:aggregate` (aggregate-only full benchmark
  reproduction; release suite also exposes `gateway:semantic-benchmark-full`)
- `gateway:tui:browser-health`
- `gateway:tui:rendering`
- `gateway:tui:activity-status`
- `gateway:tui:bottom-ask-panel`
- `gateway:tui:ask-skill`
- `runtime:status:interrupt`
- `runtime:status:stdio-event-stream`
- `runtime:status:surface`
- `runtime:status:window-size`
- `runtime:controls:context-engine`
- `runtime:controls:context-engine-env` (aggregate-only reproduction)
- `runtime:controls:context-engine-env-core` (focused-only reproduction)
- `runtime:controls:context-engine-env-adaptive` (focused-only reproduction)
- `runtime:controls:context-engine-toml` (aggregate-only reproduction)
- `runtime:controls:context-engine-toml-basic` (focused-only reproduction)
- `runtime:controls:context-engine-toml-thresholds` (focused-only reproduction)
- `runtime:controls:context-engine-toml-window` (focused-only reproduction)
- `runtime:controls:context-engine-validator`
- `runtime:controls:context-engine-status`
- `runtime:controls:context-engine-valid-boundary`
- `runtime:controls:experience-scheduler`
- `runtime:controls:experience-scheduler-env` (focused-only reproduction)
- `runtime:controls:experience-scheduler-toml` (focused-only reproduction)
- `runtime:controls:experience-scheduler-validator`
- `runtime:controls:experience-scheduler-valid-boundary`
- `runtime:controls:experience-runtime`
- `runtime:controls:experience-runtime-start` (aggregate-only reproduction)
- `runtime:controls:experience-runtime-start-team`
- `runtime:controls:experience-runtime-start-config`
- `runtime:controls:experience-runtime-serve`
- `runtime:controls:tool-surface-profile`
- `runtime:controls:runtime-bin`
- `runtime:controls:mcp-instruction` (aggregate-only reproduction)
- `runtime:controls:mcp-instruction-basic` (focused-only reproduction)
- `runtime:controls:mcp-instruction-scope` (focused-only reproduction)
- `runtime:controls:mcp-instruction-server` (focused-only reproduction)
- `runtime:controls:mcp-instruction-validator`
- `runtime:controls:mcp-instruction-valid-disabled-boundary`
- `runtime:controls:status-line` (aggregate-only reproduction)
- `runtime:controls:status-line-validator`
- `runtime:controls:status-line-basic` (focused-only reproduction)
- `runtime:controls:status-line-segment-order` (focused-only reproduction)
- `runtime:controls:status-line-thresholds` (focused-only reproduction)
- `runtime:controls:status-line-cache` (focused-only reproduction)
- `runtime:controls:status-line-segment-toggle` (focused-only reproduction)
- `runtime:controls:status-line-valid-boundary`
- `runtime:start-controls:runtime-options`
- `runtime:start-controls:provider-env`
- `runtime:start-controls:maintenance-env`
- `runtime:start-controls:memory-maintenance-env`
- `runtime:start-controls:context-window-env`
- `runtime:start-controls:ask-user-ttl-env`
- `runtime:start-controls:runtime-controls`
- `runtime:experience-state-controls:experience`
- `runtime:experience-state-controls:experience-publish`
- `runtime:experience-state-controls:experience-recall`
- `runtime:experience-state-controls:storage-session`
- `runtime:experience-state-controls:storage`
- `runtime:experience-state-controls:storage-cli`
- `runtime:experience-state-controls:storage-env`
- `runtime:experience-state-controls:storage-toml`
- `runtime:experience-state-controls:session`
- `runtime:experience-state-controls:session-history`
- `runtime:experience-state-controls:session-rewind`
- `runtime:experience-state-controls:session-handoff-env`
- `runtime:management-gc-controls:management-config`
- `runtime:management-gc-controls:management-cli`
- `runtime:management-gc-controls:management-policy`
- `runtime:management-gc-controls:management-storage`
- `runtime:management-gc-controls:management-env`
- `runtime:management-gc-controls:management-token`
- `runtime:management-gc-controls:management-experience`
- `runtime:management-gc-controls:gc`
- `runtime:management-gc-controls:gc-cli`
- `runtime:management-gc-controls:gc-env`
- `runtime:management-gc-controls:gc-toml`
- `runtime:tool-context-controls:tool-start`
- `runtime:tool-context-controls:tool-status`
- `runtime:tool-context-controls:context-status`
- `runtime:tool-context-controls:aggregate`
- `runtime:context:mcp-instruction`
- `runtime:context:pre-send-head-trim`
- `runtime:context:quality-guard`
- `runtime:context:memory-autotune-tighten`
- `runtime:context:memory-autotune-relax`
- `runtime:context:memory-autotune-hysteresis`
- `runtime:context:graph-autotune`
- `runtime:context:graph-autotune-hysteresis`
- `runtime:context:graph-autotune-adaptive-sequence`
- `runtime:plan:mode`
- `runtime:plan:artifact-controls`
- `runtime:plan:bare-interactive`
- `runtime:plan:diagnostics-base`
- `runtime:plan:diagnostics-command`
- `runtime:plan:diagnostics-plan-command`
- `runtime:plan:diagnostics-skill-creator`
- `runtime:plan:diagnostics-user-command`
- `runtime:plan:im-only`
- `runtime:plan:session-commands`
- `runtime:plan:session-menu`
- `runtime:plan:concurrency`
- `runtime:plan:events-policy`
- `runtime:model-controls:kimi-options`
- `runtime:model-controls:prompt-cache`
- `runtime:model-controls:provider`
- `runtime:model-controls:search-routing`
- `runtime:model-controls:cli-env`
- `runtime:model-controls:valid-boundary`
- `runtime:provider-status:upstream-failure`
- `runtime:provider-status:persisted-failure`
- `runtime:provider-status:clean-alternate`
- `runtime:provider-status:management-api`
- `runtime:describe:memory-legacy-fallback`
- `runtime:describe:unavailable`
- `runtime:describe:fallback-diagnostic`
- `runtime:describe:invalid-schema-status`
- `runtime:describe:invalid-schema-start`
- `runtime:describe:legacy-flag`
- `runtime:describe:python-gateway`
- `runtime:describe:legacy-env`
- `runtime:describe:serve-config-policy-auto`
- `runtime:describe:serve-config-policy-disabled`
- `runtime:describe:interrupt-ttl`
- `runtime:describe:memory-input`
- `runtime:describe:experience-input`

Suite selection expands to split cases when a suite has them; direct
`<suite>:full` cases remain available for aggregate reproduction. Shards are
deterministic and 1-based (`N/TOTAL`). When timing data exists, the shard
partitioner builds a longest-processing-time estimate and, for bounded case
counts, improves it with an exact branch-and-bound bucket planner from
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
the same timing-aware bucket planner, so large gateway smoke profiles can
parallelize internally without forcing the outer quality-runner to know every
suite implementation detail. Parent JSON reports keep the run diagnosable:
worker executions add structured worker bucket entries and aggregate child case
results, while parent `steps` records one `gateway-worker-N` step per worker.
Heavy split suites (`gateway:plan`, `gateway:context`, `gateway:tui`,
`runtime:status`, `runtime:context`, `runtime:controls`, `runtime:experience-state-controls`,
`runtime:management-gc-controls`, `runtime:plan`, `runtime:model-controls`,
`runtime:provider-status`, and `runtime:describe`) are invoked with internal
workers from the quality gate registry so full CI gets the same coverage with
less monolithic wall time.
Gateway plan cases are split by contract domain (input/keybinding, failure
policy, plan mode, user commands, instructions, slash suggestions, bridge
CLI/apply/error-codes, events policy, and benchmark) while preserving
`gateway:plan:full` as the aggregate reproduction path. The heavier plan bridge
and eval contracts route TypeScript scripts through the local `node_modules/.bin/tsx`
when available, avoiding repeated `npx --package tsx` launcher work on the hot
path while keeping the same fallback command for source checkouts without
installed dependencies. Gateway context prompt-quality contracts batch related
contract commands inside one `context-engine-contract.ts` process, and the
context graph persistent-index case keeps cold, incremental-update, and
cross-repo assertions in a single sequence command. This preserves the
aggregate `gateway:context:full` reproduction path while avoiding repeated
TypeScript launcher overhead on the hot path. Gateway TUI cases are split by browser/health,
rendering, activity/status, bottom/ask panel, and ask/skill surfaces while
preserving `gateway:tui:full` as the aggregate reproduction path. Runtime status
cases are split by build/interrupt, stdio event stream, main status surface, and
window-size surface. The shared runtime binary guard skips `cargo build` when
the debug binary is newer than `runtime/Cargo.toml`, `runtime/Cargo.lock`, and
`runtime/src/**`, and serializes the rare rebuild through a local lock so
`runtime:status` does not fight `cargo test` on the common hot path. The
`runtime:plan:events-policy` case intentionally creates fresh plan-mode and
concurrency event sources before running the report/policy checks, so it stays
replayable as an isolated worker case instead of depending on sibling case
side-effects. Runtime model-control cases are split by validation domain (Kimi
options, prompt cache, provider metadata, search routing, CLI/env overrides,
and valid boundary) while preserving `runtime:model-controls:full` as the
aggregate reproduction path. Runtime provider-status cases are split by
route-diagnostic surface (upstream failure text/redaction, persisted status and
registry data, clean alternate selection, and management API status) while
preserving `runtime:provider-status:full` as the aggregate reproduction path.
Runtime describe fallback cases are split by fallback/invalid-runtime surface
and management validation domain while preserving `runtime:describe:full` as
the aggregate reproduction path.
Runtime controls cases keep the original aggregate case ids available for
focused reproduction, but suite selection runs finer case-level shards for the
large domains: context-engine validator/status/boundary, experience scheduler
validator/boundary, experience runtime start team/config and serve, MCP
instruction validator/disabled-boundary, and status-line validator/boundary.
Focused context-engine env core/adaptive and TOML basic/threshold/window cases
remain listed for targeted reproduction but are not selected by the default
suite because the validator shard already batches those pure config checks
through one production resolver process.
Focused experience-scheduler env/TOML cases remain listed for targeted
reproduction but are not selected by the default suite because the validator
shard already batches those pure config checks through one production resolver
process.
Focused MCP instruction basic/scope/server cases remain listed for targeted
reproduction but are not selected by the default suite because the validator
shard already batches those pure config checks through one production resolver
process.
Focused status-line basic/order/threshold/cache/segment cases remain listed for
targeted reproduction but are not selected by the default suite because the
validator shard already batches those pure TOML checks through one production
parser process. New high-value split cases carry seed timing estimates
in `case-definitions.mjs`, and the gateway case timing cache records EWMA,
p90, last, and recent samples per timing context. Internal worker runs write a
`suite-worker` timing context; suite bucket planning compares that context with the
global historical estimate so focused reproduction timings cannot understate the
default parallel plan while real suite-worker spikes are still retained. This
keeps worker scheduling from being driven by zero-cost unknowns, stale
averages, or context-polluted fast samples. Estimates use trimmed recent p90
once enough samples exist, and only trust `lastMs` when it is within the normal
recent band, so a single machine-contention spike cannot permanently overpack or
underpack later worker buckets. The quality registry runs this suite with five
internal workers so CI no longer serializes the former large control monoliths.
Set `GROBOT_GATEWAY_TIMINGS_PATH=<path>` when benchmarking alternate timing
snapshots without mutating the default `.cache/grobot-quality/gateway-timings.json`
cache; set `GROBOT_GATEWAY_TIMING_CONTEXT=<name>` only for harness experiments.
Do not merge optimization experiments that only improve focused micro-runs:
runtime controls benchmarking on 2026-05-11 showed that grouping valid-boundary
start cases into one parent process was slower than the existing worker plan
because it lost parallelism (`~3.8-4.0s` sequential grouped boundary sample
versus `~2.8s` parallel boundary sample). Worker-count sweeps also kept
`--workers 5` as the best default range for this suite (`3/4` under-parallelize;
`6` adds contention without stable wall-clock gains). Bypassing the Node
contract wrapper for valid-boundary start flows did not materially improve the
hot path either; the decisive cost is the real `./grobot start` boundary reaching
runtime, not wrapper startup. Keep such changes out unless a fresh A/B run proves
stable full-suite wall-clock improvement without reducing aggregate
reproduction coverage.
Context-engine default controls use `context-engine-config-validator-contract.mjs`
to batch pure env/project config validation in one local `tsx` process through
the production `resolveContextEngineConfig` resolver; the aggregate
`runtime:controls:context-engine` case still runs the full `./grobot start`
smoke path for end-to-end reproduction.
Status-line default controls use `status-line-config-validator-contract.mjs` to
batch pure project TOML validation in one local `tsx` process through the production
`readStatusLineConfigFromProjectToml` parser; the aggregate
`runtime:controls:status-line` case still runs the full `./grobot start` smoke
path for end-to-end reproduction.
Experience-scheduler default controls use
`experience-scheduler-config-validator-contract.mjs` to batch pure env/project
config validation in one local `tsx` process through the production
`resolveExperienceSchedulerConfig` resolver; the aggregate
`runtime:controls:experience-scheduler` case still runs the full
`./grobot start` smoke path for end-to-end reproduction.
MCP instruction default controls use
`mcp-instruction-config-validator-contract.mjs` to batch pure project TOML and
MCP registry validation in one local `tsx` process through the production
`resolveMcpInstructionRuntime` resolver; the aggregate
`runtime:controls:mcp-instruction` case still runs the full `./grobot start`
smoke path for end-to-end reproduction.
Runtime start controls are split by control source: CLI runtime options,
provider env controls, memory maintenance env, context-window env, and
ask-user TTL env controls. The aggregate `runtime:start-controls:runtime-controls`
and `:maintenance-env` cases remain available for focused reproduction, while
suite selection runs the finer split cases in a single process because early
input validation makes the suite smaller than the child-worker startup and
resource-contention cost.
Runtime experience/state controls are split by experience publish/recall,
storage CLI/env/TOML, and session history/rewind/handoff-env controls. The
aggregate `:experience`, `:storage`, `:session`, and `:storage-session` cases
remain for focused reproduction, while suite selection runs the eight focused
cases with four internal workers because the worker critical path is lower than
the single-process path.
Runtime management/GC controls follow the same split-case pattern: management
config validation is split into read-policy, storage/Redis, env, token/TOML,
and experience controls, while the aggregate `:management-cli` case remains for
focused reproduction. GC validation is split into CLI, env, and
TOML/default-policy cases.
The standard `runtime:management-gc-controls:full` suite fallback plus
`:management-config` and `:gc` remain available as aggregate reproduction
cases, but suite selection runs the finer shards with four internal workers.
Runtime tool/context controls are split into tool-loop start validation,
tools-allow status validation, and context status validation cases. The
aggregate `runtime:tool-context-controls:aggregate` and suite fallback
`runtime:tool-context-controls:full` remain available for focused reproduction,
while suite selection runs the focused cases with three internal workers.
Runtime plan diagnostics keep `runtime:plan:diagnostics-command` as the
aggregate reproduction case, but plan-command, skill-creator, and user-command
diagnostic variants are also exposed as separate case ids so the internal
worker bin-packer can distribute the slow interactive diagnostics surface
without weakening any compact/verbose assertions.
The runtime context memory-decay hysteresis case uses seeded prompt-quality
evidence and an aggressive test-local EMA alpha to prove tighten, no-early-relax,
monotonic update, and relax-window behavior in at most three relax rounds instead
of waiting through the production-length convergence window.

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
case splitting or timing-based sharding, not for blind caching. Timing-sensitive
benchmark gates are treated differently: the preferred recommendation is profile
separation (quick smoke vs. full benchmark) while preserving global exclusivity,
because blind sharding can contaminate the performance signal.

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
