#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
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


class RuntimePathsTests(unittest.TestCase):
    def test_resolve_runtime_paths_uses_home_and_repo_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_work_dir:
            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=temp_work_dir,
                config_override=None,
                home_override=temp_home,
                project_root_override=None,
            )

            expected_repo_root = Path(__file__).resolve().parents[2]
            self.assertEqual(paths.home, Path(temp_home).resolve())
            self.assertEqual(paths.project_root, expected_repo_root.resolve())
            self.assertEqual(paths.project_toml, expected_repo_root.resolve() / ".grobot" / "project.toml")
            self.assertEqual(paths.config_toml, Path(temp_home).resolve() / "config.toml")
            self.assertEqual(paths.sessions_dir, Path(temp_home).resolve() / "runtime" / "sessions")
            self.assertEqual(paths.global_hooks_dir, Path(temp_home).resolve() / "hooks")
            self.assertEqual(paths.project_hooks_dir, expected_repo_root.resolve() / ".grobot" / "hooks")

    def test_resolve_runtime_paths_discovers_project_from_work_dir(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "schema_version = 1\nmode = \"mvp\"\n",
                encoding="utf-8",
            )

            nested_work_dir = project_root / "apps" / "backend"
            nested_work_dir.mkdir(parents=True, exist_ok=True)

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(nested_work_dir),
                config_override=None,
                home_override=temp_home,
                project_root_override=None,
            )

            self.assertEqual(paths.project_root, project_root.resolve())
            self.assertEqual(paths.project_toml, (project_grobot / "project.toml").resolve())
            self.assertEqual(paths.project_memory_dir, (project_grobot / "memory").resolve())
            self.assertEqual(paths.project_hooks_dir, (project_grobot / "hooks").resolve())

    def test_resolve_session_store_config_supports_session_root_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "custom" / "sessions"
            store = grobot_cli.resolve_session_store_config(
                project_toml={
                    "runtime": {"storage": {"hot_cache": "redis"}},
                    "session": {"resume_ttl_secs": 321},
                },
                root=Path(temp_dir),
                session_root=session_root,
                session_backend_arg="file",
                redis_url_arg=None,
                ttl_secs_arg=None,
            )
            self.assertEqual(store.root, session_root)
            self.assertEqual(store.ttl_secs, 321)

    def test_persist_memory_layers_writes_session_project_and_global_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "schema_version = 1\nmode = \"mvp\"\n",
                encoding="utf-8",
            )

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)

            selection = grobot_cli.ProjectSelection(
                name="demo",
                work_dir=project_root,
                platform="feishu",
                provider=grobot_cli.ProviderConfig(
                    name="mock",
                    api_key="mock-key",
                    base_url="https://api.example.com/v1",
                    model="mock-model",
                ),
            )

            compact_memory = {
                "version": 1,
                "sections": {
                    grobot_cli.HISTORY_COMPACT_SECTION_ARCHITECTURE: ["Architecture decisions must be kept"],
                    grobot_cli.HISTORY_COMPACT_SECTION_VERIFICATION: ["PASS: smoke"],
                    grobot_cli.HISTORY_COMPACT_SECTION_TODO: ["TODO: add metrics"],
                },
            }
            warnings = grobot_cli.persist_memory_layers(
                paths=paths,
                selection=selection,
                session_key="feishu:demo:dm:workspace",
                compact_memory=compact_memory,
            )
            self.assertEqual(warnings, [])

            session_snapshot = paths.session_memory_dir / "feishu_demo_dm_workspace.json"
            project_log = paths.project_memory_dir / "memory.jsonl"
            global_log = paths.global_memory_dir / "memory.jsonl"
            self.assertTrue(session_snapshot.exists())
            self.assertTrue(project_log.exists())
            self.assertTrue(global_log.exists())

            snapshot_payload = json.loads(session_snapshot.read_text(encoding="utf-8"))
            self.assertEqual(snapshot_payload["session_key"], "feishu:demo:dm:workspace")

            project_rows = [
                json.loads(line)
                for line in project_log.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            global_rows = [
                json.loads(line)
                for line in global_log.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertGreaterEqual(len(project_rows), 1)
            self.assertGreaterEqual(len(global_rows), 1)

    def test_run_init_uses_fallback_templates_when_repo_templates_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project, tempfile.TemporaryDirectory() as temp_repo:
            original_repo_root = grobot_cli.repo_root
            try:
                grobot_cli.repo_root = lambda: Path(temp_repo)
                args = type(
                    "InitArgs",
                    (),
                    {
                        "init_global": True,
                        "init_project": True,
                        "home": temp_home,
                        "project_root": temp_project,
                        "force": False,
                    },
                )()
                exit_code = grobot_cli.run_init(args)
                self.assertEqual(exit_code, 0)
            finally:
                grobot_cli.repo_root = original_repo_root

            global_config = Path(temp_home) / "config.toml"
            global_mcp_registry = Path(temp_home) / "mcp" / "servers.toml"
            global_hooks_dir = Path(temp_home) / "hooks"
            global_hooks_readme = global_hooks_dir / "README.md"
            project_toml = Path(temp_project) / ".grobot" / "project.toml"
            project_mcp = Path(temp_project) / ".grobot" / "mcp.toml"
            project_hooks_dir = Path(temp_project) / ".grobot" / "hooks"
            project_hooks_readme = project_hooks_dir / "README.md"
            self.assertTrue(global_config.exists())
            self.assertTrue(global_mcp_registry.exists())
            self.assertTrue(global_hooks_dir.exists())
            self.assertTrue(global_hooks_readme.exists())
            self.assertTrue(project_toml.exists())
            self.assertTrue(project_mcp.exists())
            self.assertTrue(project_hooks_dir.exists())
            self.assertTrue(project_hooks_readme.exists())
            self.assertIn("replace-with-api-key", global_config.read_text(encoding="utf-8"))
            self.assertIn("Global MCP registry", global_mcp_registry.read_text(encoding="utf-8"))
            self.assertIn("schema_version = 1", project_toml.read_text(encoding="utf-8"))

    def test_run_init_with_hooks_samples_creates_executable_scripts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project, tempfile.TemporaryDirectory() as temp_repo:
            original_repo_root = grobot_cli.repo_root
            try:
                grobot_cli.repo_root = lambda: Path(temp_repo)
                args = type(
                    "InitArgs",
                    (),
                    {
                        "init_global": False,
                        "init_project": True,
                        "home": temp_home,
                        "project_root": temp_project,
                        "force": False,
                        "hooks_samples": True,
                    },
                )()
                exit_code = grobot_cli.run_init(args)
                self.assertEqual(exit_code, 0)
            finally:
                grobot_cli.repo_root = original_repo_root

            hooks_root = Path(temp_project) / ".grobot" / "hooks"
            sample_paths = [
                hooks_root / grobot_cli.LOCAL_TOOL_HOOK_EVENT_USER_PROMPT_SUBMIT / grobot_cli.HOOK_SAMPLE_USER_PROMPT_FILENAME,
                hooks_root / grobot_cli.LOCAL_TOOL_HOOK_EVENT_BEFORE_TOOL_USE / grobot_cli.HOOK_SAMPLE_BEFORE_TOOL_FILENAME,
                hooks_root / grobot_cli.LOCAL_TOOL_HOOK_EVENT_AFTER_TOOL_USE / grobot_cli.HOOK_SAMPLE_AFTER_TOOL_FILENAME,
            ]
            for sample in sample_paths:
                self.assertTrue(sample.exists(), str(sample))
                self.assertTrue(os.access(sample, os.X_OK), str(sample))

    def test_run_hooks_doctor_outputs_json_and_warns_when_empty(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            init_args = type(
                "InitArgs",
                (),
                {
                    "init_global": True,
                    "init_project": True,
                    "home": temp_home,
                    "project_root": temp_project,
                    "force": False,
                    "hooks_samples": False,
                },
            )()
            exit_code = grobot_cli.run_init(init_args)
            self.assertEqual(exit_code, 0)

            doctor_args = type(
                "HooksDoctorArgs",
                (),
                {
                    "hooks_command": "doctor",
                    "project": None,
                    "work_dir": temp_project,
                    "config": None,
                    "home": temp_home,
                    "project_root": temp_project,
                    "json_output": True,
                    "strict": False,
                },
            )()
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                doctor_exit = grobot_cli.run_hooks_doctor(doctor_args)
            self.assertEqual(doctor_exit, 0)
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["status"], "warn")
            self.assertIn("hooks_runtime", payload)
            self.assertEqual(
                payload["hooks_runtime"]["event_count"],
                len(grobot_cli.LOCAL_TOOL_HOOK_EVENTS),
            )

            strict_args = type(
                "HooksDoctorStrictArgs",
                (),
                {
                    "hooks_command": "doctor",
                    "project": None,
                    "work_dir": temp_project,
                    "config": None,
                    "home": temp_home,
                    "project_root": temp_project,
                    "json_output": False,
                    "strict": True,
                },
            )()
            strict_exit = grobot_cli.run_hooks_doctor(strict_args)
            self.assertEqual(strict_exit, 1)

    def test_resolve_mcp_runtime_merges_project_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text("schema_version = 1\nmode = \"mvp\"\n", encoding="utf-8")

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)

            paths.global_mcp_registry.parent.mkdir(parents=True, exist_ok=True)
            paths.global_mcp_registry.write_text(
                "\n".join(
                    [
                        "[[servers]]",
                        "name = \"ctx\"",
                        "command = \"python3\"",
                        "args = [\"-V\"]",
                        "enabled = true",
                        "",
                        "[[servers]]",
                        "name = \"global-only\"",
                        "command = \"/bin/sh\"",
                        "args = [\"-c\", \"echo global-only\"]",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            paths.project_mcp_file.write_text(
                "\n".join(
                    [
                        "[[servers]]",
                        "name = \"ctx\"",
                        "command = \"python3\"",
                        "args = [\"-V\"]",
                        "enabled = false",
                        "",
                        "[[servers]]",
                        "name = \"project-only\"",
                        "command = \"python3\"",
                        "args = [\"project.py\"]",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            mcp_runtime, warnings = grobot_cli.resolve_mcp_runtime(paths)
            self.assertEqual(warnings, [])
            self.assertEqual(mcp_runtime["total"], 3)
            self.assertEqual(mcp_runtime["enabled_count"], 2)
            self.assertEqual(mcp_runtime["disabled_count"], 1)
            self.assertEqual(mcp_runtime["ready_count"], 2)
            self.assertEqual(mcp_runtime["unready_count"], 0)
            self.assertIn("project-only", mcp_runtime["enabled"])
            self.assertIn("ctx", mcp_runtime["disabled"])

            effective = mcp_runtime["effective"]
            ctx = next((item for item in effective if item["name"] == "ctx"), None)
            self.assertIsNotNone(ctx)
            self.assertEqual(ctx["source"], f"project:{paths.project_mcp_file}")
            self.assertEqual(ctx["enabled"], False)
            self.assertEqual(ctx["args"], ["-V"])
            self.assertEqual(ctx["ready"], None)

    def test_resolve_mcp_runtime_reports_invalid_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text("schema_version = 1\nmode = \"mvp\"\n", encoding="utf-8")

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)

            paths.global_mcp_registry.parent.mkdir(parents=True, exist_ok=True)
            paths.global_mcp_registry.write_text(
                "\n".join(
                    [
                        "[[servers]]",
                        "name = \"broken\"",
                        "command = \"npx\"",
                        "enabled = \"yes\"",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            mcp_runtime, warnings = grobot_cli.resolve_mcp_runtime(paths)
            self.assertEqual(mcp_runtime["total"], 0)
            self.assertEqual(mcp_runtime["enabled_count"], 0)
            self.assertEqual(mcp_runtime["ready_count"], 0)
            self.assertEqual(mcp_runtime["unready_count"], 0)
            self.assertGreaterEqual(len(warnings), 1)

    def test_resolve_wiki_config_prefers_wiki_section(self) -> None:
        config = grobot_cli.resolve_wiki_config(
            {
                "memory": {
                    "allow_org_shared_read": True,
                    "wiki": {"allow_org_shared_read": True},
                },
                "wiki": {
                    "enabled": True,
                    "allow_org_shared_read": False,
                    "default_scope": "group",
                    "retrieval": {
                        "max_files": 22,
                        "max_chars": 888,
                        "max_items": 7,
                    },
                    "lint": {
                        "stale_days": 12,
                        "max_files": 66,
                    },
                    "review": {"write_mode": "direct"},
                },
            }
        )
        self.assertTrue(config.enabled)
        self.assertFalse(config.allow_org_shared_read)
        self.assertEqual(config.default_scope, "group")
        self.assertEqual(config.write_mode, "direct")
        self.assertEqual(config.retrieval_max_files, 22)
        self.assertEqual(config.retrieval_max_chars, 888)
        self.assertEqual(config.retrieval_max_items, 7)
        self.assertEqual(config.lint_stale_days, 12)
        self.assertEqual(config.lint_max_files, 66)

    def test_wiki_ingest_review_apply_flow(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "\n".join(
                    [
                        "schema_version = 1",
                        'mode = "mvp"',
                        "",
                        "[wiki]",
                        "enabled = true",
                        'default_scope = "auto"',
                        "allow_org_shared_read = false",
                        "",
                        "[wiki.review]",
                        'write_mode = "review_first"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (project_root / "docs").mkdir(parents=True, exist_ok=True)
            (project_root / "docs" / "spec.md").write_text(
                "支付回滚流程：先锁单，再补偿。\n接口契约：status=paid/unpaid。\n",
                encoding="utf-8",
            )

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)
            project_toml = grobot_cli.load_toml(paths.project_toml)
            wiki_config = grobot_cli.resolve_wiki_config(project_toml)
            session_key = "feishu:demo:dm:open_user_1"

            ingest_code, ingest_lines = grobot_cli.wiki_ingest(
                paths=paths,
                wiki_config=wiki_config,
                session_key=session_key,
                work_dir=project_root,
                source="docs/spec.md",
                title="支付回滚规范",
                requested_scope="auto",
                apply_direct=False,
            )
            self.assertEqual(ingest_code, 0)
            proposal_line = next(
                (line for line in ingest_lines if line.startswith("wiki ingest proposal created:")),
                "",
            )
            self.assertTrue(proposal_line)
            proposal_id = proposal_line.split(":", 1)[1].strip()
            self.assertTrue(proposal_id.startswith("wp"))

            list_code, list_lines = grobot_cli.wiki_review_list(
                paths=paths,
                wiki_config=wiki_config,
                session_key=session_key,
            )
            self.assertEqual(list_code, 0)
            self.assertTrue(any(proposal_id in line for line in list_lines))

            apply_code, apply_lines = grobot_cli.wiki_review_apply(
                paths=paths,
                wiki_config=wiki_config,
                session_key=session_key,
                proposal_id=proposal_id,
                reviewer="unit-test",
                note="looks good",
            )
            self.assertEqual(apply_code, 0)
            self.assertTrue(any("wiki review applied" in line for line in apply_lines))

            user_root = paths.project_wiki_dir / "users" / "open_user_1"
            pages = sorted((user_root / "pages").glob("*.md"))
            self.assertGreaterEqual(len(pages), 1)
            page_content = pages[0].read_text(encoding="utf-8")
            self.assertIn("# 支付回滚规范", page_content)
            self.assertIn("status=paid/unpaid", page_content)
            self.assertTrue((user_root / "index.md").exists())
            self.assertTrue((user_root / "log.md").exists())

    def test_wiki_lint_reports_broken_links_and_orphans(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "schema_version = 1\nmode = \"mvp\"\n",
                encoding="utf-8",
            )

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)
            session_key = "feishu:demo:dm:open_user_lint"
            wiki_config = grobot_cli.resolve_wiki_config({"wiki": {"enabled": True}})
            _, scope_root = grobot_cli.wiki_build_scope_root(
                paths=paths,
                session_key=session_key,
                wiki_config=wiki_config,
                requested_scope="user",
            )
            (scope_root / "pages").mkdir(parents=True, exist_ok=True)
            (scope_root / "pages" / "a.md").write_text(
                "# A\n\nSee [B](b.md)\n",
                encoding="utf-8",
            )
            (scope_root / "pages" / "orphan.md").write_text(
                "# Orphan\n\nNo inbound links.\n",
                encoding="utf-8",
            )

            lint_code, lint_lines = grobot_cli.wiki_lint(
                paths=paths,
                wiki_config=wiki_config,
                session_key=session_key,
                requested_scope="user",
            )
            self.assertEqual(lint_code, 0)
            report_line = next((line for line in lint_lines if line.startswith("report=")), "")
            self.assertTrue(report_line)
            report_path = Path(report_line.split("=", 1)[1].strip())
            self.assertTrue(report_path.exists())
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertGreaterEqual(len(payload.get("broken_links", [])), 1)
            self.assertGreaterEqual(len(payload.get("orphan_pages", [])), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
