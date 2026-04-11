# Skills Routing Rule

目标：降低上下文成本并提升路由准确率。

规则：
- 每轮先扫描 `available_skills` 描述符，不直接读取全部 `SKILL.md`。
- 只有命中路由条件时，才加载对应 skill 正文；单轮最多加载一个 skill。
- `Use when` 与 `Don't use when` 必须同时存在，反例（`Don't use when`）优先级更高。
- 描述符应强调“何时使用/何时不要使用/产出物”，不要写成长手册。
- 高频 skill 才进入默认扫描集合，低频 skill 应按需引入。
- 每轮路由应记录到 JSONL 观测日志（`skills.observability`），用于离线评测误路由与阈值调优。

副作用控制：
- 对外部写操作类 skill（部署、发布、批量写 API），必须显式声明速率限制。
- 执行时优先批量写入，禁止逐条循环调用；遇到 429 必须退避重试。
- 用户明确要求只读分析时，不应路由到副作用 skill。
