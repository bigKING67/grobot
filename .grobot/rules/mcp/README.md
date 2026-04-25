# .grobot/rules/mcp

MCP connector-specific instruction packs.

Naming rule:
- One file per server: `<server-name>.md`
- `<server-name>` must match the MCP registry `[[servers]].name`

Loading order (`[mcp.instructions].scope = "project_first"`):
1. `<repo>/.grobot/rules/mcp/<server>.md`
2. `<home>/rules/mcp/<server>.md` fallback

Examples:
- `grok-search.md`
- `contextweaver.md`
- `browser-structured.md`
- `js-reverse.md`
