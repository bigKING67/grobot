# Agent Harness v0

`gateway/evals` 提供一个可落地的 agent-level 评测闭环，用于支撑：

1. `optimization` 与 `holdout` 双集合评估。
2. 多策略 A/B（例如 `lexical` vs `hybrid`）对比。
3. gate 拦截（分 split 阈值 + 关键指标阈值 + holdout regression guard）。

## 目录

- `gateway/src/evals/runner.ts`: case/run/gate policy schema 解析、五维评分器（task/tool/context/safety/latency_cost）、harness 执行与报告输出（CLI 真源）。
- `gateway/src/evals/trace-mining.ts`: 从 `.grobot/sessions` 自动抽样构建初版 eval case/run 数据（CLI 真源）。
- `gateway/src/evals/trace-clean.ts`: 对抽样数据执行去重、脱敏、审核报告输出（CLI 真源）。
- `gateway/src/evals/trace-pipeline.ts`: mining + cleaning 一体化 pipeline（CLI 真源）。
- `gateway/src/evals/trace-policy-guard.ts`: trace pipeline policy 校验与 fingerprint（CLI 真源）。
- Trace mining/cleaning/pipeline/policy-guard 已统一迁移到 TypeScript CLI 真源（`gateway/src/evals/trace-*.ts`）。
- `gateway/src/evals/hill-climb.ts`: 在多个 variant 间执行“优化优先 + holdout 不退化”爬山选择（CLI 真源）。
- `gateway/src/evals/skill-router-eval.ts`: skills 路由离线评测（准确率 + 禁用命中 + gate，CLI 真源）。
- `gateway/src/evals/skill-router-baseline-report.ts`: 从 base commit 生成 skill-router baseline 报告（CLI 真源）。
- `gateway/src/evals/skill-router-ci-gate.ts`: skill-router CI gate 统一入口（CLI 真源，封装 gate/trend 与 `trend_meta` 回填）。
- `gateway/src/evals/skill-router-trend-meta.ts`: skill-router CI 报告 `trend_meta` 归一化工具（TS 真源）。
- `ci_label_policy.json`: harness gate 的 `ci/*` 标签与 PR 汇总评论策略真相源。
- `gateway/src/evals/ci-label-policy-guard.ts`: `ci_label_policy.json` 的 schema/字段校验与 canonical hash（CLI 真源）。
- `ci_label_policy_runtime.js`: GitHub Actions (`github-script`) 共享的策略加载/归一化运行时（标签与评论共用），并输出轻量 `policy shape` 诊断日志（schema/schema_version/unknown/missing fields + `severity=high|medium|low|none`）。
- `ci_policy_drift_report.js`: `gate-summary` 中 policy drift 报告构建运行时（读取 PR 历史 comment marker、统一计算 drift transition/streak）。
- `ci_apply_labels.js`: `apply-suggested-labels` 的自动打标运行时（读取 gate-summary outputs + policy，统一处理安全过滤、缺失标签补建与 stale 标签清理）。
- `ci_trend_action_comment.js`: `notify-trend-action` 的评论 upsert 运行时（读取 gate-summary outputs + policy，统一处理触发、owner/action 合并、状态 marker 与 stale comment 清理）。
- `gateway/src/evals/ci-summary.ts`: 汇总 trace/skill-router/policy-drift 报告并生成 CI summary（CLI 真源）。
- `gateway/src/evals/ci-summary-export.ts`: 从 `harness_ci_summary.json` 生成 `gate-summary` outputs（含 `policy_drift` 扩展字段）并写入 `GITHUB_OUTPUT`（CLI 真源）。
- `gate_policy.default.json`: 默认门禁策略模板。
- `gate_policy.ci.json`: CI 专用 gate 策略。
- `skill_router_policy.dev.json` / `skill_router_policy.ci.json` / `skill_router_policy.prod.json`: skill-router policy 模板。
- `fixtures/*.jsonl`: 示例数据。

## Trace CLI 真相源

