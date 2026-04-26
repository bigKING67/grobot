这个 `grobot` 项目允许调用 `spawn_agent`：用户已给出长期明确授权；在本 checkout 内处理 `L1-F`、`L1-V`、`L2`、多模块或可并行开发任务时，可按项目规则启用子代理，无需每轮重复确认。若当前 Codex 运行时/平台工具规则以更高优先级临时限制 `spawn_agent`，必须遵循运行时规则并在交付或 handoff 中说明。

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

If you're using Codex, project-scoped helpers may also live in:
- `.agents/skills/` for reusable Trellis skills
- `.codex/agents/` for optional custom subagents

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->

## Project Codex Collaboration Preferences

- In this `grobot` project, the user explicitly allows Codex to call `spawn_agent` for development work when it materially improves quality or speed.
- Treat this repository-level preference as the user's standing explicit authorization for `spawn_agent` while working inside this checkout; do not require the user to re-authorize subagents every turn.
- Prefer using subagents for `L1-F`, `L1-V`, `L2`, multi-module, or clearly parallelizable work; keep trivial `L0` edits local.
- Before delegating, keep write scopes disjoint and concrete. The main agent remains responsible for reviewing subagent output, integrating changes, and running verification.
- If a higher-priority platform or runtime tool rule restricts `spawn_agent`, follow that rule and note the reason in the handoff or final response.
