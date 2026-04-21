#!/usr/bin/env python3
"""Runner adapters for trigger-evaluation workflows.

This module exposes a small adapter layer so trigger evaluation can run across:
- claude-cli (runtime trigger observation)
- codex-cli (intent-classification via Codex CLI)
- openai-compatible APIs (intent-classification via Chat Completions)
"""

from __future__ import annotations

import abc
import json
import os
import re
import select
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request


def build_classifier_prompt(skill_name: str, skill_description: str, query: str) -> str:
    """Build a model-agnostic prompt for skill trigger classification."""
    return (
        "You classify whether a skill should be triggered.\n"
        "Return strict JSON only, with no markdown and no extra keys.\n"
        'Schema: {"trigger": boolean, "reason": string}\n'
        "Reason must be <= 16 words.\n\n"
        f"Skill name: {skill_name}\n"
        f"Skill description: {skill_description}\n\n"
        f"User query: {query}\n"
    )


def parse_trigger_decision(text: str) -> bool:
    """Parse trigger decision from model output text."""
    text = text.strip()
    if not text:
        return False

    # Prefer direct JSON object parsing.
    try:
        payload = json.loads(text)
        for key in ("trigger", "should_trigger", "use_skill"):
            if key in payload:
                return bool(payload[key])
    except json.JSONDecodeError:
        pass

    # Fallback: extract the first JSON object-like substring.
    for candidate in re.findall(r"\{[\s\S]*?\}", text):
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        for key in ("trigger", "should_trigger", "use_skill"):
            if key in payload:
                return bool(payload[key])

    lowered = text.lower()
    if re.search(r"\b(trigger|should[_\s-]?trigger|use[_\s-]?skill)\b", lowered):
        if re.search(r"\btrue\b", lowered):
            return True
        if re.search(r"\bfalse\b", lowered):
            return False
    return False


@dataclass(frozen=True)
class RunnerContext:
    """Runtime context shared by all trigger runners."""

    skill_name: str
    skill_description: str
    project_root: Path
    timeout_seconds: int
    model: str | None
    runner_config: dict[str, Any]


class TriggerRunner(abc.ABC):
    """Abstract runner interface."""

    @abc.abstractmethod
    def detect_trigger(self, query: str, context: RunnerContext) -> bool:
        """Return True if the skill should/was triggered for the query."""


class ClaudeCliRunner(TriggerRunner):
    """Runtime trigger detection via Claude CLI stream events."""

    def detect_trigger(self, query: str, context: RunnerContext) -> bool:
        unique_id = uuid.uuid4().hex[:8]
        clean_name = f"{context.skill_name}-skill-{unique_id}"
        project_commands_dir = context.project_root / ".claude" / "commands"
        command_file = project_commands_dir / f"{clean_name}.md"

        try:
            project_commands_dir.mkdir(parents=True, exist_ok=True)
            indented_desc = "\n  ".join(context.skill_description.split("\n"))
            command_file.write_text(
                (
                    "---\n"
                    "description: |\n"
                    f"  {indented_desc}\n"
                    "---\n\n"
                    f"# {context.skill_name}\n\n"
                    f"This skill handles: {context.skill_description}\n"
                )
            )

            cmd = [
                context.runner_config.get("claude_bin", "claude"),
                "-p",
                query,
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
            ]
            if context.model:
                cmd.extend(["--model", context.model])

            env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                cwd=context.project_root,
                env=env,
            )

            triggered = False
            start = time.time()
            buffer = ""
            pending_tool = None
            accumulated_json = ""

            try:
                while time.time() - start < context.timeout_seconds:
                    if process.poll() is not None:
                        remaining = process.stdout.read()
                        if remaining:
                            buffer += remaining.decode("utf-8", errors="replace")
                        break

                    ready, _, _ = select.select([process.stdout], [], [], 1.0)
                    if not ready:
                        continue

                    chunk = os.read(process.stdout.fileno(), 8192)
                    if not chunk:
                        break
                    buffer += chunk.decode("utf-8", errors="replace")

                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        if event.get("type") == "stream_event":
                            stream_event = event.get("event", {})
                            stream_type = stream_event.get("type", "")

                            if stream_type == "content_block_start":
                                block = stream_event.get("content_block", {})
                                if block.get("type") == "tool_use":
                                    tool_name = block.get("name", "")
                                    if tool_name in ("Skill", "Read"):
                                        pending_tool = tool_name
                                        accumulated_json = ""

                            elif stream_type == "content_block_delta" and pending_tool:
                                delta = stream_event.get("delta", {})
                                if delta.get("type") == "input_json_delta":
                                    accumulated_json += delta.get("partial_json", "")
                                    if clean_name in accumulated_json:
                                        return True

                            elif stream_type in ("content_block_stop", "message_stop"):
                                if pending_tool and clean_name in accumulated_json:
                                    return True
                                if stream_type == "message_stop":
                                    return triggered

                        elif event.get("type") == "assistant":
                            message = event.get("message", {})
                            for content_item in message.get("content", []):
                                if content_item.get("type") != "tool_use":
                                    continue
                                tool_name = content_item.get("name", "")
                                tool_input = content_item.get("input", {})
                                if tool_name == "Skill" and clean_name in tool_input.get("skill", ""):
                                    triggered = True
                                if tool_name == "Read" and clean_name in tool_input.get("file_path", ""):
                                    triggered = True
                            return triggered

                        elif event.get("type") == "result":
                            return triggered
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()

            return triggered
        finally:
            if command_file.exists():
                command_file.unlink()