1. 默认 trace CLI 入口以 TypeScript 实现为真源（`gateway/src/evals/*.ts`）。
2. Python trace 兼容脚本已移除；统一使用 TS 入口命令（`npx --yes --package tsx@4.20.6 tsx gateway/src/evals/...`）。

## Skill Router CLI 真相源

1. 默认 skill-router CLI 入口以 TypeScript 实现为真源（`gateway/src/evals/skill-router-*.ts`）。
2. CI 主链路（baseline/ci-gate）统一走 TS 入口。

## Case Schema (`cases.jsonl`)

每行一个 JSON object，核心字段：

- `id`: case 唯一标识。
- `split`: `optimization` 或 `holdout`。
- `prompt`: 任务描述。
- `weights`: 各评分维度权重（可选，不填则使用默认）。
- `expectations`: 期望与约束：
  - `required_substrings`
  - `forbidden_substrings`
  - `required_tools`
  - `forbidden_tools`
  - `required_context_items`
  - `latency_budget_ms`
  - `cost_budget_usd`

## Run Schema (`runs.jsonl`)

每行一个 JSON object，核心字段：

- `case_id`: 对应 case。
- `variant`: 策略名（例如 `lexical`、`hybrid`）。
- `assistant_response`: 代理最终回复。
- `used_tools`: 实际调用工具列表。
- `recalled_context`: 召回上下文条目。
- `latency_ms` / `estimated_cost_usd`
- `violations` / `unsafe_actions` / `completed`

## 执行

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/evals/runner.ts \
  --cases gateway/evals/fixtures/cases.sample.jsonl \
  --runs gateway/evals/fixtures/runs.sample.jsonl \
  --gate-policy gateway/evals/gate_policy.default.json \
  --output /tmp/grobot-harness-report.json
```

可选参数：

- `--print-json`: 控制台打印完整报告 JSON。
- `--fail-on-gate`: 任一 gate 失败即返回非 0（适合 CI gate）。

## 从真实会话生成初版数据

```bash
npm run harness:trace-mine -- \
  --sessions-dir .grobot/sessions \
  --cases-output gateway/evals/data/cases.trace.jsonl \
  --runs-output gateway/evals/data/runs.trace_baseline.jsonl \
  --variant trace_baseline \
  --holdout-ratio 0.2 \
  --seed 42
```

该脚本默认在 `metadata.review_required=true` 打标，建议生成后人工抽查与修订期望字段。

## 抽样数据清洗（去重 + 脱敏 + 审核报告）

```bash
npm run harness:trace-clean -- \
  --cases-input gateway/evals/data/cases.trace.jsonl \
  --runs-input gateway/evals/data/runs.trace_baseline.jsonl \
  --cases-output gateway/evals/data/cases.trace.cleaned.jsonl \
  --runs-output gateway/evals/data/runs.trace.cleaned.jsonl \
  --report-output gateway/evals/data/trace_clean_report.json \
  --max-exact-duplicates-per-prompt 2 \
  --similarity-threshold 0.88 \
  --max-near-duplicates-per-anchor 1 \
  --min-cases-per-split 1
```

可选：

1. `--whitelist-case-ids-file <path>`：白名单 case id（每行一个），强制保留。
2. `--similarity-threshold`：近似去重阈值（Jaccard，0-1）。
3. `--max-near-duplicates-per-anchor`：每个锚样本允许保留的近似样本数量。
4. `--min-cases-per-split`：按 split 保底保留样本（例如避免 holdout 被清洗空）。

## 一体化 Trace Pipeline（min sample gate）

```bash
npm run harness:trace-pipeline -- \
  --sessions-dir .grobot/sessions \
  --trace-cases-output gateway/evals/data/cases.trace.jsonl \
  --trace-runs-output gateway/evals/data/runs.trace_baseline.jsonl \
  --clean-cases-output gateway/evals/data/cases.trace.cleaned.jsonl \
  --clean-runs-output gateway/evals/data/runs.trace.cleaned.jsonl \
  --clean-report-output gateway/evals/data/trace_clean_report.json \
  --min-cases-per-split 1 \
  --min-clean-cases 20 \
  --fail-on-low-sample \
  --min-clean-cases-by-split holdout:5,optimization:15 \
  --fail-on-split-underflow
