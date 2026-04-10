#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import time
import unittest
from unittest import mock
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


class LocalToolsTests(unittest.TestCase):
    def test_file_mention_enrichment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "main.py").write_text("print('main')\n", encoding="utf-8")
            (work_dir / "src" / "main_test.py").write_text("print('test')\n", encoding="utf-8")
            (work_dir / "docs").mkdir(parents=True, exist_ok=True)
            (work_dir / "docs" / "main.md").write_text("# main\n", encoding="utf-8")

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )
            prompt = "请帮我看@src/main.py, 然后再看@main，另外@missing.py。"
            enriched, lines, mention_index = grobot_cli.enrich_user_prompt_with_file_mentions(
                prompt,
                context,
                None,
            )

            self.assertEqual(len(lines), 3)
            self.assertIn("[Resolved @file mentions]", enriched)
            self.assertIn("@src/main.py => src/main.py", enriched)
            self.assertIn("@main => ambiguous:", enriched)
            self.assertIn("@missing.py => not_found", enriched)
            self.assertIsNotNone(mention_index)

    def test_extract_file_mentions_ignores_non_mentions(self) -> None:
        tokens = grobot_cli.extract_file_mentions("邮箱 test@example.com 和 @a.py、@b.ts。")
        self.assertEqual(tokens, ["a.py", "b.ts"])

    def test_mention_index_incremental_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            file_a = work_dir / "src" / "alpha.py"
            file_b = work_dir / "src" / "beta.py"
            file_a.write_text("print('a')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            initial = grobot_cli.find_mention_candidates(index, "alpha.py", 5)
            self.assertIn("src/alpha.py", initial)
            self.assertNotIn("src/beta.py", initial)

            file_a.unlink()
            file_b.write_text("print('b')\n", encoding="utf-8")
            index = grobot_cli.refresh_mention_path_index(index, force=True)

            refreshed_alpha = grobot_cli.find_mention_candidates(index, "alpha.py", 5)
            refreshed_beta = grobot_cli.find_mention_candidates(index, "beta.py", 5)
            self.assertNotIn("src/alpha.py", refreshed_alpha)
            self.assertIn("src/beta.py", refreshed_beta)

    def test_mention_explicit_token_prefers_exact_matches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "main.py").write_text("print('main')\n", encoding="utf-8")
            (work_dir / "src" / "main.py.backup").write_text("print('backup')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            candidates = grobot_cli.find_mention_candidates(index, "main.py", 5)
            self.assertIn("src/main.py", candidates)
            self.assertNotIn("src/main.py.backup", candidates)

    def test_mention_query_cache_isolated_by_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "tests").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")
            (work_dir / "tests" / "alpha.py").write_text("print('b')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            top1 = grobot_cli.find_mention_candidates(index, "alpha.py", 1)
            top5 = grobot_cli.find_mention_candidates(index, "alpha.py", 5)
            self.assertEqual(len(top1), 1)
            self.assertGreaterEqual(len(top5), 2)

    def test_hard_stale_existing_mention_skips_async_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")
            context = grobot_cli.LocalToolContext(work_dir=work_dir, allow_tokens=("all",))

            index = grobot_cli.build_mention_path_index(work_dir)
            index.last_scan_at = 0.0
            with mock.patch.object(
                grobot_cli,
                "mention_state_schedule_async_refresh",
                wraps=grobot_cli.mention_state_schedule_async_refresh,
            ) as refresh_mock:
                _, lines, _ = grobot_cli.enrich_user_prompt_with_file_mentions(
                    "请检查@alpha.py",
                    context,
                    index,
                )
                self.assertEqual(refresh_mock.call_count, 0)
                self.assertIn("@alpha.py => src/alpha.py", lines)

    def test_hard_stale_deleted_mention_triggers_async_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            deleted = work_dir / "src" / "alpha.py"
            deleted.write_text("print('a')\n", encoding="utf-8")
            context = grobot_cli.LocalToolContext(work_dir=work_dir, allow_tokens=("all",))

            index = grobot_cli.build_mention_path_index(work_dir)
            deleted.unlink()
            index.last_scan_at = 0.0
            with mock.patch.object(
                grobot_cli,
                "mention_state_schedule_async_refresh",
                wraps=grobot_cli.mention_state_schedule_async_refresh,
            ) as refresh_mock:
                _, lines, _ = grobot_cli.enrich_user_prompt_with_file_mentions(
                    "请检查@alpha.py",
                    context,
                    index,
                )
                self.assertGreaterEqual(refresh_mock.call_count, 1)
                self.assertIn("@alpha.py => not_found", lines)

    def test_mention_state_refresh_backoff_after_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            state = grobot_cli.MentionIndexState(active=index)
            state.last_refresh_error = "boom"
            state.last_refresh_started_at = time.time()
            scheduled = grobot_cli.mention_state_schedule_async_refresh(state)
            self.assertFalse(scheduled)
            self.assertEqual(state.last_refresh_status, "backoff")

    def test_mention_state_refresh_inflight_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "alpha.py").write_text("print('a')\n", encoding="utf-8")

            index = grobot_cli.build_mention_path_index(work_dir)
            state = grobot_cli.MentionIndexState(active=index)

            class AliveThread:
                def is_alive(self) -> bool:
                    return True

            state.refresh_thread = AliveThread()
            scheduled = grobot_cli.mention_state_schedule_async_refresh(state)
            self.assertFalse(scheduled)
            self.assertEqual(state.last_refresh_status, "inflight")

    def test_list_tool_filters(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "a.py").write_text("print('a')\n", encoding="utf-8")
            (work_dir / "src" / "b.txt").write_text("hello\n", encoding="utf-8")

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            listed = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_LIST,
                {"path": "src", "pattern": "*.py", "kind": "file"},
                context,
            )
            self.assertGreaterEqual(listed["count"], 1)
            entry_paths = [item["path"] for item in listed["entries"]]
            self.assertIn("a.py", entry_paths)
            self.assertNotIn("b.txt", entry_paths)

    def test_glob_tool_and_search_context_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src" / "sub").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "a.py").write_text("print('a')\n", encoding="utf-8")
            (work_dir / "src" / "sub" / "b.py").write_text("print('b')\n", encoding="utf-8")
            (work_dir / "src" / "sub" / "c.ts").write_text("console.log('c')\n", encoding="utf-8")
            (work_dir / "src" / "sub" / "note.txt").write_text(
                "line-1\nneedle-line\nline-3\n",
                encoding="utf-8",
            )

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            globbed = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_GLOB,
                {"path": "src", "pattern": "*.py", "kind": "file"},
                context,
            )
            self.assertEqual(globbed["count"], 2)
            self.assertIn("a.py", globbed["matches"])
            self.assertIn("sub/b.py", globbed["matches"])
            self.assertNotIn("sub/c.ts", globbed["matches"])

            searched = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_SEARCH,
                {
                    "query": "needle-line",
                    "path": "src/sub",
                    "regex": False,
                    "case_sensitive": True,
                    "context_before": 1,
                    "context_after": 1,
                    "limit": 1,
                },
                context,
            )
            self.assertEqual(searched["count"], 1)
            self.assertGreaterEqual(searched["records"], 3)
            self.assertTrue(any(item.get("match") is True for item in searched["matches"]))
            self.assertTrue(any(item.get("match") is False for item in searched["matches"]))

    def test_search_tool_fixed_and_regex(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "notes").mkdir(parents=True, exist_ok=True)
            target = work_dir / "notes" / "x.txt"
            target.write_text("hello grobot\nHELLO agent\n", encoding="utf-8")

            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            fixed = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_SEARCH,
                {"query": "hello", "path": "notes", "regex": False, "case_sensitive": False},
                context,
            )
            self.assertGreaterEqual(fixed["count"], 2)

            regex = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_SEARCH,
                {"query": "^HELLO", "path": "notes", "regex": True, "case_sensitive": True},
                context,
            )
            self.assertEqual(regex["count"], 1)
            self.assertEqual(regex["matches"][0]["line"], 2)

    def test_read_write_edit_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )

            write_result = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_WRITE,
                {"path": "note.txt", "content": "line1\nline2\nline3\nline2"},
                context,
            )
            self.assertEqual(write_result["bytes_written"], len("line1\nline2\nline3\nline2".encode("utf-8")))

            read_result = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_READ,
                {"path": "note.txt", "offset": 2, "limit": 2},
                context,
            )
            self.assertEqual(read_result["line_start"], 2)
            self.assertEqual(read_result["line_end"], 3)
            self.assertEqual(read_result["content"], "line2\nline3")

            edit_first = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_EDIT,
                {"path": "note.txt", "old_text": "line2", "new_text": "changed", "replace_all": False},
                context,
            )
            self.assertEqual(edit_first["occurrences_found"], 2)
            self.assertEqual(edit_first["replacements"], 1)

            edit_all = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_EDIT,
                {"path": "note.txt", "old_text": "line2", "new_text": "changed2", "replace_all": True},
                context,
            )
            self.assertEqual(edit_all["replacements"], 1)

    def test_path_escape_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir, tempfile.TemporaryDirectory() as outside_dir:
            work_dir = Path(tmp_dir)
            outside_file = Path(outside_dir) / "outside.txt"
            outside_file.write_text("outside", encoding="utf-8")
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("all",),
            )
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_READ,
                    {"path": str(outside_file)},
                    context,
                )

    def test_bash_tool_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            context_shell = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("shell",),
            )
            bash_ok = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_BASH,
                {"command": "echo hello"},
                context_shell,
            )
            self.assertEqual(bash_ok["exit_code"], 0)
            self.assertIn("hello", bash_ok["stdout"])

            context_restricted = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=("python3",),
            )
            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_BASH,
                    {"command": "echo denied"},
                    context_restricted,
                )

            bash_python = grobot_cli.execute_local_tool(
                grobot_cli.LOCAL_TOOL_BASH,
                {"command": "python3 -c 'print(7)'"},
                context_restricted,
            )
            self.assertEqual(bash_python["exit_code"], 0)
            self.assertIn("7", bash_python["stdout"])

    def test_allowlist_blocks_glob_and_search(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            work_dir = Path(tmp_dir)
            (work_dir / "src").mkdir(parents=True, exist_ok=True)
            (work_dir / "src" / "x.txt").write_text("hello\n", encoding="utf-8")
            context = grobot_cli.LocalToolContext(
                work_dir=work_dir,
                allow_tokens=(grobot_cli.LOCAL_TOOL_READ,),
            )

            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_GLOB,
                    {"path": "src", "pattern": "*.txt"},
                    context,
                )

            with self.assertRaises(RuntimeError):
                _ = grobot_cli.execute_local_tool(
                    grobot_cli.LOCAL_TOOL_SEARCH,
                    {"path": "src", "query": "hello"},
                    context,
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
