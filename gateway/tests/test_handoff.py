#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

try:
    from gateway.tests.ts_contract import run_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract


SECTION_ARCHITECTURE = "Architecture decisions"
SECTION_MODIFIED = "Modified files and key changes"
SECTION_VERIFICATION = "Current verification status"
SECTION_TODO = "Open TODOs and rollback notes"
SECTION_TOOL_OUTPUT = "Tool outputs (pass/fail only)"
HANDOFF_DEFAULT_RECENT_TURNS = 6


def run_handoff_contract(command: str, *args: str) -> subprocess.CompletedProcess[str]:
    return run_node_contract("handoff-contract.mjs", command, args)


class HandoffTests(unittest.TestCase):
    def test_sanitize_handoff_text_masks_secrets(self) -> None:
        raw = "api_key=sk-1234567890 token:abc Bearer xyz123 password = letmein"
        result = run_handoff_contract("sanitize", "--text", raw)
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        sanitized = payload["sanitized"]
        self.assertIn("api_key=<redacted>", sanitized)
        self.assertIn("token:<redacted>", sanitized)
        self.assertIn("Bearer <redacted>", sanitized)
        self.assertIn("password=<redacted>", sanitized)
        self.assertNotIn("sk-1234567890", sanitized)

    def test_build_handoff_markdown_contains_required_sections(self) -> None:
        compact_memory = {
            "version": 1,
            "sections": {
                SECTION_ARCHITECTURE: [
                    "Architecture decision: keep failover deterministic"
                ],
                SECTION_MODIFIED: [
                    "Modified files: gateway/grobot_cli.py"
                ],
                SECTION_VERIFICATION: [
                    "PASS: npm run check passed"
                ],
                SECTION_TODO: [
                    "TODO: add rollback note for mcp gate"
                ],
                SECTION_TOOL_OUTPUT: [
                    "FAIL: stderr timeout in skill router eval"
                ],
            },
        }
        history_messages = [
            {"role": "user", "content": "继续做handoff功能"},
            {"role": "assistant", "content": "已经完成主要逻辑，补测试中"},
        ]
        payload = {
            "session_key": "feishu:demo:dm:user",
            "project_name": "grobot",
            "work_dir": str(Path("/tmp/work")),
            "compact_memory": compact_memory,
            "history_messages": history_messages,
            "recent_turns": 3,
            "failover_errors": ["openai-compatible/o4: timeout"],
            "compaction_observed": True,
        }
        result = run_handoff_contract("build", "--payload", json.dumps(payload, ensure_ascii=False))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        markdown = result.stdout
        self.assertIn("# HANDOFF", markdown)
        self.assertIn("## Current Goal", markdown)
        self.assertIn("## Architecture Decisions (verbatim)", markdown)
        self.assertIn("Architecture decision: keep failover deterministic", markdown)
        self.assertIn("## Modified Files and Key Changes", markdown)
        self.assertIn("Modified files: gateway/grobot_cli.py", markdown)
        self.assertIn("## Verification Status (PASS/FAIL only)", markdown)
        self.assertIn("PASS: npm run check passed", markdown)
        self.assertIn("FAIL: stderr timeout in skill router eval", markdown)
        self.assertIn("## What Was Tried", markdown)
        self.assertIn("### Worked", markdown)
        self.assertIn("### Did Not Work", markdown)
        self.assertIn("## Open TODOs and Rollback Notes", markdown)
        self.assertIn("TODO: add rollback note for mcp gate", markdown)
        self.assertIn("## Next 3 Steps", markdown)
        self.assertIn("## Runtime Signals", markdown)
        self.assertIn("- compaction_observed: true", markdown)
        self.assertIn("- failover_observed: true", markdown)
        self.assertIn("## Recent Turns", markdown)

    def test_should_auto_write_handoff(self) -> None:
        scenarios = [
            ("true", "false", "false", True),
            ("false", "true", "false", True),
            ("false", "false", "true", True),
            ("false", "false", "false", False),
        ]
        for compacted, failover, todo_open, expected in scenarios:
            result = run_handoff_contract(
                "should-auto-write",
                "--compacted",
                compacted,
                "--failover",
                failover,
                "--todo-open",
                todo_open,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["value"], expected)

    def test_has_open_todo_items(self) -> None:
        for compact_memory, expected in [
            ({"sections": {SECTION_TODO: []}}, False),
            ({"sections": {SECTION_TODO: ["TODO: retry"]}}, True),
        ]:
            result = run_handoff_contract(
                "has-open-todo",
                "--compact-memory",
                json.dumps(compact_memory, ensure_ascii=False),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["value"], expected)

    def test_start_parser_includes_handoff_options(self) -> None:
        result = run_handoff_contract("start-defaults")
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["handoff_recent_turns"], HANDOFF_DEFAULT_RECENT_TURNS)
        self.assertTrue(payload["handoff_auto_on_exit"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