```

也可以直接用 policy 文件（推荐）：

```bash
npm run harness:trace-pipeline:dev
npm run harness:trace-pipeline:ci
npm run harness:trace-pipeline:prod
npm run harness:trace-policy:check
npm run harness:trace-policy:fingerprint
```

policy 文件约束：

1. 必须包含 `schema`（当前值：`trace_pipeline_policy`）。
2. 必须包含 `schema_version`（当前值：`2`）。
3. `trace-policy-guard.ts` 会在 CI 中校验 schema/version 兼容性。
4. 历史 `schema_version=1` 会在加载时自动迁移到 `2`（默认补 `profile=custom`）。
5. `trace-policy-guard.ts --print-json` 会输出每个 policy 的 `policy_hash`（基于 canonical policy JSON 的 `sha256`），便于追踪策略漂移。

关键参数：

1. `--min-clean-cases`：清洗后最小样本门槛。
2. `--fail-on-low-sample`：样本不足时直接返回非 0（用于 CI gate）。
3. `--min-cases-per-split`：split 保底保留策略，与 `trace_clean` 逻辑一致。
4. `--min-clean-cases-by-split`：按 split 设门槛（格式 `split:n,split:n`）。
5. `--fail-on-split-underflow`：任一 split 低于门槛时返回非 0。
6. `--dry-validate-only`：只校验输入参数与路径可用性，不执行 mining/cleaning。

## 策略爬山（自动选优）

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/evals/hill-climb.ts \
  --cases gateway/evals/fixtures/cases.sample.jsonl \
  --runs gateway/evals/fixtures/runs.sample.jsonl \
  --gate-policy gateway/evals/gate_policy.default.json \
  --baseline-variant lexical \
  --min-optimization-gain 0.0 \
  --allow-holdout-drop 0.0
```

爬山规则：

1. 候选 variant 必须先通过 gate。
2. `holdout` 平均分和 pass_rate 不能低于当前策略（可由 `--allow-holdout-drop` 放宽）。
3. 只接受 `optimization` 平均分有净提升的候选。

## Skill Router Eval（路由准确率）

```bash
npm run harness:skill-router:sample
```

说明：

