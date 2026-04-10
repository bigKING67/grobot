# Agent Harness v0

`gateway/evals` 提供一个可落地的 agent-level 评测闭环，用于支撑：

1. `optimization` 与 `holdout` 双集合评估。
2. 多策略 A/B（例如 `lexical` vs `hybrid`）对比。
3. gate 拦截（分 split 阈值 + 关键指标阈值 + holdout regression guard）。

## 目录

- `models.py`: case/run/gate policy schema 与解析。
- `scoring.py`: 五维评分器（task/tool/context/safety/latency_cost）。
- `runner.py`: harness 执行与报告输出。
- `trace_mining.py`: 从 `.grobot/sessions` 自动抽样构建初版 eval case/run 数据。
- `trace_clean.py`: 对抽样数据执行去重、脱敏、审核报告输出。
- `hill_climb.py`: 在多个 variant 间执行“优化优先 + holdout 不退化”爬山选择。
- `gate_policy.default.json`: 默认门禁策略模板。
- `gate_policy.ci.json`: CI 专用 gate 策略。
- `fixtures/*.jsonl`: 示例数据。

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
python3 gateway/evals/runner.py \
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
python3 gateway/evals/trace_mining.py \
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
python3 gateway/evals/trace_clean.py \
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
python3 gateway/evals/trace_pipeline.py \
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
python3 gateway/evals/trace_pipeline.py --policy gateway/evals/trace_pipeline_policy.dev.json
python3 gateway/evals/trace_pipeline.py --policy gateway/evals/trace_pipeline_policy.ci.json
python3 gateway/evals/trace_pipeline.py --policy gateway/evals/trace_pipeline_policy.prod.json
python3 gateway/evals/policy_guard.py --policy gateway/evals/trace_pipeline_policy.dev.json --policy gateway/evals/trace_pipeline_policy.ci.json --policy gateway/evals/trace_pipeline_policy.prod.json
python3 gateway/evals/policy_guard.py --policy gateway/evals/trace_pipeline_policy.dev.json --policy gateway/evals/trace_pipeline_policy.ci.json --policy gateway/evals/trace_pipeline_policy.prod.json --print-json
```

policy 文件约束：

1. 必须包含 `schema`（当前值：`trace_pipeline_policy`）。
2. 必须包含 `schema_version`（当前值：`2`）。
3. `policy_guard.py` 会在 CI 中校验 schema/version 兼容性。
4. 历史 `schema_version=1` 会在加载时自动迁移到 `2`（默认补 `profile=custom`）。
5. `policy_guard.py --print-json` 会输出每个 policy 的 `policy_hash`（基于 canonical policy JSON 的 `sha256`），便于追踪策略漂移。

关键参数：

1. `--min-clean-cases`：清洗后最小样本门槛。
2. `--fail-on-low-sample`：样本不足时直接返回非 0（用于 CI gate）。
3. `--min-cases-per-split`：split 保底保留策略，与 `trace_clean` 逻辑一致。
4. `--min-clean-cases-by-split`：按 split 设门槛（格式 `split:n,split:n`）。
5. `--fail-on-split-underflow`：任一 split 低于门槛时返回非 0。
6. `--dry-validate-only`：只校验输入参数与路径可用性，不执行 mining/cleaning。

## 策略爬山（自动选优）

```bash
python3 gateway/evals/hill_climb.py \
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

## CI Gate（可直接在 GitHub Actions 阻断）

```bash
python3 gateway/evals/runner.py \
  --cases gateway/evals/fixtures/cases.ci.jsonl \
  --runs gateway/evals/fixtures/runs.ci.jsonl \
  --gate-policy gateway/evals/gate_policy.ci.json \
  --fail-on-gate
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
