# .grobot/rules

Place grobot-specific policy/rule documents here.

Suggested usage:
- Write scenario-specific operating rules, not generic boilerplate.
- Keep `skills-routing.md` as the source of truth for skill usage boundaries.
- Keep MCP usage constraints in dedicated rule files per connector when needed.
- MCP connector instruction packs should be stored under `rules/mcp/<server-name>.md`.
- Keep runtime state placement policy in `state-storage-layout.md`.

Examples:
1. skill routing and anti-misroute rules
2. MCP read/write safety constraints
3. runtime mode guardrails for your business repo