1. case schema：`id`、`prompt`、`expected_skill`（可为空）、`forbidden_skills`（可选）。
2. 输出指标：`accuracy`、`precision`、`recall`、`f1`、`forbidden_violations`。
3. policy schema：`skill_router_eval_policy@v1`，支持 `router_overrides` 与 `gates`（`min_accuracy`、`max_forbidden_violations`、`max_accuracy_drop`、`max_forbidden_increase`）。
4. `--fail-on-gate` 会按 policy gate 返回非 0（适合 CI）。
5. policy 自检可用 `--dry-validate-only`；会输出生效参数和 policy canonical/hash。
6. `--dry-validate-only --print-json` 还会输出 `effective_sources`，用于排查每个参数来自 `cli` / `policy` / `project_toml_default`。
7. 内置 `skill_router_policy.*.json` 默认引用 `fixtures/skill_router_project.toml`，避免评测稳定性被项目主配置漂移影响。
8. 支持趋势回归：`--compare-report <baseline.json> --fail-on-trend`；阈值默认来自 policy gates（CLI 仍可覆盖）。
9. CI 中仅当 base commit 与当前 commit 的 `skill_router_policy.ci.json` blob 一致时才执行 trend 对比；若策略已变更则自动降级为 gate-only，并在报告 `trend_meta` 中记录原因（含 `policy_blob_*` 与 `policy_hash_*` 字段）。
10. `harness:ci-summary` 会输出 `trend_decision_tag`、`trend_decision_severity`、`trend_owner`、`trend_action_hint` 与 `suggested_labels`，用于在 GitHub Summary 第一屏快速判定是否需要人工介入并明确归属人群。
11. `harness:ci-summary --emit-github-annotations` 会基于 `trend_decision_severity` 输出 `::notice::/::warning::/::error::` 注解，PR 页面无需展开 summary 也能看到趋势门禁信号。
12. `harness-gate.yml` 的 `gate-summary` job 会导出 `overall_state`、`trend_owner`、`suggested_labels_csv`、`suggested_labels_json` outputs，可供后续 workflow 做自动打标或通知分派。
13. `harness-gate.yml` 的 `apply-suggested-labels` 与 `notify-trend-action` 会通过 `gateway/evals/ci_apply_labels.js` / `gateway/evals/ci_trend_action_comment.js` 调用 `gateway/evals/ci_label_policy_runtime.js`，读取并归一化 `gateway/evals/ci_label_policy.json`（`safe_label_pattern`、`managed_label_prefixes`、标签颜色/描述、评论 marker、`comment_trigger`、`comment_template`），避免 workflow 硬编码漂移。
14. `apply-suggested-labels` 会调用 `ci_apply_labels.js`，在 PR 事件自动消费 `suggested_labels_json`，并额外把 runtime `policyDiagnostics.severity` 注入 `ci/policy-drift-{high|medium|low|none}` 标签；当 `policy_drift.worsening_alert=true` 时还会注入 `policy_drift.worsening_label`（默认 `ci/policy-drift-worsening`）：仅允许匹配 policy `safe_label_pattern` 的标签；缺失标签按 policy 自动创建后再打标；并会按 `managed_label_prefixes` 自动移除过时 `ci/*` 标签（仅清理托管前缀，包括历史 drift 状态），权限不足或创建/删除失败仅告警不阻断主流程。
15. `notify-trend-action` 会调用 `ci_trend_action_comment.js`，按 policy 的 `comment_trigger` 判定是否需要评论：命中时按 `comment_marker + comment_template` upsert 汇总评论（字段顺序、label、是否 code 样式由 policy 决定）；不命中时若存在旧评论会自动删除，避免信号残留。
16. policy 自检命令：`npm run harness:ci-label-policy:fingerprint`（输出 canonical hash 用于审计策略漂移）。
17. `comment_trigger` 仅允许 `overall_states` 与 `trend_severities` 两个子字段；值必须在 guard 枚举内且不得重复，避免“触发条件看似存在但实际无效”的隐性漂移。
18. `notify-trend-action` 在 workflow 中只保留薄封装，具体逻辑由 `ci_trend_action_comment.js` 处理；policy 依然采用单次读取并复用解析结果（marker/template/trigger 同源），降低脚本漂移与维护成本。
19. runtime 诊断策略漂移时会输出 `core.warning`（包含 `severity` 分级、schema/version 与字段漂移摘要）；形状健康时输出 `core.notice`，便于在 CI 日志快速定位配置不兼容问题。
20. `notify-trend-action` 会把 runtime 诊断结果写入评论字段 `policy_drift`（示例：`high:schema_mismatch`、`medium:missing_fields`），便于 reviewer 在 PR 评论直接看到策略健康度。
21. `ci_label_policy.json` 的 `policy_drift` 区块可配置五件事：`label_prefix`（drift 标签前缀）、`comment_trigger_severities`（即使 trend/overall 未命中也触发评论的漂移级别）、`action_hints`（按漂移级别写入评论 `action` 字段的标准动作建议）、`worsening_alert_threshold`（连续恶化告警阈值）、`worsening_label`（连续恶化专用标签）。
22. `gate-summary` 会额外产出 `policy_drift_report.json`，并把 `severity/reason/worsening_streak/worsening_alert` 写入 `harness_ci_summary.json` 的 `policy_drift` 区块，供下游 machine-readable 消费。
23. `harness_ci_summary.md` 顶部在 `policy_drift.worsening_alert=true` 时会显示告警行（含 streak 与 transition），并且 `--emit-github-annotations` 会优先输出 `Policy Drift Worsening` 注解。
24. `Build policy drift report` 会调用 `ci_policy_drift_report.js`，并在其中复用 `ci_label_policy_runtime.js` 的共享 helper：`extractPolicyDriftStateFromCommentBody` 统一解析 PR 评论中的隐藏状态 marker，`buildPolicyDriftReport` 统一计算 `previous/current`、`worsening_streak` 与阈值告警，`buildPolicyDriftStateMarker` 统一回写 marker，避免 workflow 内联脚本重复维护同一语义。
25. `gate-summary` 额外导出 `policy_drift_transition`、`policy_drift_transition_state`、`policy_drift_severity_delta`、`policy_drift_owner`、`policy_drift_action_hint`；`notify-trend-action` 优先消费这些结构化字段生成评论（owner/action），仅在缺失时回退 policy 默认值，减少同一语义在不同 job 的二次推导漂移。
26. `Build skill-router baseline report (base commit)` 会调用 `gateway/src/evals/skill-router-baseline-report.ts` 统一处理 base SHA 解析、worktree 拉取、baseline 可用性判定与 `GITHUB_OUTPUT` 回填，避免 workflow 里重复维护临时目录与清理细节。
27. `Run skill-router CI gate (with trend check)` 会调用 `gateway/src/evals/skill-router-ci-gate.ts` 统一处理 `gateway/src/evals/skill-router-eval.ts` 的 gate/trend 执行、policy blob 匹配判断与 `trend_meta` 写回，避免 workflow 中维护大段条件分支脚本。

