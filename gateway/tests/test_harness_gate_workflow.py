#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class HarnessGateWorkflowContractTests(unittest.TestCase):
    WORKFLOW_PATH = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "harness-gate.yml"
    SKILL_ROUTER_CI_GATE_PATH = Path(__file__).resolve().parents[1] / "src" / "evals" / "skill-router-ci-gate.ts"
    POLICY_RUNTIME_PATH = Path(__file__).resolve().parents[1] / "evals" / "ci_label_policy_runtime.js"
    POLICY_DRIFT_RUNTIME_PATH = Path(__file__).resolve().parents[1] / "evals" / "ci_policy_drift_report.js"
    APPLY_LABELS_RUNTIME_PATH = Path(__file__).resolve().parents[1] / "evals" / "ci_apply_labels.js"
    TREND_ACTION_RUNTIME_PATH = Path(__file__).resolve().parents[1] / "evals" / "ci_trend_action_comment.js"
    POLICY_PATH = Path(__file__).resolve().parents[1] / "evals" / "ci_label_policy.json"

    def _read_workflow(self) -> str:
        return self.WORKFLOW_PATH.read_text(encoding="utf-8")

    def _read_skill_router_ci_gate_runtime(self) -> str:
        return self.SKILL_ROUTER_CI_GATE_PATH.read_text(encoding="utf-8")

    def _read_policy_runtime(self) -> str:
        return self.POLICY_RUNTIME_PATH.read_text(encoding="utf-8")

    def _read_policy_drift_runtime(self) -> str:
        return self.POLICY_DRIFT_RUNTIME_PATH.read_text(encoding="utf-8")

    def _read_apply_labels_runtime(self) -> str:
        return self.APPLY_LABELS_RUNTIME_PATH.read_text(encoding="utf-8")

    def _read_trend_action_runtime(self) -> str:
        return self.TREND_ACTION_RUNTIME_PATH.read_text(encoding="utf-8")

    def _run_policy_runtime_probe(self, policy_payload: dict[str, object]) -> dict[str, object]:
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            policy_path = temp_path / "policy.json"
            probe_path = temp_path / "probe.js"
            policy_path.write_text(json.dumps(policy_payload, ensure_ascii=False), encoding="utf-8")
            runtime_path = self.POLICY_RUNTIME_PATH.resolve()
            probe_path.write_text(
                "\n".join(
                    [
                        '"use strict";',
                        "const runtime = require(process.argv[2]);",
                        "const policyPath = process.argv[3];",
                        "const logs = { notice: [], warning: [] };",
                        "const core = {",
                        "  notice: (msg) => logs.notice.push(String(msg)),",
                        "  warning: (msg) => logs.warning.push(String(msg)),",
                        "};",
                        "const labels = runtime.loadCiLabelPolicyForLabels({ policyPath, core });",
                        "const comment = runtime.loadCiLabelPolicyForComment({ policyPath, core });",
                        "process.stdout.write(JSON.stringify({ labels, comment, logs }));",
                    ]
                ),
                encoding="utf-8",
            )
            completed = subprocess.run(
                ["node", str(probe_path), str(runtime_path), str(policy_path)],
                check=True,
                capture_output=True,
                text=True,
            )
            payload = json.loads(completed.stdout)
            self.assertIsInstance(payload, dict)
            return payload

    def _run_policy_runtime_helper_probe(self, script_lines: list[str]) -> dict[str, object]:
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            probe_path = temp_path / "probe-helper.js"
            runtime_path = self.POLICY_RUNTIME_PATH.resolve()
            probe_path.write_text(
                "\n".join(
                    ['"use strict";', "const runtime = require(process.argv[2]);", *script_lines]
                ),
                encoding="utf-8",
            )
            completed = subprocess.run(
                ["node", str(probe_path), str(runtime_path)],
                check=True,
                capture_output=True,
                text=True,
            )
            payload = json.loads(completed.stdout)
            self.assertIsInstance(payload, dict)
            return payload

    def _job_block(self, job_name: str) -> str:
        workflow = self._read_workflow()
        marker = f"  {job_name}:"
        self.assertIn(marker, workflow)
        tail = workflow.split(marker, 1)[1]
        next_job_match = re.search(r"\n  [a-zA-Z0-9_-]+:\n", tail[1:])
        if next_job_match is None:
            return tail
        return tail[: 1 + next_job_match.start()]

    def _extract_apply_labels_script(self) -> str:
        apply_block = self._job_block("apply-suggested-labels")
        marker = "          script: |\n"
        self.assertIn(marker, apply_block)
        tail = apply_block.split(marker, 1)[1]
        script_lines: list[str] = []
        for line in tail.splitlines():
            if not line.strip():
                script_lines.append("")
                continue
            if line.startswith("            "):
                script_lines.append(line[12:])
                continue
            break
        script = "\n".join(script_lines).strip("\n")
        self.assertTrue(script.startswith('const path = require("path");'))
        self.assertIn("applySuggestedLabelsForPullRequest", script)
        self.assertIn("gateway/evals/ci_apply_labels.js", script)
        return f"{script}\n"

    def _run_apply_labels_script(
        self,
        *,
        suggested_labels_json: str,
        drift_worsening_alert: bool,
        drift_worsening_label: str,
    ) -> dict[str, object]:
        script = self._extract_apply_labels_script()
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            workspace_path = temp_path / "workspace"
            evals_path = workspace_path / "gateway" / "evals"
            evals_path.mkdir(parents=True, exist_ok=True)
            (evals_path / "ci_label_policy_runtime.js").write_text(
                self.POLICY_RUNTIME_PATH.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            (evals_path / "ci_apply_labels.js").write_text(
                self.APPLY_LABELS_RUNTIME_PATH.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            (evals_path / "ci_label_policy.json").write_text(
                self.POLICY_PATH.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            script_path = temp_path / "apply-script.js"
            script_path.write_text(script, encoding="utf-8")
            runner_path = temp_path / "runner.js"
            runner_path.write_text(
                "\n".join(
                    [
                        '"use strict";',
                        "const fs = require('fs');",
                        "const scriptPath = process.argv[2];",
                        "const workspacePath = process.argv[3];",
                        "const suggestedLabelsJson = process.argv[4];",
                        "const driftWorseningAlert = process.argv[5];",
                        "const driftWorseningLabel = process.argv[6];",
                        "const script = fs.readFileSync(scriptPath, 'utf8');",
                        "process.env.GITHUB_WORKSPACE = workspacePath;",
                        "process.env.SUGGESTED_LABELS_JSON = suggestedLabelsJson;",
                        "process.env.POLICY_DRIFT_WORSENING_ALERT = driftWorseningAlert;",
                        "process.env.POLICY_DRIFT_WORSENING_LABEL = driftWorseningLabel;",
                        "const repoLabels = [",
                        "  { name: 'ci/harness-pass' },",
                        "  { name: 'ci/harness-fail' },",
                        "  { name: 'ci/policy-drift-none' },",
                        "  { name: 'ci/policy-drift-worsening' },",
                        "  { name: 'ci/action-review' },",
                        "];",
                        "const issueLabels = [{ name: 'ci/harness-pass' }];",
                        "const addedLabels = [];",
                        "const createdLabels = [];",
                        "const removedLabels = [];",
                        "const notices = [];",
                        "const infos = [];",
                        "const warnings = [];",
                        "const listLabelsForRepo = Symbol('listLabelsForRepo');",
                        "const listLabelsOnIssue = Symbol('listLabelsOnIssue');",
                        "const github = {",
                        "  paginate: async (method) => {",
                        "    if (method === listLabelsForRepo) return repoLabels;",
                        "    if (method === listLabelsOnIssue) return issueLabels;",
                        "    throw new Error('unexpected paginate method');",
                        "  },",
                        "  rest: {",
                        "    issues: {",
                        "      listLabelsForRepo,",
                        "      listLabelsOnIssue,",
                        "      createLabel: async ({ name }) => {",
                        "        createdLabels.push(String(name));",
                        "        if (!repoLabels.some((entry) => entry.name === name)) {",
                        "          repoLabels.push({ name: String(name) });",
                        "        }",
                        "      },",
                        "      removeLabel: async ({ name }) => {",
                        "        removedLabels.push(String(name));",
                        "        const index = issueLabels.findIndex((entry) => entry.name === name);",
                        "        if (index >= 0) issueLabels.splice(index, 1);",
                        "      },",
                        "      addLabels: async ({ labels }) => {",
                        "        for (const label of labels) {",
                        "          addedLabels.push(String(label));",
                        "          if (!issueLabels.some((entry) => entry.name === label)) {",
                        "            issueLabels.push({ name: String(label) });",
                        "          }",
                        "        }",
                        "      },",
                        "    },",
                        "  },",
                        "};",
                        "const core = {",
                        "  info: (msg) => infos.push(String(msg)),",
                        "  notice: (msg) => notices.push(String(msg)),",
                        "  warning: (msg) => warnings.push(String(msg)),",
                        "};",
                        "const context = {",
                        "  payload: { pull_request: { number: 101 } },",
                        "  repo: { owner: 'owner', repo: 'repo' },",
                        "};",
                        "const run = new Function(",
                        "  'core',",
                        "  'github',",
                        "  'context',",
                        "  'require',",
                        "  'process',",
                        "  'return (async () => {\\n' + script + '\\n})();'",
                        ");",
                        "run(core, github, context, require, process)",
                        "  .then(() => {",
                        "    process.stdout.write(JSON.stringify({",
                        "      addedLabels,",
                        "      createdLabels,",
                        "      removedLabels,",
                        "      notices,",
                        "      infos,",
                        "      warnings,",
                        "      finalIssueLabels: issueLabels.map((entry) => entry.name),",
                        "    }));",
                        "  })",
                        "  .catch((error) => {",
                        "    console.error(error);",
                        "    process.exit(1);",
                        "  });",
                    ]
                ),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    "node",
                    str(runner_path),
                    str(script_path),
                    str(workspace_path),
                    suggested_labels_json,
                    "true" if drift_worsening_alert else "false",
                    drift_worsening_label,
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(
                completed.returncode,
                0,
                msg=f"runner failed\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
            )
            payload = json.loads(completed.stdout)
            self.assertIsInstance(payload, dict)
            return payload

    def _extract_notify_trend_action_script(self) -> str:
        notify_block = self._job_block("notify-trend-action")
        marker = "          script: |\n"
        self.assertIn(marker, notify_block)
        tail = notify_block.split(marker, 1)[1]
        script_lines: list[str] = []
        for line in tail.splitlines():
            if not line.strip():
                script_lines.append("")
                continue
            if line.startswith("            "):
                script_lines.append(line[12:])
                continue
            break
        script = "\n".join(script_lines).strip("\n")
        self.assertTrue(script.startswith('const path = require("path");'))
        self.assertIn("upsertHarnessGateActionComment", script)
        self.assertIn("gateway/evals/ci_trend_action_comment.js", script)
        return f"{script}\n"

    def _run_notify_trend_action_script(
        self,
        *,
        env_overrides: dict[str, str],
        existing_comment_body: str | None = None,
    ) -> dict[str, object]:
        script = self._extract_notify_trend_action_script()
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            workspace_path = temp_path / "workspace"
            evals_path = workspace_path / "gateway" / "evals"
            evals_path.mkdir(parents=True, exist_ok=True)
            (evals_path / "ci_label_policy_runtime.js").write_text(
                self.POLICY_RUNTIME_PATH.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            (evals_path / "ci_trend_action_comment.js").write_text(
                self.TREND_ACTION_RUNTIME_PATH.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            (evals_path / "ci_label_policy.json").write_text(
                self.POLICY_PATH.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            script_path = temp_path / "notify-script.js"
            script_path.write_text(script, encoding="utf-8")
            runner_path = temp_path / "notify-runner.js"
            runner_path.write_text(
                "\n".join(
                    [
                        '"use strict";',
                        "const fs = require('fs');",
                        "const scriptPath = process.argv[2];",
                        "const workspacePath = process.argv[3];",
                        "const envJson = process.argv[4];",
                        "const existingCommentBody = process.argv[5] || '';",
                        "const script = fs.readFileSync(scriptPath, 'utf8');",
                        "const envOverrides = JSON.parse(envJson);",
                        "process.env.GITHUB_WORKSPACE = workspacePath;",
                        "for (const [key, value] of Object.entries(envOverrides)) {",
                        "  process.env[key] = String(value);",
                        "}",
                        "const comments = [];",
                        "if (existingCommentBody.trim().length > 0) {",
                        "  comments.push({ id: 7001, body: existingCommentBody });",
                        "}",
                        "const createdBodies = [];",
                        "const updatedBodies = [];",
                        "const deletedCommentIds = [];",
                        "const notices = [];",
                        "const infos = [];",
                        "const warnings = [];",
                        "const listComments = Symbol('listComments');",
                        "const github = {",
                        "  paginate: async (method) => {",
                        "    if (method === listComments) return comments;",
                        "    throw new Error('unexpected paginate method');",
                        "  },",
                        "  rest: {",
                        "    issues: {",
                        "      listComments,",
                        "      createComment: async ({ body }) => {",
                        "        createdBodies.push(String(body));",
                        "      },",
                        "      updateComment: async ({ body, comment_id }) => {",
                        "        updatedBodies.push(String(body));",
                        "        const idx = comments.findIndex((entry) => entry.id === comment_id);",
                        "        if (idx >= 0) comments[idx] = { ...comments[idx], body: String(body) };",
                        "      },",
                        "      deleteComment: async ({ comment_id }) => {",
                        "        deletedCommentIds.push(Number(comment_id));",
                        "      },",
                        "    },",
                        "  },",
                        "};",
                        "const core = {",
                        "  info: (msg) => infos.push(String(msg)),",
                        "  notice: (msg) => notices.push(String(msg)),",
                        "  warning: (msg) => warnings.push(String(msg)),",
                        "};",
                        "const context = {",
                        "  payload: { pull_request: { number: 88 } },",
                        "  repo: { owner: 'owner', repo: 'repo' },",
                        "};",
                        "const run = new Function(",
                        "  'core',",
                        "  'github',",
                        "  'context',",
                        "  'require',",
                        "  'process',",
                        "  'return (async () => {\\n' + script + '\\n})();'",
                        ");",
                        "run(core, github, context, require, process)",
                        "  .then(() => {",
                        "    process.stdout.write(JSON.stringify({",
                        "      createdBodies,",
                        "      updatedBodies,",
                        "      deletedCommentIds,",
                        "      notices,",
                        "      infos,",
                        "      warnings,",
                        "    }));",
                        "  })",
                        "  .catch((error) => {",
                        "    console.error(error);",
                        "    process.exit(1);",
                        "  });",
                    ]
                ),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    "node",
                    str(runner_path),
                    str(script_path),
                    str(workspace_path),
                    json.dumps(env_overrides, ensure_ascii=False),
                    existing_comment_body or "",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(
                completed.returncode,
                0,
                msg=f"notify runner failed\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
            )
            payload = json.loads(completed.stdout)
            self.assertIsInstance(payload, dict)
            return payload

    def test_gate_summary_exports_label_outputs(self) -> None:
        workflow = self._read_workflow()
        self.assertIn("overall_state: ${{ steps.export_labels.outputs.overall_state }}", workflow)
        self.assertIn("trend_owner: ${{ steps.export_labels.outputs.trend_owner }}", workflow)
        self.assertIn(
            "trend_decision_tag: ${{ steps.export_labels.outputs.trend_decision_tag }}",
            workflow,
        )
        self.assertIn(
            "trend_decision_severity: ${{ steps.export_labels.outputs.trend_decision_severity }}",
            workflow,
        )
        self.assertIn(
            "trend_action_hint: ${{ steps.export_labels.outputs.trend_action_hint }}",
            workflow,
        )
        self.assertIn("suggested_labels_csv: ${{ steps.export_labels.outputs.suggested_labels_csv }}", workflow)
        self.assertIn("suggested_labels_json: ${{ steps.export_labels.outputs.suggested_labels_json }}", workflow)
        self.assertIn("policy_drift_state: ${{ steps.export_labels.outputs.policy_drift_state }}", workflow)
        self.assertIn("policy_drift_severity: ${{ steps.export_labels.outputs.policy_drift_severity }}", workflow)
        self.assertIn("policy_drift_reason: ${{ steps.export_labels.outputs.policy_drift_reason }}", workflow)
        self.assertIn(
            "policy_drift_worsening_streak: ${{ steps.export_labels.outputs.policy_drift_worsening_streak }}",
            workflow,
        )
        self.assertIn(
            "policy_drift_worsening_alert: ${{ steps.export_labels.outputs.policy_drift_worsening_alert }}",
            workflow,
        )
        self.assertIn(
            "policy_drift_worsening_label: ${{ steps.export_labels.outputs.policy_drift_worsening_label }}",
            workflow,
        )
        self.assertIn(
            "policy_drift_transition: ${{ steps.export_labels.outputs.policy_drift_transition }}",
            workflow,
        )
        self.assertIn(
            "policy_drift_transition_state: ${{ steps.export_labels.outputs.policy_drift_transition_state }}",
            workflow,
        )
        self.assertIn(
            "policy_drift_severity_delta: ${{ steps.export_labels.outputs.policy_drift_severity_delta }}",
            workflow,
        )
        self.assertIn(
            "policy_drift_owner: ${{ steps.export_labels.outputs.policy_drift_owner }}",
            workflow,
        )
        self.assertIn(
            "policy_drift_action_hint: ${{ steps.export_labels.outputs.policy_drift_action_hint }}",
            workflow,
        )

    def test_apply_suggested_labels_job_depends_on_gate_summary(self) -> None:
        workflow = self._read_workflow()
        self.assertIn("apply-suggested-labels:", workflow)
        apply_job_block = workflow.split("apply-suggested-labels:", 1)[1]
        self.assertIn("needs:", apply_job_block)
        self.assertIn("- gate-summary", apply_job_block)
        self.assertIn("issues: write", apply_job_block)

    def test_apply_suggested_labels_enforces_safe_label_policy(self) -> None:
        workflow = self._read_workflow()
        self.assertIn(
            "SUGGESTED_LABELS_JSON: ${{ needs.gate-summary.outputs.suggested_labels_json }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_WORSENING_ALERT: ${{ needs.gate-summary.outputs.policy_drift_worsening_alert }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_WORSENING_LABEL: ${{ needs.gate-summary.outputs.policy_drift_worsening_label }}",
            workflow,
        )
        self.assertIn("gateway/evals/ci_apply_labels.js", workflow)
        self.assertIn("applySuggestedLabelsForPullRequest", workflow)
        self.assertIn("await applySuggestedLabelsForPullRequest({", workflow)
        self.assertIn("workspacePath", workflow)
        apply_block = self._job_block("apply-suggested-labels")
        self.assertEqual(
            apply_block.count('JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"))'),
            0,
            msg="apply-suggested-labels should not parse policy inline",
        )
        self.assertEqual(
            apply_block.count("applySuggestedLabelsForPullRequest({"),
            1,
            msg="apply-suggested-labels should delegate to runtime module once",
        )
        self.assertNotIn("const safeLabels =", apply_block)

    def test_apply_labels_runtime_module_keeps_label_logic(self) -> None:
        runtime = self._read_apply_labels_runtime()
        self.assertIn("loadCiLabelPolicyForLabels({ policyPath, core })", runtime)
        self.assertIn("const allowedDriftSeverities = new Set(POLICY_DRIFT_SEVERITIES);", runtime)
        self.assertIn("driftLabels.push(`${driftLabelPrefix}${driftSeverity}`);", runtime)
        self.assertIn("Injected policy drift worsening label", runtime)
        self.assertIn("Missing labels will be created if possible", runtime)
        self.assertIn("github.rest.issues.createLabel({", runtime)
        self.assertIn("github.rest.issues.removeLabel({", runtime)
        self.assertIn("github.rest.issues.addLabels({", runtime)
        self.assertIn("Removing stale managed labels", runtime)

    def test_apply_suggested_labels_runtime_injects_worsening_label_when_alert_enabled(self) -> None:
        payload = self._run_apply_labels_script(
            suggested_labels_json='["ci/harness-fail","ci/action-review"]',
            drift_worsening_alert=True,
            drift_worsening_label="ci/policy-drift-worsening",
        )
        added = payload.get("addedLabels")
        infos = payload.get("infos")
        self.assertIsInstance(added, list)
        self.assertIsInstance(infos, list)
        assert isinstance(added, list)
        assert isinstance(infos, list)
        self.assertIn("ci/policy-drift-none", added)
        self.assertIn("ci/policy-drift-worsening", added)
        info_text = "\n".join(str(item) for item in infos)
        self.assertIn("Injected policy drift label: ci/policy-drift-none", info_text)
        self.assertIn("Injected policy drift worsening label: ci/policy-drift-worsening", info_text)

    def test_apply_suggested_labels_runtime_skips_worsening_label_when_alert_disabled(self) -> None:
        payload = self._run_apply_labels_script(
            suggested_labels_json='["ci/harness-fail","ci/action-review"]',
            drift_worsening_alert=False,
            drift_worsening_label="ci/policy-drift-worsening",
        )
        added = payload.get("addedLabels")
        infos = payload.get("infos")
        self.assertIsInstance(added, list)
        self.assertIsInstance(infos, list)
        assert isinstance(added, list)
        assert isinstance(infos, list)
        self.assertIn("ci/policy-drift-none", added)
        self.assertNotIn("ci/policy-drift-worsening", added)
        info_text = "\n".join(str(item) for item in infos)
        self.assertIn("Injected policy drift label: ci/policy-drift-none", info_text)
        self.assertNotIn("Injected policy drift worsening label", info_text)

    def test_check_job_runs_ci_label_policy_validation(self) -> None:
        workflow = self._read_workflow()
        self.assertIn("Validate CI label policy", workflow)
        self.assertIn("npm run harness:ci-label-policy:check", workflow)

    def test_notify_trend_action_uses_upsert_comment(self) -> None:
        workflow = self._read_workflow()
        self.assertIn("notify-trend-action:", workflow)
        self.assertIn("Upsert harness gate action comment", workflow)
        self.assertIn("upsertHarnessGateActionComment", workflow)
        self.assertIn("gateway/evals/ci_trend_action_comment.js", workflow)
        self.assertIn("await upsertHarnessGateActionComment({", workflow)
        self.assertIn("workspacePath", workflow)
        self.assertIn("POLICY_DRIFT_SEVERITY: ${{ needs.gate-summary.outputs.policy_drift_severity }}", workflow)
        self.assertIn("POLICY_DRIFT_REASON: ${{ needs.gate-summary.outputs.policy_drift_reason }}", workflow)
        self.assertIn(
            "POLICY_DRIFT_TRANSITION: ${{ needs.gate-summary.outputs.policy_drift_transition }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_TRANSITION_STATE: ${{ needs.gate-summary.outputs.policy_drift_transition_state }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_SEVERITY_DELTA: ${{ needs.gate-summary.outputs.policy_drift_severity_delta }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_OWNER: ${{ needs.gate-summary.outputs.policy_drift_owner }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_ACTION_HINT: ${{ needs.gate-summary.outputs.policy_drift_action_hint }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_WORSENING_STREAK: ${{ needs.gate-summary.outputs.policy_drift_worsening_streak }}",
            workflow,
        )
        self.assertIn(
            "POLICY_DRIFT_WORSENING_ALERT: ${{ needs.gate-summary.outputs.policy_drift_worsening_alert }}",
            workflow,
        )

    def test_notify_trend_action_runtime_module_keeps_comment_logic(self) -> None:
        runtime = self._read_trend_action_runtime()
        self.assertIn("const policyPath = path.join(workspacePath, \"gateway/evals/ci_label_policy.json\");", runtime)
        self.assertIn("loadCiLabelPolicyForComment({ policyPath, core })", runtime)
        self.assertIn("buildPolicyDriftStateMarker(policyDriftStateMeta)", runtime)
        self.assertIn("commentOverallStates.includes(overallState)", runtime)
        self.assertIn("commentTrendSeverities.includes(trendSeverity)", runtime)
        self.assertIn("driftTriggerSeverities.includes(policyDriftSeverity)", runtime)
        self.assertIn("policy drift worsening streak=", runtime)
        self.assertIn("github.rest.issues.deleteComment({", runtime)
        self.assertIn("Comment trigger not matched; no summary comment needed", runtime)
        self.assertIn("github.rest.issues.updateComment({", runtime)
        self.assertIn("github.rest.issues.createComment({", runtime)

    def test_gate_summary_builds_policy_drift_report(self) -> None:
        workflow = self._read_workflow()
        self.assertIn("Build policy drift report", workflow)
        self.assertIn("gateway/evals/data/policy_drift_report.json", workflow)
        self.assertIn("npm run harness:ci-summary:export -- \\", workflow)
        self.assertIn("--summary gateway/evals/data/harness_ci_summary.json \\", workflow)
        self.assertIn("--github-output \"$GITHUB_OUTPUT\" \\", workflow)
        self.assertIn("--print-json", workflow)
        self.assertNotIn("summary_path = Path(\"gateway/evals/data/harness_ci_summary.json\")", workflow)
        self.assertIn("gateway/evals/ci_policy_drift_report.js", workflow)
        self.assertIn("buildPolicyDriftReportForPullRequest", workflow)
        self.assertIn("await buildPolicyDriftReportForPullRequest({", workflow)
        self.assertIn("--policy-drift-report gateway/evals/data/policy_drift_report.json", workflow)
        self.assertNotIn("let previousState = { severity: \"none\", reason: \"shape_ok\", worseningStreak: 0 };", workflow)

    def test_policy_drift_runtime_module_keeps_drift_logic(self) -> None:
        runtime = self._read_policy_drift_runtime()
        self.assertIn("loadCiLabelPolicyForComment({ policyPath, core })", runtime)
        self.assertIn("extractPolicyDriftStateFromCommentBody", runtime)
        self.assertIn("buildPolicyDriftReport({", runtime)
        self.assertIn("let previousState = { severity: \"none\", reason: \"shape_ok\", worseningStreak: 0 };", runtime)
        self.assertIn("policy drift report generated:", runtime)
        self.assertIn("failed to load previous policy drift state from PR comment", runtime)

    def test_skill_router_ci_gate_step_uses_dedicated_script(self) -> None:
        workflow = self._read_workflow()
        self.assertIn("npm run harness:skill-router:ci-gate -- \\", workflow)
        self.assertIn("--event-name \"${{ github.event_name }}\" \\", workflow)
        self.assertIn("--pr-base-sha \"${{ github.event.pull_request.base.sha }}\" \\", workflow)
        self.assertIn("--before-sha \"${{ github.event.before }}\" \\", workflow)
        self.assertIn(
            "--baseline-available \"${{ steps.skill_router_baseline.outputs.available }}\" \\",
            workflow,
        )
        self.assertIn("--repo-root \"$GITHUB_WORKSPACE\" \\", workflow)
        self.assertIn(
            "--output \"$GITHUB_WORKSPACE/gateway/evals/data/skill_router_ci_report.json\" \\",
            workflow,
        )
        self.assertIn(
            "--base-report \"$GITHUB_WORKSPACE/gateway/evals/data/skill_router_ci_report.base.json\" \\",
            workflow,
        )
        self.assertNotIn("set -euo pipefail", workflow)
        self.assertNotIn("CURRENT_POLICY_BLOB=\"$(git rev-parse HEAD:gateway/evals/skill_router_policy.ci.json", workflow)
        self.assertNotIn("python3 gateway/evals/skill_router_trend_meta.py \\", workflow)

    def test_skill_router_ci_gate_runtime_keeps_trend_logic(self) -> None:
        runtime = self._read_skill_router_ci_gate_runtime()
        self.assertIn("resolveBaseSha({", runtime)
        self.assertIn("buildSkillRouterTrendMeta({", runtime)
        self.assertIn('trendReason = "policy_blob_mismatch";', runtime)
        self.assertIn('trendReason = "policy_blob_unavailable";', runtime)
        self.assertIn("--fail-on-trend", runtime)
        self.assertIn('phase: "trend_eval"', runtime)

    def test_skill_router_baseline_step_uses_dedicated_script(self) -> None:
        workflow = self._read_workflow()
        self.assertIn("npm run harness:skill-router:baseline -- \\", workflow)
        self.assertIn("--event-name \"${{ github.event_name }}\" \\", workflow)
        self.assertIn("--pr-base-sha \"${{ github.event.pull_request.base.sha }}\" \\", workflow)
        self.assertIn("--before-sha \"${{ github.event.before }}\" \\", workflow)
        self.assertIn("--repo-root \"$GITHUB_WORKSPACE\" \\", workflow)
        self.assertIn("--github-output \"$GITHUB_OUTPUT\" \\", workflow)
        self.assertNotIn("git worktree add --detach", workflow)
        self.assertNotIn("WORKTREE_DIR=\"$(mktemp -d /tmp/grobot-skill-router-base-XXXXXX)\"", workflow)

    def test_notify_trend_action_job_if_only_checks_pull_request_event(self) -> None:
        notify_block = self._job_block("notify-trend-action")
        header = notify_block.split("steps:", 1)[0]
        self.assertIn("if: ${{ always() && github.event_name == 'pull_request' }}", header)
        self.assertNotIn("needs.gate-summary.outputs.overall_state", header)
        self.assertNotIn("needs.gate-summary.outputs.trend_decision_severity", header)
        self.assertEqual(
            notify_block.count('JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"))'),
            0,
            msg="notify-trend-action should not parse policy inline",
        )
        self.assertEqual(
            notify_block.count("upsertHarnessGateActionComment({"),
            1,
            msg="notify-trend-action should delegate to runtime module once",
        )
        self.assertIn("gateway/evals/ci_trend_action_comment.js", notify_block)
        self.assertNotIn("const shouldNotify =", notify_block)

    def test_notify_trend_action_runtime_creates_comment_using_summary_fields(self) -> None:
        payload = self._run_notify_trend_action_script(
            env_overrides={
                "OVERALL_STATE": "pass",
                "TREND_OWNER": "router-evals",
                "TREND_DECISION_TAG": "TREND_EXECUTED_PASS",
                "TREND_DECISION_SEVERITY": "info",
                "TREND_ACTION_HINT": "trend executed and passed",
                "POLICY_DRIFT_SEVERITY": "medium",
                "POLICY_DRIFT_REASON": "missing_fields",
                "POLICY_DRIFT_TRANSITION": "low->medium",
                "POLICY_DRIFT_TRANSITION_STATE": "worsened",
                "POLICY_DRIFT_SEVERITY_DELTA": "1",
                "POLICY_DRIFT_OWNER": "policy-maintainers",
                "POLICY_DRIFT_ACTION_HINT": "policy drift worsened; add missing required fields and re-run policy guard.",
                "POLICY_DRIFT_WORSENING_STREAK": "2",
                "POLICY_DRIFT_WORSENING_ALERT": "true",
                "SUGGESTED_LABELS_CSV": "ci/harness-pass,ci/policy-drift-medium",
            }
        )
        created = payload.get("createdBodies")
        self.assertIsInstance(created, list)
        assert isinstance(created, list)
        self.assertEqual(len(created), 1)
        body = str(created[0])
        self.assertIn("<!-- harness-gate-summary -->", body)
        self.assertIn("harness-gate-policy-drift-state", body)
        self.assertIn("- policy_drift: `medium:missing_fields`", body)
        self.assertIn("- owner: `policy-maintainers`", body)
        self.assertIn("trend executed and passed", body)
        self.assertIn("policy drift worsened; add missing required fields and re-run policy guard.", body)
        self.assertIn("policy drift transition=low->medium; state=worsened; delta=1", body)
        self.assertIn("policy drift worsening streak=2", body)
        self.assertIn("- suggested_labels: `ci/harness-pass,ci/policy-drift-medium`", body)

    def test_notify_trend_action_runtime_deletes_stale_comment_when_trigger_not_matched(self) -> None:
        payload = self._run_notify_trend_action_script(
            env_overrides={
                "OVERALL_STATE": "pass",
                "TREND_OWNER": "release-owner",
                "TREND_DECISION_TAG": "TREND_NOT_REQUESTED",
                "TREND_DECISION_SEVERITY": "info",
                "TREND_ACTION_HINT": "trend not required for this run",
                "POLICY_DRIFT_SEVERITY": "none",
                "POLICY_DRIFT_REASON": "shape_ok",
                "POLICY_DRIFT_TRANSITION": "none->none",
                "POLICY_DRIFT_TRANSITION_STATE": "stable_none",
                "POLICY_DRIFT_SEVERITY_DELTA": "0",
                "POLICY_DRIFT_OWNER": "release-owner",
                "POLICY_DRIFT_ACTION_HINT": "n/a",
                "POLICY_DRIFT_WORSENING_STREAK": "0",
                "POLICY_DRIFT_WORSENING_ALERT": "false",
                "SUGGESTED_LABELS_CSV": "ci/harness-pass,ci/severity-info",
            },
            existing_comment_body="<!-- harness-gate-summary -->\nold body",
        )
        deleted = payload.get("deletedCommentIds")
        created = payload.get("createdBodies")
        updated = payload.get("updatedBodies")
        notices = payload.get("notices")
        self.assertIsInstance(deleted, list)
        self.assertIsInstance(created, list)
        self.assertIsInstance(updated, list)
        self.assertIsInstance(notices, list)
        assert isinstance(deleted, list)
        assert isinstance(created, list)
        assert isinstance(updated, list)
        assert isinstance(notices, list)
        self.assertEqual(deleted, [7001])
        self.assertEqual(created, [])
        self.assertEqual(updated, [])
        self.assertIn("Removed stale harness gate summary comment", "\n".join(str(item) for item in notices))

    def test_policy_runtime_emits_shape_drift_diagnostics(self) -> None:
        runtime = self._read_policy_runtime()
        self.assertIn('const EXPECTED_SCHEMA = "ci_label_policy";', runtime)
        self.assertIn("const EXPECTED_SCHEMA_VERSION = 1;", runtime)
        self.assertIn("const _analyzePolicyShape = (parsed) => {", runtime)
        self.assertIn("const _classifyPolicyDrift = (shape) => {", runtime)
        self.assertIn("const _buildPolicyDiagnostics = (parsed) => {", runtime)
        self.assertIn("const _emitPolicyDiagnostics = ({ diagnostics, policyPath, core, channel }) => {", runtime)
        self.assertIn("shape drift detected", runtime)
        self.assertIn("severity=", runtime)
        self.assertIn("const POLICY_DRIFT_SEVERITIES = [\"high\", \"medium\", \"low\", \"none\"];", runtime)
        self.assertIn("const DEFAULT_POLICY_DRIFT_POLICY = {", runtime)
        self.assertIn("const _normalizePolicyDrift = (policyDrift) => {", runtime)
        self.assertIn("worseningAlertThreshold: 2", runtime)
        self.assertIn('worseningLabel: "ci/policy-drift-worsening"', runtime)
        self.assertIn('commentTriggerSeverities: ["high", "medium"]', runtime)
        self.assertIn('return { severity: "high", reason: "schema_mismatch" };', runtime)
        self.assertIn('return { severity: "medium", reason: "missing_fields" };', runtime)
        self.assertIn('return { severity: "low", reason: "unknown_fields" };', runtime)
        self.assertIn('return { severity: "none", reason: "shape_ok" };', runtime)
        self.assertIn('"ci/policy-drift-"', runtime)
        self.assertIn("unknown top-level fields", runtime)
        self.assertIn("missing top-level fields", runtime)
        self.assertIn("[ci-label-policy]", runtime)
        self.assertIn("_emitPolicyDiagnostics({ diagnostics, policyPath, core, channel: \"labels\" });", runtime)
        self.assertIn("_emitPolicyDiagnostics({ diagnostics, policyPath, core, channel: \"comment\" });", runtime)

    def test_policy_runtime_probe_reports_high_severity_for_schema_mismatch(self) -> None:
        payload = self._run_policy_runtime_probe(
            {
                "schema": "unexpected_schema",
                "schema_version": 1,
                "safe_label_pattern": "^ci\\/[a-z0-9][a-z0-9/_-]{0,49}$",
                "comment_marker": "<!-- harness-gate-summary -->",
                "comment_trigger": {"overall_states": ["fail"], "trend_severities": ["warn"]},
                "comment_template": {
                    "title": "### Harness Gate Signal",
                    "fields": [{"key": "overall", "label": "overall", "format": "code"}],
                },
                "policy_drift": {
                    "label_prefix": "ci/policy-drift-",
                    "comment_trigger_severities": ["high", "medium"],
                    "action_hints": {
                        "high": "schema mismatch",
                        "medium": "missing fields",
                        "low": "unknown fields",
                        "none": "n/a",
                    },
                },
                "managed_label_prefixes": ["ci/harness-"],
                "default_color": "6a737d",
                "default_description": "Generated by harness gate automation",
                "label_rules": [{"prefix": "ci/harness-pass", "color": "0e8a16", "description": "ok"}],
            }
        )
        logs = payload.get("logs")
        self.assertIsInstance(logs, dict)
        assert isinstance(logs, dict)
        warnings = logs.get("warning")
        self.assertIsInstance(warnings, list)
        assert isinstance(warnings, list)
        joined = "\n".join(str(item) for item in warnings)
        self.assertIn("severity=high", joined)
        self.assertIn("reason=schema_mismatch", joined)

    def test_policy_runtime_probe_reports_medium_and_low_severity(self) -> None:
        medium_payload = self._run_policy_runtime_probe(
            {
                "schema": "ci_label_policy",
                "schema_version": 1,
                "safe_label_pattern": "^ci\\/[a-z0-9][a-z0-9/_-]{0,49}$",
                "comment_marker": "<!-- harness-gate-summary -->",
                "comment_trigger": {"overall_states": ["fail"], "trend_severities": ["warn"]},
                "comment_template": {
                    "title": "### Harness Gate Signal",
                    "fields": [{"key": "overall", "label": "overall", "format": "code"}],
                },
                "policy_drift": {
                    "label_prefix": "ci/policy-drift-",
                    "comment_trigger_severities": ["high", "medium"],
                    "action_hints": {
                        "high": "schema mismatch",
                        "medium": "missing fields",
                        "low": "unknown fields",
                        "none": "n/a",
                    },
                },
                "managed_label_prefixes": ["ci/harness-"],
                "default_color": "6a737d",
                "default_description": "Generated by harness gate automation",
            }
        )
        medium_logs = medium_payload.get("logs")
        self.assertIsInstance(medium_logs, dict)
        assert isinstance(medium_logs, dict)
        medium_joined = "\n".join(str(item) for item in medium_logs.get("warning", []))
        self.assertIn("severity=medium", medium_joined)
        self.assertIn("reason=missing_fields", medium_joined)

        low_payload = self._run_policy_runtime_probe(
            {
                "schema": "ci_label_policy",
                "schema_version": 1,
                "safe_label_pattern": "^ci\\/[a-z0-9][a-z0-9/_-]{0,49}$",
                "comment_marker": "<!-- harness-gate-summary -->",
                "comment_trigger": {"overall_states": ["fail"], "trend_severities": ["warn"]},
                "comment_template": {
                    "title": "### Harness Gate Signal",
                    "fields": [{"key": "overall", "label": "overall", "format": "code"}],
                },
                "policy_drift": {
                    "label_prefix": "ci/policy-drift-",
                    "comment_trigger_severities": ["high", "medium"],
                    "action_hints": {
                        "high": "schema mismatch",
                        "medium": "missing fields",
                        "low": "unknown fields",
                        "none": "n/a",
                    },
                },
                "managed_label_prefixes": ["ci/harness-"],
                "default_color": "6a737d",
                "default_description": "Generated by harness gate automation",
                "label_rules": [{"prefix": "ci/harness-pass", "color": "0e8a16", "description": "ok"}],
                "unexpected": True,
            }
        )
        low_logs = low_payload.get("logs")
        self.assertIsInstance(low_logs, dict)
        assert isinstance(low_logs, dict)
        low_joined = "\n".join(str(item) for item in low_logs.get("warning", []))
        self.assertIn("severity=low", low_joined)
        self.assertIn("reason=unknown_fields", low_joined)

    def test_policy_runtime_probe_reports_none_severity_for_valid_policy(self) -> None:
        policy = json.loads((Path(__file__).resolve().parents[1] / "evals" / "ci_label_policy.json").read_text(encoding="utf-8"))
        payload = self._run_policy_runtime_probe(policy)
        logs = payload.get("logs")
        self.assertIsInstance(logs, dict)
        assert isinstance(logs, dict)
        warnings = logs.get("warning")
        notices = logs.get("notice")
        self.assertIsInstance(warnings, list)
        self.assertIsInstance(notices, list)
        assert isinstance(warnings, list)
        assert isinstance(notices, list)
        self.assertEqual(warnings, [])
        self.assertTrue(any("severity=none" in str(item) for item in notices))

    def test_policy_runtime_extracts_policy_drift_state_marker(self) -> None:
        payload = self._run_policy_runtime_helper_probe(
            [
                'const commentBody = "prefix\\n<!-- harness-gate-policy-drift-state:{\\"severity\\":\\"medium\\",\\"reason\\":\\"missing_fields\\",\\"worsening_streak\\":3} -->\\nsuffix";',
                "const parsed = runtime.extractPolicyDriftStateFromCommentBody({ commentBody });",
                "const fallback = runtime.extractPolicyDriftStateFromCommentBody({ commentBody: 'no marker body' });",
                "process.stdout.write(JSON.stringify({ parsed, fallback }));",
            ]
        )
        parsed = payload.get("parsed")
        fallback = payload.get("fallback")
        self.assertIsInstance(parsed, dict)
        self.assertIsInstance(fallback, dict)
        assert isinstance(parsed, dict)
        assert isinstance(fallback, dict)
        self.assertEqual(parsed.get("severity"), "medium")
        self.assertEqual(parsed.get("reason"), "missing_fields")
        self.assertEqual(parsed.get("worseningStreak"), 3)
        self.assertEqual(fallback.get("severity"), "none")
        self.assertEqual(fallback.get("reason"), "shape_ok")
        self.assertEqual(fallback.get("worseningStreak"), 0)

    def test_policy_runtime_builds_policy_drift_report_from_previous_state(self) -> None:
        payload = self._run_policy_runtime_helper_probe(
            [
                "const report = runtime.buildPolicyDriftReport({",
                "  policyDiagnostics: { severity: 'high', reason: 'schema_mismatch' },",
                "  policyDrift: { worseningAlertThreshold: 2, worseningLabel: 'ci/policy-drift-worsening' },",
                "  previousState: { severity: 'medium', reason: 'missing_fields', worseningStreak: 1 },",
                "});",
                "const marker = runtime.buildPolicyDriftStateMarker({",
                "  severity: report.severity,",
                "  reason: report.reason,",
                "  worsening_streak: report.worsening_streak,",
                "});",
                "process.stdout.write(JSON.stringify({ report, marker }));",
            ]
        )
        report = payload.get("report")
        marker = payload.get("marker")
        self.assertIsInstance(report, dict)
        self.assertIsInstance(marker, str)
        assert isinstance(report, dict)
        assert isinstance(marker, str)
        self.assertEqual(report.get("severity"), "high")
        self.assertEqual(report.get("reason"), "schema_mismatch")
        self.assertEqual(report.get("previous_severity"), "medium")
        self.assertEqual(report.get("worsening_streak"), 2)
        self.assertEqual(report.get("worsening_alert"), True)
        self.assertEqual(report.get("transition"), "medium->high")
        self.assertIn("harness-gate-policy-drift-state", marker)


if __name__ == "__main__":
    unittest.main(verbosity=2)
