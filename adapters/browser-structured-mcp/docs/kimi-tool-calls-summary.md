# 使用 Kimi API 完成工具调用（tool_calls）整理

> 来源页面：`https://platform.kimi.com/docs/guide/use-kimi-api-to-complete-tool-calls`  
> 抽取时间：2026-04-15  
> 抽取链路：`browser-structured-mcp`（`tmwd_ws`）  
> 说明：本整理以页面正文语义为主，去除了导航类重复信息与样例噪音。

## 1. 核心结论

- `tool_calls` 是比 `function_call` 更通用的工具调用机制。
- 在兼容语境下，可以把 `function_call` 视为 `tool_calls` 的子集能力。
- 模型负责“决策与参数生成”，工具执行由你的应用/Agent 负责。

## 2. 标准调用闭环（最重要）

1. 定义工具（JSON Schema）。
2. 调用 `chat.completions.create` 时传入 `tools`。
3. 检查模型返回：
 - 若 `finish_reason = "tool_calls"`，读取 `message.tool_calls`。
 - 若 `finish_reason = "stop"`，表示可直接返回用户答案。
4. 对每一个 `tool_call`：
 - 读取 `id`
 - 读取 `function.name`
 - 解析 `function.arguments`（字符串化 JSON）
 - 执行本地真实工具函数
5. 把工具执行结果回传给模型，消息格式必须是 `role = "tool"`，并携带：
 - `tool_call_id`
 - `name`
 - `content`（通常为字符串化结果）
6. 重复 3-5，直到模型返回 `finish_reason = "stop"`。

## 3. 字段速查

- 判定是否工具轮：`finish_reason === "tool_calls"`
- 工具调用列表：`message.tool_calls[]`
- 工具调用 ID：`tool_calls[i].id`
- 工具名：`tool_calls[i].function.name`
- 工具参数：`tool_calls[i].function.arguments`
- 工具结果回传：`role="tool"` + `tool_call_id` + `name` + `content`

## 4. 流式输出（stream）下的关键点

- `finish_reason` 会在最后一个 chunk 才完整出现，不适合早期判定。
- 建议用 `delta.tool_calls` 是否出现来判定工具调用阶段。
- 页面文档强调过一个顺序：可能先出现 `delta.content`，再出现 `delta.tool_calls`。
- 多工具并行时，需按 `index` 分桶拼接每个 `tool_call.function.arguments`。

## 5. 常见坑

## `tool_call_id not found`

- 最常见原因是 `role=tool` 回传时 `tool_call_id` 与模型给出的 `id` 不一致。
- 其次是消息布局错位：assistant 的 tool_calls 与 tool 结果没有按正确顺序衔接。

## `message.content` 误判

- 在 `finish_reason=tool_calls` 时，`message.content` 可能非空（解释性文本）。
- 这不代表最终回答已完成，仍应继续工具循环。

## Token 预算

- `tools` 定义本身会计入 token。
- 应按 `tools + messages` 总量控制上下文窗口。

## 6. 消息布局（建议模板）

典型形态如下：

```text
system: ...
user: ...
assistant: tool_call(name=search, arguments=...)
tool: search_result(tool_call_id=..., name=search)
assistant: tool_call(name=crawl, arguments=...)
tool: crawl_result(tool_call_id=..., name=crawl)
assistant: final answer (finish_reason=stop)
```

## 7. 面向 grobot 的落地清单

- 统一 tool-loop 判定：`finish_reason + message.tool_calls` 双信号。
- 统一 `tool_result` 回传 schema（避免 `tool_call_id` 漂移）。
- 流式聚合器按 `tool_call index` 做增量参数拼接。
- 对外暴露标准事件：
 - `tool_call_detected`
 - `tool_execution_started`
 - `tool_execution_finished`
 - `tool_result_appended`
 - `final_answer_ready`

## 8. 这次抽取的链路证据

- transport: `tmwd_ws`
- endpoint: `ws://127.0.0.1:18765`
- 命中页标题：`使用 Kimi API 完成工具调用（tool_calls） - Kimi API 开放平台`
- 抽取文本长度：约 `27k` 字符
- 章节标题数：`13`
