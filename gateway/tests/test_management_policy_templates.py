#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import unittest

try:
    from gateway.tests.ts_contract import run_node_contract
except ModuleNotFoundError:
    from ts_contract import run_node_contract

MANAGEMENT_ACTION_RELOAD = "reload"
MANAGEMENT_ACTION_INTERRUPT = "interrupt"
MANAGEMENT_ACTION_CONFIG_READ = "config_read"
MANAGEMENT_ACTION_MCP_RESET = "mcp_reset"
MANAGEMENT_ACTION_MEMORY_READ = "memory_read"
MANAGEMENT_ACTION_MEMORY_IMPORT = "memory_import"
MANAGEMENT_ACTION_MEMORY_FORGET = "memory_forget"
MANAGEMENT_ACTION_MEMORY_LIFECYCLE = "memory_lifecycle"
MANAGEMENT_ACTION_MEMORY_MANAGE = "memory_manage"

MANAGEMENT_ACTION_ALL = (
    MANAGEMENT_ACTION_RELOAD,
    MANAGEMENT_ACTION_INTERRUPT,
    MANAGEMENT_ACTION_CONFIG_READ,
    MANAGEMENT_ACTION_MCP_RESET,
    MANAGEMENT_ACTION_MEMORY_READ,
    MANAGEMENT_ACTION_MEMORY_IMPORT,
    MANAGEMENT_ACTION_MEMORY_FORGET,
    MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
    MANAGEMENT_ACTION_MEMORY_MANAGE,
)

CONFIG_SECTION_PATHS = "paths"
CONFIG_SECTION_SELECTION = "selection"
CONFIG_SECTION_SESSION_STORE = "session_store"
CONFIG_SECTION_PROJECT_TOML = "project_toml"
DEFAULT_PUBLIC_CONFIG_SECTIONS = (
    CONFIG_SECTION_SELECTION,
    CONFIG_SECTION_SESSION_STORE,
)


