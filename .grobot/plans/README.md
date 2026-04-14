# .grobot/plans

运行期 Plan Mode 工件目录（默认不提交）。

## 目录结构

- `<session_id>/index.json`：计划索引与状态
- `<session_id>/ACTIVE.md`：当前活动计划快照
- `<session_id>/<seq>-<task_slug>--<plan_id>.md`：历史计划文件

## 命名规则

- `seq`：同一 session 内递增序号（001、002、003...）
- `task_slug`：从 `/plan <goal>` 生成的可读 slug
- `plan_id`：全局唯一 ID（防止并发冲突）

## 说明

- `draft` 表示仍在 Plan Mode。
- 执行 `/plan apply` 后会标记为 `applied`。
- 执行 `/plan discard` 后会标记为 `discarded`。
