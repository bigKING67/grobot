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
- Prefer using subagents for `L1-F`, `L1-V`, `L2`, multi-module, or clearly parallelizable work; keep trivial `L0` edits local.
- Before delegating, keep write scopes disjoint and concrete. The main agent remains responsible for reviewing subagent output, integrating changes, and running verification.
- If a higher-priority platform or runtime tool rule restricts `spawn_agent`, follow that rule and note the reason in the handoff or final response.
