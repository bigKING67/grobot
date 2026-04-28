import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectIncludes(source: string, fragment: string, message: string): void {
  expect(source.includes(fragment), `${message}: missing ${fragment}`);
}

function expectAllIncludes(source: string, fragments: readonly string[], message: string): void {
  for (const fragment of fragments) {
    expectIncludes(source, fragment, message);
  }
}

const runtimeTests = readRepoFile("runtime/src/tools/tests.rs");
const executor = readRepoFile("runtime/src/models/executor.rs");

interface OutputDensityRequirement {
  tool: string;
  path: string;
  fragments: readonly string[];
  extraPaths?: readonly {
    path: string;
    fragments: readonly string[];
  }[];
}

const implementationRequirements: readonly OutputDensityRequirement[] = [
  {
    tool: "list",
    path: "runtime/src/tools/list/entry.rs",
    fragments: ['"limit_reached"', '"truncation"', "build_list_truncation_payload"],
  },
  {
    tool: "glob",
    path: "runtime/src/tools/glob/entry.rs",
    fragments: ['"engine"', '"limit_reached"', '"truncation"', "build_glob_truncation_payload"],
  },
  {
    tool: "search",
    path: "runtime/src/tools/search/entry.rs",
    fragments: ['"preferred_engine"', '"fallback"', '"limit_reached"', '"truncation"', "build_search_truncation_payload"],
    extraPaths: [
      {
        path: "runtime/src/tools/search/helpers.rs",
        fragments: ['"text_truncated"', "truncate_search_text"],
      },
    ],
  },
  {
    tool: "read",
    path: "runtime/src/tools/read/output.rs",
    fragments: [
      '"next_offset"',
      '"truncated"',
      '"truncated_by"',
      '"meta"',
      '"snapshot_full_view"',
      "request.include_metadata",
    ],
    extraPaths: [
      {
        path: "runtime/src/tools/read/request.rs",
        fragments: ["get_bool_arg(args, \"include_metadata\", true)"],
      },
    ],
  },
  {
    tool: "bash",
    path: "runtime/src/tools/bash/entry.rs",
    fragments: [
      '"truncation"',
      '"full_output_path"',
      '"audit"',
      '"redaction_enabled"',
      '"stdout_truncated"',
      '"stderr_truncated"',
    ],
  },
  {
    tool: "write",
    path: "runtime/src/tools/write/entry.rs",
    fragments: [
      '"bytes_written"',
      '"line_ending"',
      '"bom_written"',
      '"created_parent_dirs"',
      '"write_read_required"',
      '"write_stale_target"',
    ],
  },
  {
    tool: "edit",
    path: "runtime/src/tools/edit/entry.rs",
    fragments: [
      '"blocks_requested"',
      '"fuzzy_fallback_used"',
      '"first_changed_line"',
      '"line_ending"',
      '"bom_preserved"',
      '"diff"',
      '"diagnostics"',
    ],
  },
  {
    tool: "mcp_call",
    path: "runtime/src/tools/mcp/mod.rs",
    fragments: [
      "MAX_MCP_CALL_ARGUMENT_BYTES",
      '"argument_keys"',
      '"argument_bytes"',
      '"max_argument_bytes"',
      '"argument_preview"',
      "redact_tool_preview_secrets",
    ],
  },
];

for (const requirement of implementationRequirements) {
  const source = readRepoFile(requirement.path);
  expectAllIncludes(source, requirement.fragments, `${requirement.tool} output density implementation`);
  for (const extra of requirement.extraPaths ?? []) {
    expectAllIncludes(
      readRepoFile(extra.path),
      extra.fragments,
      `${requirement.tool} output density implementation ${extra.path}`,
    );
  }
}

const runtimeTestRequirements = [
  "list_v2_reports_limit_reached_metadata",
  "glob_v2_reports_limit_reached_metadata",
  "search_v2_reports_truncation_metadata_and_text_truncation",
  "read_v2_supports_offset_limit_and_next_offset",
  "read_v2_include_metadata_false_omits_meta_field",
  "read_v2_metadata_reports_text_format_and_snapshot_scope",
  "bash_v2_reports_truncation_and_persists_full_output",
  "write_v2_reports_bom_crlf_and_created_parent_metadata",
  "edit_v2_reports_lf_metadata_without_bom",
  "run_mcp_call_missing_server_keeps_argument_metadata",
  "run_mcp_call_server_busy_keeps_argument_metadata",
  "run_mcp_call_observed_is_error_includes_bounded_argument_metadata",
  "run_mcp_call_rpc_error_includes_bounded_argument_metadata",
] as const;

for (const testName of runtimeTestRequirements) {
  expectIncludes(runtimeTests, `fn ${testName}()`, `runtime output density test coverage ${testName}`);
}

expectAllIncludes(
  executor,
  [
    "TOOL_MESSAGE_BUDGET_POLICY_VERSION",
    '"output_budget"',
    '"summary"',
    '"preview"',
    '"retry_hint"',
    "build_tool_output_summary",
    "build_tool_message_budget_event_payload",
    "truncate_middle_chars",
  ],
  "model-facing tool message budget envelope",
);

expectAllIncludes(
  executor,
  [
    '"limit_reached"',
    '"first_changed_line"',
    '"blocks_requested"',
    '"fuzzy_fallback_used"',
    '"bytes_written"',
    '"diff_preview"',
    '"command_preview"',
    '"matches_count"',
    '"entries_count"',
    '"stdout_chars"',
    '"stderr_chars"',
    '"tool_content_chars"',
  ],
  "truncated tool message summary keeps actionable metadata",
);

process.stdout.write(JSON.stringify({
  ok: true,
  contract: "runtime-tool-output-density",
  implementation_tools_covered: implementationRequirements.map((row) => row.tool),
  runtime_tests_covered: runtimeTestRequirements.length,
  model_message_budget_envelope: true,
}) + "\n");