## CI Gate（可直接在 GitHub Actions 阻断）

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/evals/runner.ts \
  --cases gateway/evals/fixtures/cases.ci.jsonl \
  --runs gateway/evals/fixtures/runs.ci.jsonl \
  --gate-policy gateway/evals/gate_policy.ci.json \
  --fail-on-gate

npm run harness:skill-router:gate:ci

npx --yes --package tsx@4.20.6 tsx gateway/src/evals/skill-router-eval.ts \
  --policy gateway/evals/skill_router_policy.ci.json \
  --compare-report gateway/evals/data/skill_router_ci_report.prev.json \
  --fail-on-trend
```

## Gate 行为

默认 gate 会在以下情形 fail：

1. `optimization` / `holdout` 的平均分或 pass_rate 低于阈值。
2. 关键指标（如 `safety_compliance`）低于阈值。
3. 候选策略在 `holdout` 上相对 baseline 发生退化（`regression_guard`）。

## npm 快捷命令

```bash
npm run harness:sample
npm run harness:gate:sample
npm run harness:gate:ci
npm run harness:trace-mine
npm run harness:trace-clean
npm run harness:trace-pipeline
npm run harness:trace-pipeline:dev
npm run harness:trace-pipeline:ci
npm run harness:trace-pipeline:prod
npm run harness:trace-policy:check
npm run harness:trace-policy:fingerprint
npm run harness:trace-pipeline:validate
npm run harness:hill-climb:sample
npm run harness:skill-router:sample
npm run harness:skill-router:gate:ci
npm run harness:skill-router:gate:prod
npm run harness:skill-router:policy:check
npm run harness:skill-router:policy:fingerprint
npm run harness:skill-router:policy:validate
npm run harness:ci-label-policy:check
npm run harness:ci-label-policy:fingerprint
npm run harness:ci-summary
```

`harness:trace-pipeline` 支持参数透传，例如：

```bash
npm run harness:trace-pipeline -- \
  --max-cases 120 \
  --similarity-threshold 0.9 \
  --max-near-duplicates-per-anchor 2 \
  --whitelist-case-ids-file ./gateway/evals/data/whitelist.txt
```

## 推荐参数模板

1. `dev`（快速调试）：

```bash
npm run harness:trace-pipeline:dev
```

2. `ci`（稳定门禁）：

```bash
npm run harness:trace-pipeline:ci
```

3. `prod`（真实样本）：

```bash
npm run harness:trace-pipeline:prod
```

4. policy 漂移审计（输出 canonical hash）：

```bash
npm run harness:trace-policy:fingerprint
```

5. pipeline 只做配置/路径预检（不跑数据）：

```bash
npm run harness:trace-pipeline:validate
```