def run_management_policy_contract(
    command: str,
    *,
    payload: dict[str, object] | None = None,
    config: dict[str, object] | None = None,
    required_action: str | None = None,
    override_token: str | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    cmd: list[str] = []
    if payload is not None:
        cmd.extend(["--payload", json.dumps(payload, ensure_ascii=False)])
    if config is not None:
        cmd.extend(["--config", json.dumps(config, ensure_ascii=False)])
    if required_action is not None:
        cmd.extend(["--required-action", required_action])
    if override_token is not None:
        cmd.extend(["--override-token", override_token])
    return run_node_contract("management-policy-contract.mjs", command, cmd, env=env)


class ManagementPolicyTemplateTests(unittest.TestCase):
    def _build_credential(self, payload: dict[str, object]) -> dict[str, object]:
        result = run_management_policy_contract("build-credential", payload=payload)
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        body = json.loads(result.stdout)
        credential = body["credential"]
        self.assertIsInstance(credential, dict)
        if not isinstance(credential, dict):
            self.fail("credential should be object")
        return credential

    def test_ops_read_only_template_defaults(self) -> None:
        credential = self._build_credential(
            {
                "token": "ops-read-token",
                "source": "config_tokens",
                "name": "ops-read",
                "raw_policy_template": "ops_read_only",
            }
        )
        self.assertEqual(tuple(credential["actions"]), (MANAGEMENT_ACTION_CONFIG_READ,))
        self.assertEqual(tuple(credential["config_sections"]), DEFAULT_PUBLIC_CONFIG_SECTIONS)
        self.assertEqual(tuple(credential["interrupt_session_prefixes"]), ())

    def test_audit_read_template_defaults(self) -> None:
        credential = self._build_credential(
            {
                "token": "audit-read-token",
                "source": "config_tokens",
                "name": "audit-read",
                "raw_policy_template": "audit_read",
            }
        )
        self.assertEqual(tuple(credential["actions"]), (MANAGEMENT_ACTION_CONFIG_READ,))
        self.assertEqual(
            tuple(credential["config_sections"]),
            (
                CONFIG_SECTION_PATHS,
                CONFIG_SECTION_SELECTION,
                CONFIG_SECTION_SESSION_STORE,
                CONFIG_SECTION_PROJECT_TOML,
            ),
        )

    def test_full_admin_template_defaults(self) -> None:
        credential = self._build_credential(
            {
                "token": "full-admin-token",
                "source": "config_tokens",
                "name": "full-admin",
                "raw_policy_template": "full_admin",
            }
        )
        self.assertEqual(tuple(credential["actions"]), MANAGEMENT_ACTION_ALL)
        self.assertIsNone(credential["config_sections"])

    def test_memory_ops_readonly_template_defaults(self) -> None:
        credential = self._build_credential(
            {
                "token": "memory-readonly-token",
                "source": "config_tokens",
                "name": "memory-readonly",
                "raw_policy_template": "memory_ops_readonly",
            }
        )
        self.assertEqual(tuple(credential["actions"]), (MANAGEMENT_ACTION_MEMORY_READ,))
        self.assertIsNone(credential["config_sections"])

    def test_memory_ops_writer_template_defaults(self) -> None:
        credential = self._build_credential(
            {
                "token": "memory-writer-token",
                "source": "config_tokens",
                "name": "memory-writer",
                "raw_policy_template": "memory_ops_writer",
            }
        )
        self.assertEqual(
            tuple(credential["actions"]),
            (
                MANAGEMENT_ACTION_MEMORY_IMPORT,
                MANAGEMENT_ACTION_MEMORY_FORGET,
                MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
            ),
        )
        self.assertIsNone(credential["config_sections"])

    def test_explicit_actions_override_template_defaults(self) -> None:
        credential = self._build_credential(
            {
                "token": "reload-only-token",
                "source": "config_tokens",
                "name": "reload-only",
                "raw_policy_template": "full_admin",
                "raw_actions": ["reload"],
            }
        )
        self.assertEqual(tuple(credential["actions"]), (MANAGEMENT_ACTION_RELOAD,))

    def test_explicit_actions_accept_mcp_reset(self) -> None:
        credential = self._build_credential(
            {
                "token": "mcp-reset-token",
                "source": "config_tokens",
                "name": "mcp-reset",
                "raw_actions": ["mcp_reset"],
            }
        )
        self.assertEqual(tuple(credential["actions"]), (MANAGEMENT_ACTION_MCP_RESET,))

    def test_explicit_actions_accept_memory_manage(self) -> None:
        credential = self._build_credential(
            {
                "token": "memory-manage-token",
                "source": "config_tokens",
                "name": "memory-manage",
                "raw_actions": ["memory_manage"],
            }
        )
        self.assertEqual(tuple(credential["actions"]), (MANAGEMENT_ACTION_MEMORY_MANAGE,))

    def test_explicit_actions_accept_granular_memory_actions(self) -> None:
        credential = self._build_credential(
            {
                "token": "memory-granular-token",
                "source": "config_tokens",
                "name": "memory-granular",
                "raw_actions": ["memory_read", "memory_import", "memory_forget", "memory_lifecycle"],
            }
        )
        self.assertEqual(
            tuple(credential["actions"]),
            (
                MANAGEMENT_ACTION_MEMORY_READ,
                MANAGEMENT_ACTION_MEMORY_IMPORT,
                MANAGEMENT_ACTION_MEMORY_FORGET,
                MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
            ),
        )

    def test_memory_manage_alias_allows_granular_actions(self) -> None:
        for required_action in (
            MANAGEMENT_ACTION_MEMORY_READ,
            MANAGEMENT_ACTION_MEMORY_IMPORT,
            MANAGEMENT_ACTION_MEMORY_FORGET,
            MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
        ):
            result = run_management_policy_contract(
                "action-allowed",
                payload={"actions": [MANAGEMENT_ACTION_MEMORY_MANAGE]},
                required_action=required_action,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            body = json.loads(result.stdout)
            self.assertTrue(body["allowed"])

    def test_explicit_config_sections_override_template_profile(self) -> None:
        credential = self._build_credential(
            {
                "token": "audit-limited-token",
                "source": "config_tokens",
                "name": "audit-limited",
                "raw_policy_template": "audit_read",
                "raw_config_sections": ["selection"],
            }
        )
        self.assertEqual(tuple(credential["config_sections"]), (CONFIG_SECTION_SELECTION,))

    def test_explicit_config_profile_override_template_profile(self) -> None:
        credential = self._build_credential(
            {
                "token": "ops-promoted-token",
                "source": "config_tokens",
                "name": "ops-promoted",
                "raw_policy_template": "ops_read_only",
                "raw_config_profile": "admin",
            }
        )
        self.assertIsNone(credential["config_sections"])

    def test_explicit_interrupt_prefixes_applied(self) -> None:
        credential = self._build_credential(
            {
                "token": "interrupt-token",
                "source": "config_tokens",
                "name": "interrupt-only",
                "raw_policy_template": "ops_read_only",
                "raw_interrupt_prefixes": ["feishu:grobot:dm:"],
            }
        )
        self.assertEqual(tuple(credential["interrupt_session_prefixes"]), ("feishu:grobot:dm:",))

    def test_invalid_policy_template_fails_fast(self) -> None:
        result = run_management_policy_contract(
            "build-credential",
            payload={
                "token": "bad-template-token",
                "source": "config_tokens",
                "name": "bad-template",
                "raw_policy_template": "does_not_exist",
            },
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unknown policy template", result.stderr)

    def test_single_management_token_accepts_policy_template(self) -> None:
        config_toml = {
            "management": {
                "token": "management-read-token",
                "policy_template": "ops_read_only",
            }
        }
        result = run_management_policy_contract(
            "resolve-credentials",
            config=config_toml,
            env={"GROBOT_MANAGEMENT_TOKEN": ""},
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        body = json.loads(result.stdout)
        credentials = body["credentials"]
        self.assertEqual(body["source"], "config")
        self.assertEqual(len(credentials), 1)
        self.assertEqual(tuple(credentials[0]["actions"]), (MANAGEMENT_ACTION_CONFIG_READ,))
        self.assertEqual(tuple(credentials[0]["config_sections"]), DEFAULT_PUBLIC_CONFIG_SECTIONS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
