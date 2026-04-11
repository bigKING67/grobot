#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


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


class ManagementPolicyTemplateTests(unittest.TestCase):
    def test_ops_read_only_template_defaults(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="ops-read-token",
            source="config_tokens",
            name="ops-read",
            raw_policy_template="ops_read_only",
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.actions, (grobot_cli.MANAGEMENT_ACTION_CONFIG_READ,))
        self.assertEqual(credential.config_sections, grobot_cli.DEFAULT_PUBLIC_CONFIG_SECTIONS)
        self.assertEqual(credential.interrupt_session_prefixes, ())

    def test_audit_read_template_defaults(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="audit-read-token",
            source="config_tokens",
            name="audit-read",
            raw_policy_template="audit_read",
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.actions, (grobot_cli.MANAGEMENT_ACTION_CONFIG_READ,))
        self.assertEqual(
            credential.config_sections,
            (
                grobot_cli.CONFIG_SECTION_PATHS,
                grobot_cli.CONFIG_SECTION_SELECTION,
                grobot_cli.CONFIG_SECTION_SESSION_STORE,
                grobot_cli.CONFIG_SECTION_PROJECT_TOML,
            ),
        )

    def test_full_admin_template_defaults(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="full-admin-token",
            source="config_tokens",
            name="full-admin",
            raw_policy_template="full_admin",
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.actions, grobot_cli.MANAGEMENT_ACTION_ALL)
        self.assertIsNone(credential.config_sections)

    def test_memory_ops_readonly_template_defaults(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="memory-readonly-token",
            source="config_tokens",
            name="memory-readonly",
            raw_policy_template="memory_ops_readonly",
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.actions, (grobot_cli.MANAGEMENT_ACTION_MEMORY_READ,))
        self.assertIsNone(credential.config_sections)

    def test_memory_ops_writer_template_defaults(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="memory-writer-token",
            source="config_tokens",
            name="memory-writer",
            raw_policy_template="memory_ops_writer",
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(
            credential.actions,
            (
                grobot_cli.MANAGEMENT_ACTION_MEMORY_IMPORT,
                grobot_cli.MANAGEMENT_ACTION_MEMORY_FORGET,
                grobot_cli.MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
            ),
        )
        self.assertIsNone(credential.config_sections)

    def test_explicit_actions_override_template_defaults(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="reload-only-token",
            source="config_tokens",
            name="reload-only",
            raw_policy_template="full_admin",
            raw_actions=["reload"],
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.actions, (grobot_cli.MANAGEMENT_ACTION_RELOAD,))

    def test_explicit_actions_accept_mcp_reset(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="mcp-reset-token",
            source="config_tokens",
            name="mcp-reset",
            raw_actions=["mcp_reset"],
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.actions, (grobot_cli.MANAGEMENT_ACTION_MCP_RESET,))

    def test_explicit_actions_accept_memory_manage(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="memory-manage-token",
            source="config_tokens",
            name="memory-manage",
            raw_actions=["memory_manage"],
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.actions, (grobot_cli.MANAGEMENT_ACTION_MEMORY_MANAGE,))

    def test_explicit_actions_accept_granular_memory_actions(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="memory-granular-token",
            source="config_tokens",
            name="memory-granular",
            raw_actions=["memory_read", "memory_import", "memory_forget", "memory_lifecycle"],
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(
            credential.actions,
            (
                grobot_cli.MANAGEMENT_ACTION_MEMORY_READ,
                grobot_cli.MANAGEMENT_ACTION_MEMORY_IMPORT,
                grobot_cli.MANAGEMENT_ACTION_MEMORY_FORGET,
                grobot_cli.MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
            ),
        )

    def test_memory_manage_alias_allows_granular_actions(self) -> None:
        actions = (grobot_cli.MANAGEMENT_ACTION_MEMORY_MANAGE,)
        self.assertTrue(grobot_cli.management_action_allowed(actions, grobot_cli.MANAGEMENT_ACTION_MEMORY_READ))
        self.assertTrue(grobot_cli.management_action_allowed(actions, grobot_cli.MANAGEMENT_ACTION_MEMORY_IMPORT))
        self.assertTrue(grobot_cli.management_action_allowed(actions, grobot_cli.MANAGEMENT_ACTION_MEMORY_FORGET))
        self.assertTrue(grobot_cli.management_action_allowed(actions, grobot_cli.MANAGEMENT_ACTION_MEMORY_LIFECYCLE))

    def test_explicit_config_sections_override_template_profile(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="audit-limited-token",
            source="config_tokens",
            name="audit-limited",
            raw_policy_template="audit_read",
            raw_config_sections=["selection"],
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.config_sections, (grobot_cli.CONFIG_SECTION_SELECTION,))

    def test_explicit_config_profile_override_template_profile(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="ops-promoted-token",
            source="config_tokens",
            name="ops-promoted",
            raw_policy_template="ops_read_only",
            raw_config_profile="admin",
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertIsNone(credential.config_sections)

    def test_explicit_interrupt_prefixes_applied(self) -> None:
        credential = grobot_cli.build_management_credential(
            token="interrupt-token",
            source="config_tokens",
            name="interrupt-only",
            raw_policy_template="ops_read_only",
            raw_interrupt_prefixes=["feishu:grobot:dm:"],
        )
        self.assertIsNotNone(credential)
        assert credential is not None
        self.assertEqual(credential.interrupt_session_prefixes, ("feishu:grobot:dm:",))

    def test_invalid_policy_template_fails_fast(self) -> None:
        with self.assertRaises(SystemExit):
            _ = grobot_cli.build_management_credential(
                token="bad-template-token",
                source="config_tokens",
                name="bad-template",
                raw_policy_template="does_not_exist",
            )

    def test_single_management_token_accepts_policy_template(self) -> None:
        config_toml = {
            "management": {
                "token": "management-read-token",
                "policy_template": "ops_read_only",
            }
        }
        with mock.patch.dict(os.environ, {"GROBOT_MANAGEMENT_TOKEN": ""}, clear=False):
            credentials, source = grobot_cli.resolve_management_credentials(config_toml, override_token=None)

        self.assertEqual(source, "config")
        self.assertEqual(len(credentials), 1)
        self.assertEqual(credentials[0].actions, (grobot_cli.MANAGEMENT_ACTION_CONFIG_READ,))
        self.assertEqual(credentials[0].config_sections, grobot_cli.DEFAULT_PUBLIC_CONFIG_SECTIONS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
