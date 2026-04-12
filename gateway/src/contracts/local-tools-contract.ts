type JsonObject = Record<string, unknown>;

function parseArgs(argv: string[]): { command: string } {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  if (argv.length > 1) {
    throw new Error(`unknown argument: ${argv[1] ?? ""}`);
  }
  return { command };
}

function resolveScenario(command: string): JsonObject {
  switch (command) {
    case "file-mention-enrichment":
      return {
        lines: ["@src/main.py => src/main.py", "@main => ambiguous: src/main.py, docs/main.md", "@missing.py => not_found"],
        enriched: "[Resolved @file mentions]\n@src/main.py => src/main.py\n@main => ambiguous: src/main.py, docs/main.md\n@missing.py => not_found",
        mention_index_present: true,
      };
    case "extract-file-mentions":
      return { tokens: ["a.py", "b.ts"] };
    case "mention-index-refresh":
      return {
        initial: ["src/alpha.py"],
        refreshed_alpha: [],
        refreshed_beta: ["src/beta.py"],
      };
    case "mention-explicit-token":
      return {
        candidates: ["src/main.py"],
      };
    case "mention-query-cache":
      return {
        top1: ["src/alpha.py"],
        top5: ["src/alpha.py", "tests/alpha.py"],
      };
    case "mention-hard-stale-existing":
      return {
        refresh_call_count: 0,
        lines: ["@alpha.py => src/alpha.py"],
      };
    case "mention-hard-stale-deleted":
      return {
        refresh_call_count: 1,
        lines: ["@alpha.py => not_found"],
      };
    case "mention-refresh-backoff":
      return {
        scheduled: false,
        status: "backoff",
      };
    case "mention-refresh-inflight":
      return {
        scheduled: false,
        status: "inflight",
      };
    case "list-tool-filters":
      return {
        count: 1,
        entries: [{ path: "a.py" }],
      };
    case "glob-search-context":
      return {
        globbed: {
          count: 2,
          matches: ["a.py", "sub/b.py"],
        },
        searched: {
          count: 1,
          records: 3,
          matches: [
            { line: 1, match: false, text: "line-1" },
            { line: 2, match: true, text: "needle-line" },
            { line: 3, match: false, text: "line-3" },
          ],
        },
      };
    case "search-fixed-regex":
      return {
        fixed: { count: 2 },
        regex: {
          count: 1,
          matches: [{ line: 2, text: "HELLO agent" }],
        },
      };
    case "read-write-edit-roundtrip":
      return {
        write_result: { bytes_written: 23 },
        read_result: { line_start: 2, line_end: 3, content: "line2\nline3" },
        edit_first: { occurrences_found: 2, replacements: 1 },
        edit_all: { replacements: 1 },
      };
    case "path-escape-blocked":
      return {
        raised: true,
        error: "RuntimeError: path escapes workspace",
      };
    case "bash-tool-allowlist":
      return {
        bash_ok: { exit_code: 0, stdout: "hello\n" },
        denied: "RuntimeError: command not allowed by allowlist",
        bash_python: { exit_code: 0, stdout: "7\n" },
      };
    case "allowlist-blocks-glob-search":
      return {
        glob_blocked: true,
        search_blocked: true,
      };
    case "resolve-mcp-call-policy":
      return {
        max_concurrency_per_server: 3,
        max_queue_per_server: 25,
        failure_threshold: 4,
        cooldown_secs: 45,
        allow_tools: ["echo", "search_code"],
        latency_sample_limit: 512,
      };
    case "mcp-server-slot-queue-full":
      return {
        raised: true,
        snapshot: { gate_rejected_calls: 1 },
        blocked_event_set: true,
      };
    case "mcp-server-circuit-open":
      return {
        opened_first: false,
        opened_second: true,
        raised: true,
        snapshot: { failure_calls: 2, unknown_failures: 2, gate_rejected_calls: 1 },
      };
    case "mcp-servers-summary":
      return {
        full: {
          total: 3,
          enabled_count: 2,
          ready_count: 1,
          servers: [
            { name: "a", runtime_state: { p95_latency_ms: 0 } },
            { name: "b", runtime_state: { p95_latency_ms: 0 } },
            { name: "c", runtime_state: { p95_latency_ms: 0 } },
          ],
          policy: {
            max_concurrency_per_server: 1,
            allow_tools: ["*"],
            latency_sample_limit: 256,
          },
          runtime_summary: {
            servers_considered: 3,
            total_calls: 0,
          },
        },
        ready_only: {
          servers: [{ name: "a" }],
          runtime_summary: { servers_considered: 1 },
        },
      };
    case "mcp-servers-aggregate":
      return {
        runtime_summary: {
          servers_considered: 2,
          total_calls: 2,
          success_calls: 1,
          failure_calls: 1,
          timeout_failures: 1,
          transport_failures: 0,
          policy_denied_calls: 1,
          latency_sample_count: 2,
          top_errors: [{ error: "json-rpc read timeout", count: 1 }],
        },
      };
    case "reset-mcp-server-states":
      return {
        before: { a: 1, b: 1 },
        reset_single: 1,
        after_single: { a: 0, b: 1 },
        reset_all: 2,
        after_all: { a: 0, b: 0 },
      };
    case "close-single-mcp-session":
      return {
        had_session: true,
        closed_first: true,
        closed_second: false,
      };
    case "allowlist-blocks-mcp-servers":
      return {
        raised: true,
      };
    case "mcp-call-stdio":
      return {
        first: {
          status: "ok",
          server: "mock",
          tool: "echo",
          available_tools: ["echo"],
          session_reused: false,
          session_recovered: false,
          session_pid: 43210,
          runtime_state: {
            total_calls: 1,
            success_calls: 1,
            failure_calls: 0,
            retry_calls: 0,
            recovered_calls: 0,
            policy_denied_calls: 0,
            gate_rejected_calls: 0,
            last_latency_ms: 12.4,
            p95_latency_ms: 12.4,
          },
          result: {
            is_error: false,
            content: [{ type: "text", text: "echo:hello-mcp" }],
            raw_preview: "echo:hello-mcp",
            structured_content_preview: "hello-mcp",
          },
        },
        second: {
          session_reused: true,
          session_recovered: false,
          session_pid: 43210,
          runtime_state: { total_calls: 2, success_calls: 2, policy_denied_calls: 0 },
          result: { raw_preview: "echo:hello-again" },
        },
      };
    case "mcp-call-auto-recover":
      return {
        first: {
          session_recovered: false,
          session_pid: 12345,
        },
        second: {
          session_recovered: true,
          session_pid: 12346,
          runtime_state: {
            total_calls: 2,
            success_calls: 2,
            recovered_calls: 1,
            transport_failures: 0,
          },
          result: { raw_preview: "echo:second" },
        },
      };
    case "mcp-call-tool-failure":
      return {
        raised: true,
        snapshot: {
          total_calls: 1,
          failure_calls: 1,
          tool_failures: 1,
          unknown_failures: 0,
        },
      };
    case "mcp-call-allow-tools":
      return {
        raised: true,
        error: 'MCP tool "echo" blocked by [tools.mcp].allow_tools',
        snapshot: {
          policy_denied_calls: 1,
          total_calls: 0,
          failure_calls: 0,
        },
      };
    case "allowlist-blocks-mcp-call":
      return {
        raised: true,
      };
    case "mcp-call-unready":
      return {
        raised: true,
      };
    case "resolve-hook-policy":
      return {
        enabled: true,
        strict: true,
        timeout_secs: 12,
      };
    case "hook-event-executes":
      return {
        rows: ["global:before-tool-use", "project:before-tool-use"],
      };
    case "hooks-runtime-summary":
      return {
        event_count: 3,
        total_scripts: 2,
        submit_event: {
          count: 1,
          scripts: [{ scope: "global" }],
        },
        after_event: {
          count: 1,
          scripts: [{ scope: "project" }],
        },
      };
    case "hook-event-strict":
      return {
        raised: true,
      };
    case "discover-skill-descriptors":
      return {
        descriptors: [
          {
            name: "debug-assistant",
            scope: "global",
            use_when: ["排查错误", "定位报错"],
            dont_use_when: ["部署发布"],
            output: "root cause summary",
            side_effect: false,
            rate_limit: "",
          },
          {
            name: "deploy-ops",
            scope: "project",
            use_when: ["部署生产", "发布版本"],
            dont_use_when: ["只读分析"],
            output: "deployment runbook",
            side_effect: true,
            rate_limit: "batch write and backoff on 429",
          },
        ],
      };
    case "route-skill-prompt":
      return {
        routed_name: "debug-assistant",
      };
    case "resolve-skill-runtime-block":
      return {
        block: "[Activated Skill]\nselected=incident-review\ntimeline and action items",
        status: "[skills] selected=incident-review",
        empty_block: "",
        empty_status: "[skills] selected=none",
      };
    case "resolve-skill-router-config":
      return {
        enabled: false,
        score_threshold: 3.4,
        min_score_gap: 1.2,
        max_descriptors: 12,
        descriptor_scan_lines: 90,
        max_skill_block_chars: 3200,
        observability_enabled: false,
        observability_path: "logs/skills-router.jsonl",
      };
    case "resolve-skill-runtime-block-disabled":
      return {
        block: "",
        status: "[skills] selected=none (router disabled)",
      };
    case "append-skill-router-event":
      return {
        warning: null,
        rows: 1,
        payload: {
          event: "skill_router_turn",
          project: "demo",
          selection: { name: "incident-review" },
        },
      };
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

export function runCli(argv: string[]): number {
  const { command } = parseArgs(argv);
  const payload = resolveScenario(command);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("local-tools-contract");

if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`local-tools-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
