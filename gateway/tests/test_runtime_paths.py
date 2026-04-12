#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

try:
    from gateway.tests.ts_contract import run_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract


def run_runtime_paths_contract(command: str, *args: str):
    return run_node_contract("runtime-paths-contract.mjs", command, args)


class RuntimePathsTests(unittest.TestCase):
    def test_resolve_runtime_paths_uses_home_and_repo_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_work_dir:
            expected_repo_root = Path(__file__).resolve().parents[2]
            result = run_runtime_paths_contract(
                "resolve-runtime-paths",
                "--home",
                temp_home,
                "--work-dir",
                temp_work_dir,
                "--repo-root",
                str(expected_repo_root),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            paths = json.loads(result.stdout)

            self.assertEqual(Path(paths["home"]).resolve(), Path(temp_home).resolve())
            self.assertEqual(Path(paths["project_root"]).resolve(), expected_repo_root.resolve())
            self.assertEqual(
                Path(paths["project_toml"]).resolve(),
                (expected_repo_root.resolve() / ".grobot" / "project.toml").resolve(),
            )
            self.assertEqual(Path(paths["config_toml"]).resolve(), (Path(temp_home).resolve() / "config.toml").resolve())
            self.assertEqual(
                Path(paths["sessions_dir"]).resolve(),
                (Path(temp_home).resolve() / "runtime" / "sessions").resolve(),
            )
            self.assertEqual(Path(paths["global_hooks_dir"]).resolve(), (Path(temp_home).resolve() / "hooks").resolve())
            self.assertEqual(
                Path(paths["project_hooks_dir"]).resolve(),
                (expected_repo_root.resolve() / ".grobot" / "hooks").resolve(),
            )

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

            result = run_runtime_paths_contract(
                "resolve-runtime-paths",
                "--home",
                temp_home,
                "--work-dir",
                str(nested_work_dir),
                "--repo-root",
                str(Path(__file__).resolve().parents[2]),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            paths = json.loads(result.stdout)

            self.assertEqual(Path(paths["project_root"]).resolve(), project_root.resolve())
            self.assertEqual(Path(paths["project_toml"]).resolve(), (project_grobot / "project.toml").resolve())
            self.assertEqual(Path(paths["project_memory_dir"]).resolve(), (project_grobot / "memory").resolve())
            self.assertEqual(Path(paths["project_hooks_dir"]).resolve(), (project_grobot / "hooks").resolve())

    def test_resolve_session_store_config_supports_session_root_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "custom" / "sessions"
            result = run_runtime_paths_contract(
                "resolve-session-store-config",
                "--payload",
                json.dumps(
                    {
                        "session_root": str(session_root),
                        "project_toml": {
                            "runtime": {"storage": {"hot_cache": "redis"}},
                            "session": {"resume_ttl_secs": 321},
                        },
                        "session_backend_arg": "file",
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            store = json.loads(result.stdout)
            self.assertEqual(Path(store["root"]).resolve(), session_root.resolve())
            self.assertEqual(store["ttl_secs"], 321)
            self.assertEqual(store["backend"], "file")

    def test_persist_memory_layers_writes_session_project_and_global_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text(
                "schema_version = 1\nmode = \"mvp\"\n",
                encoding="utf-8",
            )

            compact_memory = {
                "version": 1,
                "sections": {
                    "Architecture decisions": ["Architecture decisions must be kept"],
                    "Current verification status": ["PASS: smoke"],
                    "Open TODOs and rollback notes": ["TODO: add metrics"],
                },
            }
            result = run_runtime_paths_contract(
                "persist-memory-layers-scenario",
                "--payload",
                json.dumps(
                    {
                        "project_root": str(project_root),
                        "home": temp_home,
                        "session_key": "feishu:demo:dm:workspace",
                        "compact_memory": compact_memory,
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            warnings = payload["warnings"]
            self.assertEqual(warnings, [])

            session_snapshot = Path(payload["session_snapshot"])
            project_log = Path(payload["project_log"])
            global_log = Path(payload["global_log"])
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
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            result = run_runtime_paths_contract(
                "run-init-fallback",
                "--payload",
                json.dumps(
                    {
                        "home": temp_home,
                        "project_root": temp_project,
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["exit_code"], 0)

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
        with tempfile.TemporaryDirectory() as temp_project:
            result = run_runtime_paths_contract(
                "run-init-hooks-samples",
                "--payload",
                json.dumps({"project_root": temp_project}, ensure_ascii=False),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["exit_code"], 0)

            hooks_root = Path(temp_project) / ".grobot" / "hooks"
            sample_paths = [
                hooks_root / "user-prompt-submit" / "10-user-prompt-submit-sample.sh",
                hooks_root / "before-tool-use" / "20-before-tool-use-sample.sh",
                hooks_root / "after-tool-use" / "30-after-tool-use-sample.sh",
            ]
            for sample in sample_paths:
                self.assertTrue(sample.exists(), str(sample))
                self.assertTrue(os.access(sample, os.X_OK), str(sample))

    def test_run_hooks_doctor_outputs_json_and_warns_when_empty(self) -> None:
        result = run_runtime_paths_contract("hooks-doctor-scenario")
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["doctor_exit"], 0)
        self.assertEqual(output["strict_exit"], 1)
        payload = output["payload"]
        self.assertEqual(payload["status"], "warn")
        self.assertIn("hooks_runtime", payload)
        self.assertEqual(payload["hooks_runtime"]["event_count"], 3)

    def test_resolve_mcp_runtime_merges_project_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            global_mcp_registry = Path(temp_home) / "mcp" / "servers.toml"
            project_mcp_file = project_grobot / "mcp.toml"

            global_mcp_registry.parent.mkdir(parents=True, exist_ok=True)
            global_mcp_registry.write_text(
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
            project_mcp_file.write_text(
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

            result = run_runtime_paths_contract(
                "resolve-mcp-runtime-merge",
                "--payload",
                json.dumps(
                    {
                        "global_path": str(global_mcp_registry),
                        "project_path": str(project_mcp_file),
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            mcp_runtime = payload["mcp_runtime"]
            warnings = payload["warnings"]
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
            self.assertIsInstance(ctx["source"], str)
            source_path_raw = str(ctx["source"]).split("project:", 1)[-1]
            self.assertEqual(Path(source_path_raw).resolve(), project_mcp_file.resolve())
            self.assertEqual(ctx["enabled"], False)
            self.assertEqual(ctx["args"], ["-V"])
            self.assertEqual(ctx["ready"], None)

    def test_resolve_mcp_runtime_reports_invalid_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            global_mcp_registry = Path(temp_home) / "mcp" / "servers.toml"

            global_mcp_registry.parent.mkdir(parents=True, exist_ok=True)
            global_mcp_registry.write_text(
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

            result = run_runtime_paths_contract(
                "resolve-mcp-runtime-invalid",
                "--payload",
                json.dumps({"global_path": str(global_mcp_registry)}, ensure_ascii=False),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            mcp_runtime = payload["mcp_runtime"]
            warnings = payload["warnings"]
            self.assertEqual(mcp_runtime["total"], 0)
            self.assertEqual(mcp_runtime["enabled_count"], 0)
            self.assertEqual(mcp_runtime["ready_count"], 0)
            self.assertEqual(mcp_runtime["unready_count"], 0)
            self.assertGreaterEqual(len(warnings), 1)

    def test_resolve_wiki_config_prefers_wiki_section(self) -> None:
        result = run_runtime_paths_contract(
            "resolve-wiki-config",
            "--payload",
            json.dumps(
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
                },
                ensure_ascii=False,
            ),
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        config = json.loads(result.stdout)
        self.assertTrue(config["enabled"])
        self.assertFalse(config["allow_org_shared_read"])
        self.assertEqual(config["default_scope"], "group")
        self.assertEqual(config["write_mode"], "direct")
        self.assertEqual(config["retrieval_max_files"], 22)
        self.assertEqual(config["retrieval_max_chars"], 888)
        self.assertEqual(config["retrieval_max_items"], 7)
        self.assertEqual(config["lint_stale_days"], 12)
        self.assertEqual(config["lint_max_files"], 66)

    def test_resolve_memory_v1_config_prefers_v1_section(self) -> None:
        result = run_runtime_paths_contract(
            "resolve-memory-config",
            "--payload",
            json.dumps(
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
                },
                ensure_ascii=False,
            ),
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        config = json.loads(result.stdout)
        self.assertTrue(config["enabled"])
        self.assertTrue(config["allow_org_shared_read"])
        self.assertEqual(config["default_scope"], "group")
        self.assertEqual(config["write_mode"], "direct")
        self.assertEqual(config["retrieval_max_items"], 9)
        self.assertEqual(config["retrieval_max_chars"], 333)
        self.assertAlmostEqual(config["retrieval_min_score"], 1.7, places=6)
        self.assertEqual(config["recency_half_life_days"], 21)
        self.assertTrue(config["lifecycle_enabled"])
        self.assertEqual(config["lifecycle_promote_after_days"], 3)
        self.assertAlmostEqual(config["lifecycle_promote_min_strength"], 0.9, places=6)
        self.assertEqual(config["lifecycle_decay_after_days"], 8)
        self.assertAlmostEqual(config["lifecycle_decay_factor"], 0.7, places=6)
        self.assertAlmostEqual(config["lifecycle_decay_min_importance"], 0.2, places=6)
        self.assertEqual(config["lifecycle_decay_interval_days"], 2)
        self.assertEqual(config["lifecycle_archive_after_days"], 15)
        self.assertAlmostEqual(config["lifecycle_archive_max_strength"], 0.35, places=6)
        self.assertEqual(config["lifecycle_batch_limit"], 42)

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
            result = run_runtime_paths_contract(
                "memory-write-review-query-scenario",
                "--payload",
                json.dumps(
                    {
                        "project_root": str(project_root),
                        "home": temp_home,
                        "session_user": "open_user_9",
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            write_code = payload["write_code"]
            write_lines = payload["write_lines"]
            self.assertEqual(write_code, 0)
            proposal_line = next(
                (line for line in write_lines if line.startswith("memory write proposal created:")),
                "",
            )
            self.assertTrue(proposal_line)
            proposal_id = proposal_line.split(":", 1)[1].strip()
            self.assertTrue(proposal_id.startswith("mp"))

            list_code = payload["list_code"]
            list_lines = payload["list_lines"]
            self.assertEqual(list_code, 0)
            self.assertTrue(any(proposal_id in line for line in list_lines))

            apply_code = payload["apply_code"]
            apply_lines = payload["apply_lines"]
            self.assertEqual(apply_code, 0)
            self.assertTrue(any("memory review applied" in line for line in apply_lines))

            query_code = payload["query_code"]
            query_lines = payload["query_lines"]
            rows = payload["query_rows"]
            self.assertEqual(query_code, 0)
            self.assertTrue(any("payment" in json.dumps(row, ensure_ascii=False) or "支付回滚" in json.dumps(row, ensure_ascii=False) for row in rows))
            self.assertTrue(any("支付回滚策略" in line for line in query_lines))

            items_file = Path(payload["items_file"])
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
            result = run_runtime_paths_contract("memory-query-restricted-scenario")
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)

            code_internal = payload["code_internal"]
            self.assertEqual(code_internal, 0)

            code_restricted = payload["code_restricted"]
            self.assertEqual(code_restricted, 0)

            query_default_code = payload["query_default_code"]
            query_default_lines = payload["query_default_lines"]
            query_default_rows = payload["query_default_rows"]
            self.assertEqual(query_default_code, 0)
            self.assertEqual(query_default_rows, [])
            self.assertTrue(any("no matched memory items" in line for line in query_default_lines))

            query_allow_code = payload["query_allow_code"]
            query_allow_rows = payload["query_allow_rows"]
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
            result = run_runtime_paths_contract(
                "memory-lifecycle-scenario",
                "--payload",
                json.dumps(
                    {
                        "project_root": str(project_root),
                        "home": temp_home,
                        "session_user": "open_user_lifecycle",
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)

            code_promote = payload["code_promote"]
            self.assertEqual(code_promote, 0)
            code_decay = payload["code_decay"]
            self.assertEqual(code_decay, 0)
            code_archive = payload["code_archive"]
            self.assertEqual(code_archive, 0)

            items_file = Path(payload["items_file"])
            self.assertTrue(items_file.exists())

            dry_code = payload["dry_code"]
            dry_lines = payload["dry_lines"]
            self.assertEqual(dry_code, 0)
            self.assertTrue(any("dry_run=on" in line for line in dry_lines))

            run_code = payload["run_code"]
            run_lines = payload["run_lines"]
            self.assertEqual(run_code, 0)
            self.assertTrue(any("actions=promote:1 decay:1 archive:1" in line for line in run_lines))

            latest_rows = payload["latest_rows"]
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

            hidden_code = payload["hidden_code"]
            hidden_rows = payload["hidden_rows"]
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

            result = run_runtime_paths_contract(
                "wiki-ingest-review-apply-scenario",
                "--payload",
                json.dumps(
                    {
                        "project_root": str(project_root),
                        "home": temp_home,
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            ingest_code = payload["ingest_code"]
            ingest_lines = payload["ingest_lines"]
            self.assertEqual(ingest_code, 0)
            proposal_line = next(
                (line for line in ingest_lines if line.startswith("wiki ingest proposal created:")),
                "",
            )
            self.assertTrue(proposal_line)
            proposal_id = proposal_line.split(":", 1)[1].strip()
            self.assertTrue(proposal_id.startswith("wp"))

            list_code = payload["list_code"]
            list_lines = payload["list_lines"]
            self.assertEqual(list_code, 0)
            self.assertTrue(any(proposal_id in line for line in list_lines))

            apply_code = payload["apply_code"]
            apply_lines = payload["apply_lines"]
            self.assertEqual(apply_code, 0)
            self.assertTrue(any("wiki review applied" in line for line in apply_lines))

            user_root = Path(payload["user_root"])
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

            result = run_runtime_paths_contract(
                "wiki-lint-scenario",
                "--payload",
                json.dumps(
                    {
                        "project_root": str(project_root),
                        "home": temp_home,
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            lint_code = payload["lint_code"]
            lint_lines = payload["lint_lines"]
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
            result = run_runtime_paths_contract(
                "memory-management-ops-scenario",
                "--payload",
                json.dumps(
                    {
                        "project_root": str(project_root),
                        "home": temp_home,
                        "session_user": "open_user_mgmt",
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)

            code_a = payload["code_a"]
            self.assertEqual(code_a, 0)
            code_b = payload["code_b"]
            self.assertEqual(code_b, 0)

            list_code_default = payload["list_code_default"]
            list_rows_default = payload["list_rows_default"]
            self.assertEqual(list_code_default, 0)
            self.assertTrue(any("支付回滚策略" in str(row.get("text")) for row in list_rows_default))
            self.assertFalse(any("手机号" in str(row.get("text")) for row in list_rows_default))

            list_code_all = payload["list_code_all"]
            list_rows_all = payload["list_rows_all"]
            self.assertEqual(list_code_all, 0)
            sensitive_row = next((row for row in list_rows_all if "手机号" in str(row.get("text"))), None)
            self.assertIsNotNone(sensitive_row)
            assert sensitive_row is not None
            sensitive_id = str(payload["sensitive_id"] or "")
            self.assertTrue(sensitive_id)

            forget_code = payload["forget_code"]
            forget_result = payload["forget_result"]
            self.assertEqual(forget_code, 0)
            self.assertEqual(forget_result.get("forgotten_count"), 1)

            list_code_after = payload["list_code_after"]
            list_rows_after = payload["list_rows_after"]
            self.assertEqual(list_code_after, 0)
            self.assertFalse(any(str(row.get("id")) == sensitive_id for row in list_rows_after))

            export_code = payload["export_code"]
            export_rows = payload["export_rows"]
            self.assertEqual(export_code, 0)
            self.assertTrue(any(str(row.get("id")) == sensitive_id and row.get("state") == "archived" for row in export_rows))

            import_code = payload["import_code"]
            import_result = payload["import_result"]
            self.assertEqual(import_code, 0)
            self.assertEqual(import_result.get("imported_count"), 1)

            list_code_imported = payload["list_code_imported"]
            list_rows_imported = payload["list_rows_imported"]
            self.assertEqual(list_code_imported, 0)
            self.assertTrue(any("退款 SLA" in str(row.get("text")) for row in list_rows_imported))

            events_file = Path(payload["events_file"])
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
            result = run_runtime_paths_contract("memory-import-invalid-schema-scenario")
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)
            import_code = payload["import_code"]
            import_result = payload["import_result"]
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
        result = run_runtime_paths_contract(
            "resolve-execution-plane-config-scenario",
            "--payload",
            json.dumps(
                {
                    "project_toml": project_toml,
                    "env": {
                        "GROBOT_GATEWAY_IMPL": "python",
                        "GROBOT_RUNTIME_IMPL": "python",
                        "GROBOT_SHADOW_MODE": "off",
                    },
                    "cli": {
                        "gateway_impl": "ts",
                        "runtime_impl": "rust",
                        "shadow_mode": True,
                    },
                },
                ensure_ascii=False,
            ),
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        config_project = payload["project_config"]
        config_env = payload["env_config"]
        config_cli = payload["cli_config"]
        env_names = payload["env_names"]

        self.assertEqual(config_project["gateway_impl"], "ts")
        self.assertEqual(config_project["runtime_impl"], "rust")
        self.assertTrue(config_project["shadow_mode"])
        self.assertEqual(config_project["gateway_impl_source"], "project_toml:execution.gateway_impl")
        self.assertEqual(config_project["runtime_impl_source"], "project_toml:execution.runtime_impl")
        self.assertEqual(config_project["shadow_mode_source"], "project_toml:execution.shadow_mode")

        self.assertEqual(config_env["gateway_impl"], "python")
        self.assertEqual(config_env["runtime_impl"], "python")
        self.assertFalse(config_env["shadow_mode"])
        self.assertEqual(config_env["gateway_impl_source"], f"env:{env_names['gateway_impl']}")
        self.assertEqual(config_env["runtime_impl_source"], f"env:{env_names['runtime_impl']}")
        self.assertEqual(config_env["shadow_mode_source"], f"env:{env_names['shadow_mode']}")

        self.assertEqual(config_cli["gateway_impl"], "ts")
        self.assertEqual(config_cli["runtime_impl"], "rust")
        self.assertTrue(config_cli["shadow_mode"])
        self.assertEqual(config_cli["gateway_impl_source"], "cli")
        self.assertEqual(config_cli["runtime_impl_source"], "cli")
        self.assertEqual(config_cli["shadow_mode_source"], "cli")

    def test_management_status_payload_includes_execution_plane(self) -> None:
        with tempfile.TemporaryDirectory() as temp_home, tempfile.TemporaryDirectory() as temp_project:
            project_root = Path(temp_project)
            project_grobot = project_root / ".grobot"
            project_grobot.mkdir(parents=True, exist_ok=True)
            (project_grobot / "project.toml").write_text("schema_version = 1\nmode = \"mvp\"\n", encoding="utf-8")

            result = run_runtime_paths_contract(
                "build-management-status-scenario",
                "--payload",
                json.dumps(
                    {
                        "home": temp_home,
                        "project_root": str(project_root),
                        "execution_plane": {
                            "gateway_impl": "ts",
                            "runtime_impl": "rust",
                            "shadow_mode": True,
                            "sources": {
                                "gateway_impl": "cli",
                                "runtime_impl": "project_toml:execution.runtime_impl",
                                "shadow_mode": "env:GROBOT_SHADOW_MODE",
                            },
                        },
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            payload = json.loads(result.stdout)["status_payload"]
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
