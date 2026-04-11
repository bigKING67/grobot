#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any


def load_grobot_cli_module() -> Any:
    module_path = Path(__file__).resolve().parents[1] / "grobot_cli.py"
    spec = importlib.util.spec_from_file_location("grobot_cli", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module spec: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


grobot_cli = load_grobot_cli_module()


class HandoffTests(unittest.TestCase):
    def test_sanitize_handoff_text_masks_secrets(self) -> None:
        raw = "api_key=sk-1234567890 token:abc Bearer xyz123 password = letmein"
        sanitized = grobot_cli.sanitize_handoff_text(raw)
        self.assertIn("api_key=<redacted>", sanitized)
        self.assertIn("token:<redacted>", sanitized)
        self.assertIn("Bearer <redacted>", sanitized)
        self.assertIn("password=<redacted>", sanitized)
        self.assertNotIn("sk-1234567890", sanitized)

    def test_build_handoff_markdown_contains_required_sections(self) -> None:
        compact_memory = {
            "version": 1,
            "sections": {
                grobot_cli.HISTORY_COMPACT_SECTION_ARCHITECTURE: [
                    "Architecture decision: keep failover deterministic"
                ],
                grobot_cli.HISTORY_COMPACT_SECTION_MODIFIED: [
                    "Modified files: gateway/grobot_cli.py"
                ],
                grobot_cli.HISTORY_COMPACT_SECTION_VERIFICATION: [
                    "PASS: npm run check passed"
                ],
                grobot_cli.HISTORY_COMPACT_SECTION_TODO: [
                    "TODO: add rollback note for mcp gate"
                ],
                grobot_cli.HISTORY_COMPACT_SECTION_TOOL_OUTPUT: [
                    "FAIL: stderr timeout in skill router eval"
                ],
            },
        }
        history_messages = [
            {"role": "user", "content": "继续做handoff功能"},
            {"role": "assistant", "content": "已经完成主要逻辑，补测试中"},
        ]
        markdown = grobot_cli.build_handoff_markdown(
            session_key="feishu:demo:dm:user",
            project_name="grobot",
            work_dir=Path("/tmp/work"),
            compact_memory=compact_memory,
            history_messages=history_messages,
            recent_turns=3,
            failover_errors=["openai-compatible/o4: timeout"],
            compaction_observed=True,
        )
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
        self.assertTrue(grobot_cli.should_auto_write_handoff(compacted=True, failover=False, todo_open=False))
        self.assertTrue(grobot_cli.should_auto_write_handoff(compacted=False, failover=True, todo_open=False))
        self.assertTrue(grobot_cli.should_auto_write_handoff(compacted=False, failover=False, todo_open=True))
        self.assertFalse(grobot_cli.should_auto_write_handoff(compacted=False, failover=False, todo_open=False))

    def test_has_open_todo_items(self) -> None:
        self.assertFalse(grobot_cli.has_open_todo_items(None))
        self.assertFalse(
            grobot_cli.has_open_todo_items(
                {"sections": {grobot_cli.HISTORY_COMPACT_SECTION_TODO: []}}
            )
        )
        self.assertTrue(
            grobot_cli.has_open_todo_items(
                {"sections": {grobot_cli.HISTORY_COMPACT_SECTION_TODO: ["TODO: retry"]}}
            )
        )

    def test_start_parser_includes_handoff_options(self) -> None:
        parser = grobot_cli.build_parser()
        parsed = parser.parse_args(["start", "--project", "demo"])
        self.assertEqual(parsed.handoff_recent_turns, grobot_cli.HANDOFF_DEFAULT_RECENT_TURNS)
        self.assertTrue(parsed.handoff_auto_on_exit)

        parsed_off = parser.parse_args(["start", "--project", "demo", "--no-handoff-auto-on-exit"])
        self.assertFalse(parsed_off.handoff_auto_on_exit)


if __name__ == "__main__":
    unittest.main(verbosity=2)
