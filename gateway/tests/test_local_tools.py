#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from typing import Any


def run_local_tools_contract(command: str, *args: str) -> subprocess.CompletedProcess[str]:
    script_path = Path(__file__).resolve().parents[1] / "src" / "contracts" / "local-tools-contract.ts"
    cmd = [
        "npx",
        "--yes",
        "--package",
        "tsx@4.20.6",
        "tsx",
        str(script_path),
        command,
        *args,
    ]
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


class LocalToolsContractTests(unittest.TestCase):
    @staticmethod
    def _run(command: str) -> dict[str, Any]:
        result = run_local_tools_contract(command)
        if result.returncode != 0:
            raise AssertionError(result.stderr)
        payload = json.loads(result.stdout)
        if not isinstance(payload, dict):
            raise AssertionError("contract output must be object")
        return payload

    def test_file_mention_enrichment(self) -> None:
        payload = self._run("file-mention-enrichment")
        lines = payload["lines"]
        self.assertEqual(len(lines), 3)
        self.assertIn("[Resolved @file mentions]", str(payload["enriched"]))
        self.assertIn("@src/main.py => src/main.py", str(payload["enriched"]))
        self.assertIn("@main => ambiguous:", str(payload["enriched"]))
        self.assertIn("@missing.py => not_found", str(payload["enriched"]))
        self.assertTrue(bool(payload["mention_index_present"]))

    def test_extract_file_mentions_ignores_non_mentions(self) -> None:
        payload = self._run("extract-file-mentions")
        self.assertEqual(payload["tokens"], ["a.py", "b.ts"])

    def test_mention_index_incremental_refresh(self) -> None:
        payload = self._run("mention-index-refresh")
        self.assertIn("src/alpha.py", payload["initial"])
        self.assertNotIn("src/beta.py", payload["initial"])
        self.assertNotIn("src/alpha.py", payload["refreshed_alpha"])
        self.assertIn("src/beta.py", payload["refreshed_beta"])

    def test_mention_explicit_token_prefers_exact_matches(self) -> None:
        payload = self._run("mention-explicit-token")
        candidates = payload["candidates"]
        self.assertIn("src/main.py", candidates)
        self.assertNotIn("src/main.py.backup", candidates)

    def test_mention_query_cache_isolated_by_limit(self) -> None:
        payload = self._run("mention-query-cache")
        top1 = payload["top1"]
        top5 = payload["top5"]
        self.assertEqual(len(top1), 1)
        self.assertGreaterEqual(len(top5), 2)

    def test_hard_stale_existing_mention_skips_async_refresh(self) -> None:
        payload = self._run("mention-hard-stale-existing")
        self.assertEqual(int(payload["refresh_call_count"]), 0)
        self.assertIn("@alpha.py => src/alpha.py", payload["lines"])

    def test_hard_stale_deleted_mention_triggers_async_refresh(self) -> None:
        payload = self._run("mention-hard-stale-deleted")
        self.assertGreaterEqual(int(payload["refresh_call_count"]), 1)
        self.assertIn("@alpha.py => not_found", payload["lines"])

    def test_mention_state_refresh_backoff_after_error(self) -> None:
        payload = self._run("mention-refresh-backoff")
        self.assertFalse(bool(payload["scheduled"]))
        self.assertEqual(payload["status"], "backoff")

    def test_mention_state_refresh_inflight_guard(self) -> None:
        payload = self._run("mention-refresh-inflight")
        self.assertFalse(bool(payload["scheduled"]))
        self.assertEqual(payload["status"], "inflight")

    def test_list_tool_filters(self) -> None:
        payload = self._run("list-tool-filters")
        self.assertGreaterEqual(int(payload["count"]), 1)
        entry_paths = [str(item["path"]) for item in payload["entries"]]
        self.assertIn("a.py", entry_paths)
        self.assertNotIn("b.txt", entry_paths)

    def test_glob_tool_and_search_context_lines(self) -> None:
        payload = self._run("glob-search-context")
        globbed = payload["globbed"]
        self.assertEqual(int(globbed["count"]), 2)
        self.assertIn("a.py", globbed["matches"])
        self.assertIn("sub/b.py", globbed["matches"])
        self.assertNotIn("sub/c.ts", globbed["matches"])

        searched = payload["searched"]
        self.assertEqual(int(searched["count"]), 1)
        self.assertGreaterEqual(int(searched["records"]), 3)
        self.assertTrue(any(bool(item.get("match")) for item in searched["matches"]))
        self.assertTrue(any(not bool(item.get("match")) for item in searched["matches"]))

    def test_search_tool_fixed_and_regex(self) -> None:
        payload = self._run("search-fixed-regex")
        fixed = payload["fixed"]
        self.assertGreaterEqual(int(fixed["count"]), 2)
        regex = payload["regex"]
        self.assertEqual(int(regex["count"]), 1)
        self.assertEqual(int(regex["matches"][0]["line"]), 2)

    def test_read_write_edit_roundtrip(self) -> None:
        payload = self._run("read-write-edit-roundtrip")
        write_result = payload["write_result"]
        self.assertEqual(int(write_result["bytes_written"]), len("line1\nline2\nline3\nline2".encode("utf-8")))
        read_result = payload["read_result"]
        self.assertEqual(int(read_result["line_start"]), 2)
        self.assertEqual(int(read_result["line_end"]), 3)
        self.assertEqual(str(read_result["content"]), "line2\nline3")
        edit_first = payload["edit_first"]
        self.assertEqual(int(edit_first["occurrences_found"]), 2)
        self.assertEqual(int(edit_first["replacements"]), 1)
        edit_all = payload["edit_all"]
        self.assertEqual(int(edit_all["replacements"]), 1)

    def test_path_escape_is_blocked(self) -> None:
        payload = self._run("path-escape-blocked")
        self.assertTrue(bool(payload["raised"]))
        self.assertIn("RuntimeError", str(payload["error"]))

    def test_bash_tool_allowlist(self) -> None:
        payload = self._run("bash-tool-allowlist")
        bash_ok = payload["bash_ok"]
        self.assertEqual(int(bash_ok["exit_code"]), 0)
        self.assertIn("hello", str(bash_ok["stdout"]))
        self.assertIn("RuntimeError", str(payload["denied"]))
        bash_python = payload["bash_python"]
        self.assertEqual(int(bash_python["exit_code"]), 0)
        self.assertIn("7", str(bash_python["stdout"]))

    def test_allowlist_blocks_glob_and_search(self) -> None:
        payload = self._run("allowlist-blocks-glob-search")
        self.assertTrue(bool(payload["glob_blocked"]))
        self.assertTrue(bool(payload["search_blocked"]))

    def test_resolve_mcp_call_policy_from_project_toml(self) -> None:
        payload = self._run("resolve-mcp-call-policy")
        self.assertEqual(int(payload["max_concurrency_per_server"]), 3)
        self.assertEqual(int(payload["max_queue_per_server"]), 25)
        self.assertEqual(int(payload["failure_threshold"]), 4)
        self.assertEqual(int(payload["cooldown_secs"]), 45)
        self.assertEqual(payload["allow_tools"], ["echo", "search_code"])
        self.assertEqual(int(payload["latency_sample_limit"]), 512)

    def test_mcp_server_slot_queue_full(self) -> None:
        payload = self._run("mcp-server-slot-queue-full")
        self.assertTrue(bool(payload["raised"]))
        self.assertEqual(int(payload["snapshot"]["gate_rejected_calls"]), 1)
        self.assertTrue(bool(payload["blocked_event_set"]))

    def test_mcp_server_circuit_open_blocks_calls(self) -> None:
        payload = self._run("mcp-server-circuit-open")
        self.assertFalse(bool(payload["opened_first"]))
        self.assertTrue(bool(payload["opened_second"]))
        self.assertTrue(bool(payload["raised"]))
        snapshot = payload["snapshot"]
        self.assertEqual(int(snapshot["failure_calls"]), 2)
        self.assertEqual(int(snapshot["unknown_failures"]), 2)
        self.assertEqual(int(snapshot["gate_rejected_calls"]), 1)

    def test_mcp_servers_tool_returns_runtime_summary(self) -> None:
        payload = self._run("mcp-servers-summary")
        full = payload["full"]
        self.assertEqual(int(full["total"]), 3)
        self.assertEqual(int(full["enabled_count"]), 2)
        self.assertEqual(int(full["ready_count"]), 1)
        self.assertEqual(len(full["servers"]), 3)
        self.assertIn("policy", full)
        self.assertIn("max_concurrency_per_server", full["policy"])
        self.assertEqual(full["policy"]["allow_tools"], ["*"])
        self.assertEqual(int(full["policy"]["latency_sample_limit"]), 256)
        self.assertIn("runtime_summary", full)
        self.assertEqual(int(full["runtime_summary"]["servers_considered"]), 3)
        self.assertEqual(int(full["runtime_summary"]["total_calls"]), 0)
        self.assertTrue(all("runtime_state" in item for item in full["servers"]))
        self.assertTrue(all("p95_latency_ms" in item["runtime_state"] for item in full["servers"]))

        ready_only = payload["ready_only"]
        self.assertEqual(len(ready_only["servers"]), 1)
        self.assertEqual(ready_only["servers"][0]["name"], "a")
        self.assertEqual(int(ready_only["runtime_summary"]["servers_considered"]), 1)

    def test_mcp_servers_runtime_summary_aggregates_failures_and_top_errors(self) -> None:
        payload = self._run("mcp-servers-aggregate")
        summary = payload["runtime_summary"]
        self.assertEqual(int(summary["servers_considered"]), 2)
        self.assertEqual(int(summary["total_calls"]), 2)
        self.assertEqual(int(summary["success_calls"]), 1)
        self.assertEqual(int(summary["failure_calls"]), 1)
        self.assertEqual(int(summary["timeout_failures"]), 1)
        self.assertEqual(int(summary["transport_failures"]), 0)
        self.assertEqual(int(summary["policy_denied_calls"]), 1)
        self.assertGreaterEqual(int(summary["latency_sample_count"]), 2)
        self.assertTrue(bool(summary["top_errors"]))

    def test_reset_mcp_server_states_supports_single_and_all(self) -> None:
        payload = self._run("reset-mcp-server-states")
        self.assertEqual(int(payload["before"]["a"]), 1)
        self.assertEqual(int(payload["before"]["b"]), 1)
        self.assertEqual(int(payload["reset_single"]), 1)
        self.assertEqual(int(payload["after_single"]["a"]), 0)
        self.assertEqual(int(payload["after_single"]["b"]), 1)
        self.assertEqual(int(payload["reset_all"]), 2)
        self.assertEqual(int(payload["after_all"]["a"]), 0)
        self.assertEqual(int(payload["after_all"]["b"]), 0)

    def test_close_single_mcp_session_closes_target_session(self) -> None:
        payload = self._run("close-single-mcp-session")
        self.assertTrue(bool(payload["had_session"]))
        self.assertTrue(bool(payload["closed_first"]))
        self.assertFalse(bool(payload["closed_second"]))

    def test_allowlist_blocks_mcp_servers_tool(self) -> None:
        payload = self._run("allowlist-blocks-mcp-servers")
        self.assertTrue(bool(payload["raised"]))

    def test_mcp_call_tool_executes_stdio_server(self) -> None:
        payload = self._run("mcp-call-stdio")
        first = payload["first"]
        self.assertEqual(first["status"], "ok")
        self.assertEqual(first["server"], "mock")
        self.assertEqual(first["tool"], "echo")
        self.assertIn("echo", first["available_tools"])
        self.assertFalse(bool(first["session_reused"]))
        self.assertFalse(bool(first["session_recovered"]))
        first_pid = int(first["session_pid"])
        runtime_state = first["runtime_state"]
        self.assertEqual(int(runtime_state["total_calls"]), 1)
        self.assertEqual(int(runtime_state["success_calls"]), 1)
        self.assertEqual(int(runtime_state["failure_calls"]), 0)
        self.assertEqual(int(runtime_state["retry_calls"]), 0)
        self.assertEqual(int(runtime_state["recovered_calls"]), 0)
        self.assertEqual(int(runtime_state["policy_denied_calls"]), 0)
        self.assertEqual(int(runtime_state["gate_rejected_calls"]), 0)
        self.assertGreater(float(runtime_state["last_latency_ms"]), 0)
        self.assertGreaterEqual(float(runtime_state["p95_latency_ms"]), 0)

        normalized_result = first["result"]
        self.assertFalse(bool(normalized_result["is_error"]))
        content = normalized_result["content"]
        self.assertIsInstance(content, list)
        self.assertTrue(any(item.get("text") == "echo:hello-mcp" for item in content))
        self.assertIn("hello-mcp", str(normalized_result["raw_preview"]))
        self.assertIn("hello-mcp", str(normalized_result["structured_content_preview"]))

        second = payload["second"]
        self.assertTrue(bool(second["session_reused"]))
        self.assertFalse(bool(second["session_recovered"]))
        self.assertEqual(int(second["session_pid"]), first_pid)
        self.assertEqual(int(second["runtime_state"]["total_calls"]), 2)
        self.assertEqual(int(second["runtime_state"]["success_calls"]), 2)
        self.assertEqual(int(second["runtime_state"]["policy_denied_calls"]), 0)
        self.assertIn("hello-again", str(second["result"]["raw_preview"]))

    def test_mcp_call_tool_auto_recovers_when_session_process_exits(self) -> None:
        payload = self._run("mcp-call-auto-recover")
        first = payload["first"]
        second = payload["second"]
        self.assertFalse(bool(first["session_recovered"]))
        self.assertTrue(bool(second["session_recovered"]))
        self.assertNotEqual(int(second["session_pid"]), int(first["session_pid"]))
        self.assertEqual(int(second["runtime_state"]["total_calls"]), 2)
        self.assertEqual(int(second["runtime_state"]["success_calls"]), 2)
        self.assertEqual(int(second["runtime_state"]["recovered_calls"]), 1)
        self.assertEqual(int(second["runtime_state"]["transport_failures"]), 0)
        self.assertIn("second", str(second["result"]["raw_preview"]))

    def test_mcp_call_tool_tracks_tool_failure_kind(self) -> None:
        payload = self._run("mcp-call-tool-failure")
        self.assertTrue(bool(payload["raised"]))
        snapshot = payload["snapshot"]
        self.assertEqual(int(snapshot["total_calls"]), 1)
        self.assertEqual(int(snapshot["failure_calls"]), 1)
        self.assertEqual(int(snapshot["tool_failures"]), 1)
        self.assertEqual(int(snapshot["unknown_failures"]), 0)

    def test_mcp_call_tool_respects_mcp_allow_tools_policy(self) -> None:
        payload = self._run("mcp-call-allow-tools")
        self.assertTrue(bool(payload["raised"]))
        self.assertIn("allow_tools", str(payload["error"]))
        snapshot = payload["snapshot"]
        self.assertEqual(int(snapshot["policy_denied_calls"]), 1)
        self.assertEqual(int(snapshot["total_calls"]), 0)
        self.assertEqual(int(snapshot["failure_calls"]), 0)

    def test_allowlist_blocks_mcp_call_tool(self) -> None:
        payload = self._run("allowlist-blocks-mcp-call")
        self.assertTrue(bool(payload["raised"]))

    def test_mcp_call_tool_rejects_unready_server(self) -> None:
        payload = self._run("mcp-call-unready")
        self.assertTrue(bool(payload["raised"]))

    def test_resolve_hook_policy_from_project_toml(self) -> None:
        payload = self._run("resolve-hook-policy")
        self.assertTrue(bool(payload["enabled"]))
        self.assertTrue(bool(payload["strict"]))
        self.assertEqual(int(payload["timeout_secs"]), 12)

    def test_hook_event_executes_global_and_project_scripts(self) -> None:
        payload = self._run("hook-event-executes")
        self.assertEqual(payload["rows"], ["global:before-tool-use", "project:before-tool-use"])

    def test_summarize_hooks_runtime_reports_scope_and_counts(self) -> None:
        payload = self._run("hooks-runtime-summary")
        self.assertEqual(int(payload["event_count"]), 3)
        self.assertEqual(int(payload["total_scripts"]), 2)
        submit_event = payload["submit_event"]
        after_event = payload["after_event"]
        self.assertEqual(int(submit_event["count"]), 1)
        self.assertEqual(int(after_event["count"]), 1)
        self.assertEqual(submit_event["scripts"][0]["scope"], "global")
        self.assertEqual(after_event["scripts"][0]["scope"], "project")

    def test_hook_event_strict_mode_raises(self) -> None:
        payload = self._run("hook-event-strict")
        self.assertTrue(bool(payload["raised"]))

    def test_discover_skill_descriptors_parses_markdown_and_metadata(self) -> None:
        payload = self._run("discover-skill-descriptors")
        descriptors = payload["descriptors"]
        self.assertEqual(len(descriptors), 2)
        debug_desc = next(item for item in descriptors if item["name"] == "debug-assistant")
        deploy_desc = next(item for item in descriptors if item["name"] == "deploy-ops")
        self.assertEqual(debug_desc["scope"], "global")
        self.assertIn("排查错误", debug_desc["use_when"])
        self.assertIn("部署发布", debug_desc["dont_use_when"])
        self.assertEqual(debug_desc["output"], "root cause summary")
        self.assertEqual(deploy_desc["scope"], "project")
        self.assertTrue(bool(deploy_desc["side_effect"]))
        self.assertEqual(deploy_desc["rate_limit"], "batch write and backoff on 429")
        self.assertIn("部署生产", deploy_desc["use_when"])
        self.assertIn("只读分析", deploy_desc["dont_use_when"])

    def test_route_skill_for_prompt_prefers_non_conflicting_skill(self) -> None:
        payload = self._run("route-skill-prompt")
        self.assertEqual(payload["routed_name"], "debug-assistant")

    def test_resolve_skill_runtime_block_returns_selected_skill_status(self) -> None:
        payload = self._run("resolve-skill-runtime-block")
        self.assertIn("selected=incident-review", str(payload["status"]))
        self.assertIn("[Activated Skill]", str(payload["block"]))
        self.assertIn("timeline and action items", str(payload["block"]))
        self.assertEqual(payload["empty_block"], "")
        self.assertEqual(payload["empty_status"], "[skills] selected=none")

    def test_resolve_skill_router_config_from_project_toml(self) -> None:
        payload = self._run("resolve-skill-router-config")
        self.assertFalse(bool(payload["enabled"]))
        self.assertEqual(float(payload["score_threshold"]), 3.4)
        self.assertEqual(float(payload["min_score_gap"]), 1.2)
        self.assertEqual(int(payload["max_descriptors"]), 12)
        self.assertEqual(int(payload["descriptor_scan_lines"]), 90)
        self.assertEqual(int(payload["max_skill_block_chars"]), 3200)
        self.assertFalse(bool(payload["observability_enabled"]))
        self.assertEqual(payload["observability_path"], "logs/skills-router.jsonl")

    def test_resolve_skill_runtime_block_respects_disabled_router(self) -> None:
        payload = self._run("resolve-skill-runtime-block-disabled")
        self.assertEqual(payload["block"], "")
        self.assertEqual(payload["status"], "[skills] selected=none (router disabled)")

    def test_append_skill_router_event_writes_jsonl(self) -> None:
        payload = self._run("append-skill-router-event")
        self.assertIsNone(payload["warning"])
        self.assertEqual(int(payload["rows"]), 1)
        event_payload = payload["payload"]
        self.assertEqual(event_payload["event"], "skill_router_turn")
        self.assertEqual(event_payload["project"], "demo")
        self.assertEqual(event_payload["selection"]["name"], "incident-review")


if __name__ == "__main__":
    unittest.main(verbosity=2)
