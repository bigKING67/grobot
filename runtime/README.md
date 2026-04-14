# Runtime Skeleton

Rust runtime skeleton for Grobot.

## Architecture Positioning

Runtime follows the same `4 execution layers + 1 governance plane` split:

1. `models` (`runtime/src/models`): turn I/O structures and model-executor traits.
2. `tools` (`runtime/src/tools`): tool-executor traits and tool hooks.
3. `extensions` (`runtime/src/extensions`): protocol boundary (`runtime.v1` JSON-RPC).
4. `orchestration` (`runtime/src/orchestration`): turn pipeline orchestration (`before -> model -> after -> events`).
5. `governance` (`runtime/src/governance`): runtime bootstrap limits/policies and guardrail config.

Governance plane is for runtime quality/safety guardrails and lifecycle control, not a direct part of online token generation logic.

## Responsibilities (MVP)

1. One mailbox per `SessionKey`.
2. One active turn per session.
3. Parallel execution across sessions with bounded worker pool.
4. Emit normalized runtime events for gateway streaming.
5. Serve `runtime.v1` JSON-RPC methods over stdio.

## Current Module Layout

- `main.rs`: process bootstrap + stdio loop.
- `models/engine.rs`: shared turn input/output structs.
- `models/model.rs`: models 聚合入口；能力文件在 `models/domains/*`。
- `tools/tools.rs`: tools 聚合入口；能力文件在 `tools/domains/<capability>/*`。
- `extensions/protocol.rs`: extensions 聚合入口；能力文件在 `extensions/domains/*`。
- `orchestration/orchestrator.rs`: orchestration 聚合入口；能力文件在 `orchestration/domains/*`。
- `governance/session.rs`: governance 聚合入口；能力文件在 `governance/domains/*`。

## Layer Directory Contract (Runtime)

1. 职责
   - 执行面四层与治理平面必须分别落在 `runtime/src/{models,tools,extensions,orchestration,governance}`。
   - 每层入口文件仅负责聚合/装配，不承载大段业务实现。
2. 目录规范
   - 各层新增实现默认放在 `domains/` 能力域目录。
   - 工具层必须按能力域拆分（如 `core/fs/shell/mcp`），禁止继续堆叠到 `tools.rs`。
3. 新增模块流程
   - 第一步：在对应层的 `domains/` 下创建能力文件。
   - 第二步：在层入口文件接入 include/mod 聚合。
   - 第三步：补充该层 README 的职责与验证说明。
4. 评审检查点
   - 入口文件是否保持薄层（仅导入与路由）。
   - 能力文件是否按职责归档到正确层与能力域。
   - 行为是否与现有 RPC/事件/工具契约保持兼容。

## Next Steps

1. Add queue ingestion (Redis stream).
2. Add turn state machine (`Queued -> Running -> Completed/Failed/Cancelled`).
3. Add provider routing and tool-policy enforcement.
4. Replace placeholder turn implementation with tool/model execution pipeline.

## Runtime v1 RPC (current)

- `runtime.health`
  - Returns protocol/version/runtime label.
- `runtime.turn.execute`
  - Input: `request_id`, `session_key`, `user_message`, `context_lines[]`
  - Output: placeholder assistant message + normalized event list.