class CodexCliRunner(TriggerRunner):
    """Intent-level trigger classification via Codex CLI."""

    def detect_trigger(self, query: str, context: RunnerContext) -> bool:
        prompt = build_classifier_prompt(context.skill_name, context.skill_description, query)
        codex_bin = context.runner_config.get("codex_bin", "codex")
        sandbox = context.runner_config.get("sandbox", "read-only")

        cmd = [
            codex_bin,
            "exec",
            "--json",
            "--skip-git-repo-check",
            "--sandbox",
            sandbox,
        ]
        if context.model:
            cmd.extend(["--model", context.model])
        cmd.append(prompt)

        env = os.environ.copy()
        result = subprocess.run(
            cmd,
            cwd=context.project_root,
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=context.timeout_seconds,
        )
        return _parse_codex_json_stream(result.stdout)


def _parse_codex_json_stream(stdout: str) -> bool:
    """Extract trigger boolean from Codex JSONL stream output."""
    candidate_texts: list[str] = []

    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "item.completed":
            continue
        item = event.get("item", {})
        if item.get("type") == "agent_message":
            message_text = item.get("text", "")
            if message_text:
                candidate_texts.append(message_text)

    for text in reversed(candidate_texts):
        try:
            return parse_trigger_decision(text)
        except Exception:
            continue

    return parse_trigger_decision(stdout)


class OpenAICompatibleRunner(TriggerRunner):
    """Intent-level trigger classification via OpenAI-compatible Chat Completions."""

    def detect_trigger(self, query: str, context: RunnerContext) -> bool:
        cfg = context.runner_config
        api_base = (
            cfg.get("api_base_url")
            or os.getenv("OPENAI_API_BASE")
            or "https://api.openai.com/v1"
        )
        model = context.model or cfg.get("model")
        if not model:
            raise ValueError("openai-compatible runner requires model (via --model or runner_config.model)")

        api_key = cfg.get("api_key")
        if not api_key:
            api_key_env = cfg.get("api_key_env", "OPENAI_API_KEY")
            api_key = os.getenv(api_key_env)
        if not api_key:
            raise ValueError("openai-compatible runner requires api key (runner_config.api_key or env OPENAI_API_KEY)")

        prompt = build_classifier_prompt(context.skill_name, context.skill_description, query)
        url = _chat_completions_url(api_base)

        payload = {
            "model": model,
            "temperature": cfg.get("temperature", 0),
            "messages": [
                {
                    "role": "system",
                    "content": "You are a strict JSON classifier. Output valid JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        for key, value in cfg.get("extra_headers", {}).items():
            headers[str(key)] = str(value)

        request = urllib_request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib_request.urlopen(request, timeout=context.timeout_seconds) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib_error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"openai-compatible HTTP {exc.code}: {detail}") from exc

        parsed = json.loads(body)
        content = (
            parsed.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return parse_trigger_decision(content)


def _chat_completions_url(api_base_url: str) -> str:
    base = api_base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def build_runner(name: str) -> TriggerRunner:
    """Factory for trigger runners."""
    normalized = name.strip().lower()
    if normalized == "claude-cli":
        return ClaudeCliRunner()
    if normalized == "codex-cli":
        return CodexCliRunner()
    if normalized == "openai-compatible":
        return OpenAICompatibleRunner()
    raise ValueError(f"Unsupported runner '{name}'")

