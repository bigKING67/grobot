# grobot

企业级 Agent 工程实验仓库（Trellis 驱动），目标是基于 `TypeScript + Rust` 打造可在 IM 中调用的高可靠编码代理平台。

## 项目目标

- 支持 Feishu / Telegram 首发接入，后续可扩展更多渠道。
- 支持 100 并发会话，并保证严格会话隔离与可恢复执行。
- 通过流程工程（harness、context、memory、eval、trace、安全）在非顶级模型上获得接近旗舰体验的稳定效果。
- 保持模型供应商可替换（Kimi 2.5、GPT-5.4 级别、OpenAI-compatible 等）。

## 技术栈与边界

- TypeScript: gateway、channel adapters、management API、config orchestration。
- Rust: runtime core（调度、会话状态机、工具执行策略、并发控制）。
- Data plane: PostgreSQL + Redis（后续可扩展对象存储与消息队列）。

## 文档导航

所有核心设计文档位于 `.trellis/spec/guides/`：

- [`agent-platform-blueprint.md`](.trellis/spec/guides/agent-platform-blueprint.md)
  - 主架构蓝图、分层职责、核心控制流、SLO 目标。
- [`agent-gateway-runtime-guide.md`](.trellis/spec/guides/agent-gateway-runtime-guide.md)
  - 会话键规范、事件协议、网关与运行时契约、并发与降级策略。
- [`agent-memory-context-guide.md`](.trellis/spec/guides/agent-memory-context-guide.md)
  - 记忆分层、写入/召回链路、生命周期、上下文压缩策略。
- [`agent-eval-observability-security-guide.md`](.trellis/spec/guides/agent-eval-observability-security-guide.md)
  - 评测门禁、Trace 事件、SLO 告警、安全边界与审计。
- [`agent-implementation-roadmap.md`](.trellis/spec/guides/agent-implementation-roadmap.md)
  - 从 MVP 到企业化的阶段路线图与验收标准。
- [`index.md`](.trellis/spec/guides/index.md)
  - guides 总索引与触发条件。

## Trellis 启动方式

1. 新会话先执行 `/trellis:start`，同步当前项目上下文与协作规则。
2. 从 `index.md` 选择本轮任务对应的 guide（架构、运行时、记忆、评测安全）。
3. 变更前先固定契约与验收标准，变更后补充验证证据。

## 推荐实施顺序

1. 先读 `agent-platform-blueprint.md`，确认边界与目标。
2. 按 `agent-gateway-runtime-guide.md` 固定契约和会话模型。
3. 按 `agent-memory-context-guide.md` 落记忆与上下文策略。
4. 同步接入 `agent-eval-observability-security-guide.md` 的门禁与追踪。
5. 按 `agent-implementation-roadmap.md` 分阶段推进（MVP -> 100并发 -> GA）。

## 参考资料（已采信）

- Anthropic Managed Agents / Harness / Context / Evals
- cc-connect（配置、Bridge 协议、Management API）
- MemOS、Cortex（记忆系统）
- Hermes Agent、IronClaw、Pi Mono（开源工程模式）
- Claude Code Hub（企业网关与调度思路）
- Karpathy LLM Wiki（持久化知识工件模式）

---

## English Summary

`grobot` is an enterprise agent-engineering workspace using Trellis and a TypeScript + Rust split:

- TypeScript for gateway, platform adapters, management APIs, and orchestration.
- Rust for high-concurrency runtime execution, scheduling, and policy enforcement.
- Target: Feishu + Telegram launch, 100 concurrent sessions, strong session isolation, and model-agnostic quality through harness/context/memory/eval/trace/security engineering.

Start from:

- `.trellis/spec/guides/agent-platform-blueprint.md`
- `.trellis/spec/guides/index.md`
