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

    def test_resolve_memory_v1_config_prefers_v1_section(self) -> None:
        config = grobot_cli.resolve_memory_v1_config(
            {
                "memory": {
                    "allow_org_shared_read": False,
                    "v1": {
                        "enabled": True,
                        "default_scope": "group",
                        "write_mode": "direct",
                        "retrieval": {
                            "max_items": 9,
                            "max_chars": 333,
                            "min_score": 1.7,
                            "recency_half_life_days": 21,
                        },
                        "privacy": {"allow_org_shared_read": True},
                        "lifecycle": {
                            "enabled": True,
                            "promote_after_days": 3,
                            "promote_min_strength": 0.9,
                            "decay_after_days": 8,
                            "decay_factor": 0.7,
                            "decay_min_importance": 0.2,
                            "decay_interval_days": 2,
                            "archive_after_days": 15,
                            "archive_max_strength": 0.35,
                            "batch_limit": 42,
                        },
                    },
                }
            }
        )
        self.assertTrue(config.enabled)
        self.assertTrue(config.allow_org_shared_read)
        self.assertEqual(config.default_scope, "group")
        self.assertEqual(config.write_mode, "direct")
        self.assertEqual(config.retrieval_max_items, 9)
        self.assertEqual(config.retrieval_max_chars, 333)
        self.assertAlmostEqual(config.retrieval_min_score, 1.7, places=6)
        self.assertEqual(config.recency_half_life_days, 21)
        self.assertTrue(config.lifecycle_enabled)
        self.assertEqual(config.lifecycle_promote_after_days, 3)
        self.assertAlmostEqual(config.lifecycle_promote_min_strength, 0.9, places=6)
        self.assertEqual(config.lifecycle_decay_after_days, 8)
        self.assertAlmostEqual(config.lifecycle_decay_factor, 0.7, places=6)
        self.assertAlmostEqual(config.lifecycle_decay_min_importance, 0.2, places=6)
        self.assertEqual(config.lifecycle_decay_interval_days, 2)
        self.assertEqual(config.lifecycle_archive_after_days, 15)
        self.assertAlmostEqual(config.lifecycle_archive_max_strength, 0.35, places=6)
        self.assertEqual(config.lifecycle_batch_limit, 42)

    def test_memory_v1_write_review_query_flow(self) -> None:
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
                        "[memory]",
                        "allow_org_shared_read = false",
                        "",
                        "[memory.v1]",
                        "enabled = true",
                        'default_scope = "auto"',
                        'write_mode = "review_first"',
                        "",
                        "[memory.v1.retrieval]",
                        "max_items = 8",
                        "max_chars = 220",
                        "min_score = 0.5",
                        "recency_half_life_days = 30",
                        "",
                        "[memory.v1.privacy]",
                        "allow_org_shared_read = false",
                    ]
                )
                + "\n",
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
            memory_config = grobot_cli.resolve_memory_v1_config(project_toml)
            session_key = "feishu:demo:dm:open_user_9"

            write_code, write_lines = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="支付回滚策略：先锁单，再补偿，超时 30s 触发告警。",
                kind="semantic",
                requested_scope="auto",
                tags=["payment", "rollback"],
                importance=0.8,
                confidence=0.9,
                classification="internal",
                source="unit-test",
                apply_direct=False,
            )
            self.assertEqual(write_code, 0)
            proposal_line = next(
                (line for line in write_lines if line.startswith("memory write proposal created:")),
                "",
            )
            self.assertTrue(proposal_line)
            proposal_id = proposal_line.split(":", 1)[1].strip()
            self.assertTrue(proposal_id.startswith("mp"))

            list_code, list_lines = grobot_cli.memory_v1_review_list(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
            )
            self.assertEqual(list_code, 0)
            self.assertTrue(any(proposal_id in line for line in list_lines))

            apply_code, apply_lines = grobot_cli.memory_v1_review_apply(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                proposal_id=proposal_id,
                reviewer="unit-test",
                note="approved",
            )
            self.assertEqual(apply_code, 0)
            self.assertTrue(any("memory review applied" in line for line in apply_lines))

            query_code, query_lines, rows = grobot_cli.memory_v1_query(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                query="支付回滚 告警",
                requested_scope="auto",
            )
            self.assertEqual(query_code, 0)
            self.assertTrue(any("payment" in json.dumps(row, ensure_ascii=False) or "支付回滚" in json.dumps(row, ensure_ascii=False) for row in rows))
            self.assertTrue(any("支付回滚策略" in line for line in query_lines))

            items_file = paths.project_memory_dir / "v1" / "users" / "open_user_9" / "items.jsonl"
            self.assertTrue(items_file.exists())
            rows_from_file = [
                json.loads(line)
                for line in items_file.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertGreaterEqual(len(rows_from_file), 1)
            self.assertEqual(rows_from_file[-1].get("kind"), "semantic")

    def test_memory_v1_query_hides_restricted_by_default(self) -> None:
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
                        "[memory.v1]",
                        "enabled = true",
                        'default_scope = "auto"',
                        'write_mode = "direct"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)
            memory_config = grobot_cli.resolve_memory_v1_config(grobot_cli.load_toml(paths.project_toml))
            session_key = "feishu:demo:dm:open_user_privacy"

            code_internal, _ = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="内部规范：支付回滚超时 30s 告警",
                kind="policy",
                requested_scope="auto",
                classification="internal",
                apply_direct=True,
            )
            self.assertEqual(code_internal, 0)

            code_restricted, _ = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="敏感规则：补偿审批人手机号 138xxxxxx",
                kind="policy",
                requested_scope="auto",
                classification="restricted",
                apply_direct=True,
            )
            self.assertEqual(code_restricted, 0)

            query_default_code, query_default_lines, query_default_rows = grobot_cli.memory_v1_query(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                query="补偿审批人 手机号",
                requested_scope="auto",
                include_restricted=False,
                include_secret=False,
            )
            self.assertEqual(query_default_code, 0)
            self.assertEqual(query_default_rows, [])
            self.assertTrue(any("no matched memory items" in line for line in query_default_lines))

            query_allow_code, _query_allow_lines, query_allow_rows = grobot_cli.memory_v1_query(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                query="补偿审批人 手机号",
                requested_scope="auto",
                include_restricted=True,
                include_secret=False,
            )
            self.assertEqual(query_allow_code, 0)
            self.assertGreaterEqual(len(query_allow_rows), 1)
            self.assertTrue(
                any(
                    row.get("classification") == "restricted"
                    for row in query_allow_rows
                )
            )

    def test_memory_v1_lifecycle_promote_decay_archive(self) -> None:
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
                        "[memory.v1]",
                        "enabled = true",
                        'default_scope = "auto"',
                        'write_mode = "direct"',
                        "",
                        "[memory.v1.retrieval]",
                        "max_items = 8",
                        "min_score = 0.1",
                        "",
                        "[memory.v1.lifecycle]",
                        "enabled = true",
                        "promote_after_days = 1",
                        "promote_min_strength = 0.80",
                        "decay_after_days = 1",
                        "decay_factor = 0.60",
                        "decay_min_importance = 0.20",
                        "decay_interval_days = 1",
                        "archive_after_days = 1",
                        "archive_max_strength = 0.30",
                        "batch_limit = 20",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)
            memory_config = grobot_cli.resolve_memory_v1_config(grobot_cli.load_toml(paths.project_toml))
            session_key = "feishu:demo:dm:open_user_lifecycle"

            code_promote, _ = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="事件A：支付回滚流程已经稳定，长期有效。",
                kind="episodic",
                requested_scope="auto",
                importance=0.95,
                confidence=0.95,
                classification="internal",
                apply_direct=True,
            )
            self.assertEqual(code_promote, 0)
            code_decay, _ = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="事件B：一次性补偿策略草案。",
                kind="semantic",
                requested_scope="auto",
                importance=0.50,
                confidence=0.30,
                classification="internal",
                apply_direct=True,
            )
            self.assertEqual(code_decay, 0)
            code_archive, _ = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="事件C：临时审批手机号 138xxxxxx。",
                kind="episodic",
                requested_scope="auto",
                importance=0.20,
                confidence=0.20,
                classification="restricted",
                apply_direct=True,
            )
            self.assertEqual(code_archive, 0)

            items_file = paths.project_memory_dir / "v1" / "users" / "open_user_lifecycle" / "items.jsonl"
            self.assertTrue(items_file.exists())
            rows = [json.loads(line) for line in items_file.read_text(encoding="utf-8").splitlines() if line.strip()]
            for row in rows:
                row["created_at"] = "2026-01-01T00:00:00+00:00"
                row["updated_at"] = "2026-01-01T00:00:00+00:00"
            items_file.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")

            dry_code, dry_lines = grobot_cli.memory_v1_lifecycle_run(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                requested_scope="auto",
                dry_run=True,
            )
            self.assertEqual(dry_code, 0)
            self.assertTrue(any("dry_run=on" in line for line in dry_lines))

            run_code, run_lines = grobot_cli.memory_v1_lifecycle_run(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                requested_scope="auto",
                dry_run=False,
            )
            self.assertEqual(run_code, 0)
            self.assertTrue(any("actions=promote:1 decay:1 archive:1" in line for line in run_lines))

            latest_rows = grobot_cli.memory_v1_load_latest_records(
                paths.project_memory_dir / "v1" / "users" / "open_user_lifecycle",
                include_archived=True,
            )
            by_text = {str(row.get("text") or ""): row for row in latest_rows}
            promote_row = by_text.get("事件A：支付回滚流程已经稳定，长期有效。")
            decay_row = by_text.get("事件B：一次性补偿策略草案。")
            archive_row = by_text.get("事件C：临时审批手机号 138xxxxxx。")
            self.assertIsNotNone(promote_row)
            self.assertIsNotNone(decay_row)
            self.assertIsNotNone(archive_row)
            if promote_row is not None:
                self.assertEqual(promote_row.get("kind"), "semantic")
                self.assertEqual(promote_row.get("state"), "active")
            if decay_row is not None:
                self.assertLess(float(decay_row.get("importance") or 1.0), 0.5)
                self.assertEqual(decay_row.get("state"), "active")
            if archive_row is not None:
                self.assertEqual(archive_row.get("state"), "archived")

            hidden_code, _hidden_lines, hidden_rows = grobot_cli.memory_v1_query(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                query="审批手机号",
                requested_scope="auto",
                include_restricted=True,
                include_secret=False,
            )
            self.assertEqual(hidden_code, 0)
            self.assertEqual(hidden_rows, [])

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

    def test_memory_v1_management_ops_list_forget_export_import(self) -> None:
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
                        "[memory.v1]",
                        "enabled = true",
                        'default_scope = "auto"',
                        'write_mode = "direct"',
                        "",
                        "[memory.v1.lifecycle]",
                        "enabled = true",
                        "batch_limit = 20",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)
            memory_config = grobot_cli.resolve_memory_v1_config(grobot_cli.load_toml(paths.project_toml))
            session_key = "feishu:demo:dm:open_user_mgmt"

            code_a, _ = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="内部记忆：支付回滚策略 v1",
                kind="semantic",
                requested_scope="auto",
                classification="internal",
                apply_direct=True,
            )
            self.assertEqual(code_a, 0)
            code_b, _ = grobot_cli.memory_v1_write(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                text="敏感记忆：审批人手机号 138xxxxxx",
                kind="policy",
                requested_scope="auto",
                classification="restricted",
                apply_direct=True,
            )
            self.assertEqual(code_b, 0)

            list_code_default, list_rows_default = grobot_cli.memory_v1_list_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                requested_scope="auto",
                include_archived=False,
                include_restricted=False,
                include_secret=False,
                query=None,
                limit=50,
                actor="management:test",
            )
            self.assertEqual(list_code_default, 0)
            self.assertTrue(any("支付回滚策略" in str(row.get("text")) for row in list_rows_default))
            self.assertFalse(any("手机号" in str(row.get("text")) for row in list_rows_default))

            list_code_all, list_rows_all = grobot_cli.memory_v1_list_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                requested_scope="auto",
                include_archived=False,
                include_restricted=True,
                include_secret=False,
                query=None,
                limit=50,
                actor="management:test",
            )
            self.assertEqual(list_code_all, 0)
            sensitive_row = next((row for row in list_rows_all if "手机号" in str(row.get("text"))), None)
            self.assertIsNotNone(sensitive_row)
            assert sensitive_row is not None
            sensitive_id = str(sensitive_row.get("id") or "")
            self.assertTrue(sensitive_id)

            forget_code, forget_result = grobot_cli.memory_v1_forget_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                record_ids=[sensitive_id],
                requested_scope="auto",
                reason="privacy-cleanup",
                actor="management:test",
                dry_run=False,
            )
            self.assertEqual(forget_code, 0)
            self.assertEqual(forget_result.get("forgotten_count"), 1)

            list_code_after, list_rows_after = grobot_cli.memory_v1_list_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                requested_scope="auto",
                include_archived=False,
                include_restricted=True,
                include_secret=False,
                query=None,
                limit=50,
                actor="management:test",
            )
            self.assertEqual(list_code_after, 0)
            self.assertFalse(any(str(row.get("id")) == sensitive_id for row in list_rows_after))

            export_code, export_rows = grobot_cli.memory_v1_export_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                requested_scope="auto",
                include_archived=True,
                include_restricted=True,
                include_secret=False,
                query=None,
                limit=2000,
                actor="management:test",
            )
            self.assertEqual(export_code, 0)
            self.assertTrue(any(str(row.get("id")) == sensitive_id and row.get("state") == "archived" for row in export_rows))

            import_code, import_result = grobot_cli.memory_v1_import_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                records=[
                    {
                        "text": "导入记忆：退款 SLA 为 24 小时",
                        "kind": "semantic",
                        "classification": "internal",
                        "importance": 0.9,
                        "confidence": 0.8,
                        "tags": ["sla", "refund"],
                    }
                ],
                requested_scope="auto",
                actor="management:test",
                source="management-api",
                dry_run=False,
            )
            self.assertEqual(import_code, 0)
            self.assertEqual(import_result.get("imported_count"), 1)

            list_code_imported, list_rows_imported = grobot_cli.memory_v1_list_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                requested_scope="auto",
                include_archived=False,
                include_restricted=False,
                include_secret=False,
                query="退款 SLA",
                limit=10,
                actor="management:test",
            )
            self.assertEqual(list_code_imported, 0)
            self.assertTrue(any("退款 SLA" in str(row.get("text")) for row in list_rows_imported))

            scope_root = paths.project_memory_dir / "v1" / "users" / "open_user_mgmt"
            events_file = scope_root / "events.jsonl"
            self.assertTrue(events_file.exists())
            events = [
                json.loads(line).get("event")
                for line in events_file.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertIn("management_memory_forget", events)
            self.assertIn("management_memory_import", events)

    def test_memory_v1_import_rejects_invalid_record_schema(self) -> None:
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
                        "[memory.v1]",
                        "enabled = true",
                        'default_scope = "auto"',
                        'write_mode = "direct"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            paths = grobot_cli.resolve_runtime_paths(
                work_dir_override=str(project_root),
                config_override=None,
                home_override=temp_home,
                project_root_override=str(project_root),
            )
            grobot_cli.ensure_runtime_layout(paths)
            memory_config = grobot_cli.resolve_memory_v1_config(grobot_cli.load_toml(paths.project_toml))
            session_key = "feishu:demo:dm:open_user_import_schema"

            import_code, import_result = grobot_cli.memory_v1_import_records(
                paths=paths,
                memory_config=memory_config,
                session_key=session_key,
                records=[
                    {
                        "text": "这条会失败",
                        "kind": "semantic",
                        "importance": "high",
                        "tags": "not-an-array",
                    }
                ],
                requested_scope="auto",
                actor="management:test",
                source="management-api",
                dry_run=False,
            )
            self.assertEqual(import_code, 1)
            self.assertEqual(import_result.get("error"), "invalid_record_schema")
            self.assertEqual(import_result.get("invalid_count"), 1)
            invalid_rows = import_result.get("invalid_rows")
            self.assertIsInstance(invalid_rows, list)
            if isinstance(invalid_rows, list) and invalid_rows:
                row0 = invalid_rows[0]
                self.assertIsInstance(row0, dict)
                errors = row0.get("errors")
                self.assertIsInstance(errors, list)
                if isinstance(errors, list):
                    error_text = json.dumps(errors, ensure_ascii=False)
                    self.assertIn("importance", error_text)
                    self.assertIn("tags", error_text)

    def test_resolve_execution_plane_config_precedence(self) -> None:
        project_toml = {
            "execution": {
                "gateway_impl": "ts",
                "runtime_impl": "rust",
                "shadow_mode": True,
            }
        }
        old_gateway = os.environ.get(grobot_cli.ENV_EXECUTION_GATEWAY_IMPL)
        old_runtime = os.environ.get(grobot_cli.ENV_EXECUTION_RUNTIME_IMPL)
        old_shadow = os.environ.get(grobot_cli.ENV_EXECUTION_SHADOW_MODE)
        try:
            config_project = grobot_cli.resolve_execution_plane_config(project_toml)
            self.assertEqual(config_project.gateway_impl, "ts")
            self.assertEqual(config_project.runtime_impl, "rust")
            self.assertTrue(config_project.shadow_mode)
            self.assertEqual(config_project.gateway_impl_source, "project_toml:execution.gateway_impl")
            self.assertEqual(config_project.runtime_impl_source, "project_toml:execution.runtime_impl")
            self.assertEqual(config_project.shadow_mode_source, "project_toml:execution.shadow_mode")

            os.environ[grobot_cli.ENV_EXECUTION_GATEWAY_IMPL] = "python"
            os.environ[grobot_cli.ENV_EXECUTION_RUNTIME_IMPL] = "python"
            os.environ[grobot_cli.ENV_EXECUTION_SHADOW_MODE] = "off"
            config_env = grobot_cli.resolve_execution_plane_config(project_toml)
            self.assertEqual(config_env.gateway_impl, "python")
            self.assertEqual(config_env.runtime_impl, "python")
            self.assertFalse(config_env.shadow_mode)
            self.assertEqual(config_env.gateway_impl_source, f"env:{grobot_cli.ENV_EXECUTION_GATEWAY_IMPL}")
            self.assertEqual(config_env.runtime_impl_source, f"env:{grobot_cli.ENV_EXECUTION_RUNTIME_IMPL}")
            self.assertEqual(config_env.shadow_mode_source, f"env:{grobot_cli.ENV_EXECUTION_SHADOW_MODE}")

            config_cli = grobot_cli.resolve_execution_plane_config(
                project_toml,
                gateway_impl_arg="ts",
                runtime_impl_arg="rust",
                shadow_mode_arg=True,
            )
            self.assertEqual(config_cli.gateway_impl, "ts")
            self.assertEqual(config_cli.runtime_impl, "rust")
            self.assertTrue(config_cli.shadow_mode)
            self.assertEqual(config_cli.gateway_impl_source, "cli")
            self.assertEqual(config_cli.runtime_impl_source, "cli")
            self.assertEqual(config_cli.shadow_mode_source, "cli")
        finally:
            if old_gateway is None:
                os.environ.pop(grobot_cli.ENV_EXECUTION_GATEWAY_IMPL, None)
            else:
                os.environ[grobot_cli.ENV_EXECUTION_GATEWAY_IMPL] = old_gateway
            if old_runtime is None:
                os.environ.pop(grobot_cli.ENV_EXECUTION_RUNTIME_IMPL, None)
            else:
                os.environ[grobot_cli.ENV_EXECUTION_RUNTIME_IMPL] = old_runtime
            if old_shadow is None:
                os.environ.pop(grobot_cli.ENV_EXECUTION_SHADOW_MODE, None)
            else:
                os.environ[grobot_cli.ENV_EXECUTION_SHADOW_MODE] = old_shadow

    def test_management_status_payload_includes_execution_plane(self) -> None:
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
            selection = grobot_cli.ProjectSelection(
                name="demo",
                work_dir=project_root,
                platform="feishu",
                provider=grobot_cli.ProviderConfig(
                    name="kimi",
                    api_key="sk-demo",
                    base_url="https://api.example.com/v1",
                    model="kimi-2.5",
                ),
            )
            execution_plane = grobot_cli.ExecutionPlaneConfig(
                gateway_impl="ts",
                runtime_impl="rust",
                shadow_mode=True,
                gateway_impl_source="cli",
                runtime_impl_source="project_toml:execution.runtime_impl",
                shadow_mode_source="env:GROBOT_SHADOW_MODE",
            )
            payload = grobot_cli.build_management_status_payload(
                runtime_paths=paths,
                project_toml={"schema_version": 1, "mode": "mvp"},
                selection=selection,
                session_key="feishu:demo:dm:open_user_1",
                bind="127.0.0.1:8080",
                execution_plane=execution_plane,
            )
            execution_payload = payload.get("execution_plane")
            self.assertIsInstance(execution_payload, dict)
            if isinstance(execution_payload, dict):
                self.assertEqual(execution_payload.get("gateway_impl"), "ts")
                self.assertEqual(execution_payload.get("runtime_impl"), "rust")
                self.assertTrue(bool(execution_payload.get("shadow_mode")))
                sources = execution_payload.get("sources")
                self.assertIsInstance(sources, dict)
                if isinstance(sources, dict):
                    self.assertEqual(sources.get("gateway_impl"), "cli")
                    self.assertEqual(
                        sources.get("runtime_impl"),
                        "project_toml:execution.runtime_impl",
                    )
                    self.assertEqual(sources.get("shadow_mode"), "env:GROBOT_SHADOW_MODE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
