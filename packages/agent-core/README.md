# @grobot/agent-core (internal)

This directory is the reserved home for Grobot runtime core source and build
metadata used to produce platform binaries.

Current repo uses a TypeScript gateway (`gateway/src/orchestration/dev-cli.ts`) and Rust runtime
(`runtime/src/main.rs`) for source-checkout execution. The release pipeline should
compile core binaries from this internal layer and publish them through platform packages:

At architecture level, Grobot now uses `4 execution layers + 1 governance plane`:
`models/tools/extensions/orchestration` for online execution, and `governance` for
evaluation, testing, and auto-optimization loops.

- `@grobot/core-darwin-arm64`
- `@grobot/core-darwin-x64`
- `@grobot/core-linux-x64`
- `@grobot/core-linux-arm64`

End users install `grobot` and do not interact with this directory directly.
