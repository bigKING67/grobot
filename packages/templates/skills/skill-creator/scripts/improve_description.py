#!/usr/bin/env python3
"""Improve a skill description based on trigger-eval results."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

try:
    from scripts.utils import parse_skill_md
except ModuleNotFoundError:
    # Support direct execution: python scripts/improve_description.py ...
    from utils import parse_skill_md


def parse_provider_config(raw: str | None) -> dict[str, Any]:
    """Parse provider config from JSON string or JSON file path."""
    if not raw:
        return {}
    candidate = Path(raw)
    if candidate.exists():
        return json.loads(candidate.read_text())
    return json.loads(raw)


def _build_improvement_prompt(
    skill_name: str,
    skill_content: str,
    current_description: str,
    eval_results: dict[str, Any],
    history: list[dict[str, Any]],
    test_results: dict[str, Any] | None = None,
) -> str:
    """Build prompt for description optimization."""
    failed_triggers = [r for r in eval_results["results"] if r["should_trigger"] and not r["pass"]]
    false_triggers = [r for r in eval_results["results"] if not r["should_trigger"] and not r["pass"]]

    train_score = f"{eval_results['summary']['passed']}/{eval_results['summary']['total']}"
    scores_summary = train_score
    if test_results:
        test_score = f"{test_results['summary']['passed']}/{test_results['summary']['total']}"
        scores_summary = f"Train: {train_score}, Test: {test_score}"

    prompt = f"""You are optimizing a skill description for a skill named "{skill_name}".

The description is the trigger surface. It should activate for relevant user intents and avoid false positives.
Output only <new_description>...</new_description>.

Current description:
<current_description>
{current_description}
</current_description>

Current scores: {scores_summary}
"""
    if failed_triggers:
        prompt += "\nFailed to trigger (should have triggered):\n"
        for item in failed_triggers:
            prompt += f'- "{item["query"]}" ({item["triggers"]}/{item["runs"]})\n'
    if false_triggers:
        prompt += "\nFalse triggers (should NOT have triggered):\n"
        for item in false_triggers:
            prompt += f'- "{item["query"]}" ({item["triggers"]}/{item["runs"]})\n'

    if history:
        prompt += "\nPrevious attempts (avoid repeating structure):\n"
        for attempt in history:
            train_s = f"{attempt.get('train_passed', attempt.get('passed', 0))}/{attempt.get('train_total', attempt.get('total', 0))}"
            prompt += f'- score={train_s} description="{attempt.get("description", "")}"\n'

    prompt += f"""

Skill content for context:
<skill_content>
{skill_content}
</skill_content>

Constraints:
1) Keep the description under 220 words.
2) Use imperative style ("Use this skill when ...").
3) Focus on user intent and trigger boundaries, not implementation internals.
4) Be specific enough to reduce under-triggering, but do not enumerate many exact query examples.
5) Return only:
<new_description>YOUR TEXT</new_description>
"""
    return prompt


def _parse_new_description(text: str) -> str:
    match = re.search(r"<new_description>(.*?)</new_description>", text, re.DOTALL)
    parsed = match.group(1).strip() if match else text.strip()
    return parsed.strip('"').strip("'")


def _call_anthropic(prompt: str, model: str) -> tuple[str, str]:
    try:
        import anthropic
    except ModuleNotFoundError as exc:
        raise RuntimeError("anthropic package is required for provider=anthropic") from exc

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=8000,
        thinking={"type": "enabled", "budget_tokens": 4000},
        messages=[{"role": "user", "content": prompt}],
    )

    thinking_text = ""
    text = ""
    for block in response.content:
        if block.type == "thinking":
            thinking_text = block.thinking
        elif block.type == "text":
            text = block.text
    return text, thinking_text


def _chat_completions_url(api_base_url: str) -> str:
    base = api_base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _call_openai_compatible(
    prompt: str,
    model: str,
    provider_config: dict[str, Any],
    timeout_seconds: int = 90,
) -> tuple[str, str]:
    api_base = (
        provider_config.get("api_base_url")
        or os.getenv("OPENAI_API_BASE")
        or "https://api.openai.com/v1"
    )
    api_key = provider_config.get("api_key")
    if not api_key:
        api_key = os.getenv(provider_config.get("api_key_env", "OPENAI_API_KEY"))
    if not api_key:
        raise RuntimeError(
            "openai-compatible improver requires api key (provider_config.api_key or OPENAI_API_KEY)"
        )

    payload = {
        "model": model,
        "temperature": provider_config.get("temperature", 0.2),
        "messages": [
            {
                "role": "system",
                "content": "You are an expert in skill trigger design. Return only requested tags.",
            },
            {"role": "user", "content": prompt},
        ],
    }
    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    for key, value in provider_config.get("extra_headers", {}).items():
        headers[str(key)] = str(value)

    request = urllib_request.Request(
        _chat_completions_url(api_base),
        data=data,
        headers=headers,
        method="POST",
    )
    try:
        with urllib_request.urlopen(request, timeout=timeout_seconds) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"openai-compatible HTTP {exc.code}: {detail}") from exc

    parsed = json.loads(body)
    text = parsed.get("choices", [{}])[0].get("message", {}).get("content", "")
    return text, ""


def improve_description(
    skill_name: str,
    skill_content: str,
    current_description: str,
    eval_results: dict[str, Any],
    history: list[dict[str, Any]],
    model: str,
    provider: str = "anthropic",
    provider_config: dict[str, Any] | None = None,
    test_results: dict[str, Any] | None = None,
    log_dir: Path | None = None,
    iteration: int | None = None,
) -> str:
    """Generate an improved description using the selected provider."""
    provider_config = provider_config or {}
    prompt = _build_improvement_prompt(
        skill_name=skill_name,
        skill_content=skill_content,
        current_description=current_description,
        eval_results=eval_results,
        history=history,
        test_results=test_results,
    )

    if provider == "anthropic":
        response_text, thinking_text = _call_anthropic(prompt, model)
    elif provider == "openai-compatible":
        response_text, thinking_text = _call_openai_compatible(
            prompt=prompt,
            model=model,
            provider_config=provider_config,
            timeout_seconds=int(provider_config.get("timeout_seconds", 90)),
        )
    else:
        raise ValueError(f"Unsupported provider '{provider}'")

    description = _parse_new_description(response_text)
    transcript = {
        "iteration": iteration,
        "provider": provider,
        "prompt": prompt,
        "thinking": thinking_text,
        "response": response_text,
        "parsed_description": description,
        "char_count": len(description),
    }

    if len(description) > 1024:
        description = description[:1024].rstrip()
        transcript["trimmed_to_1024"] = True
    transcript["final_description"] = description

    if log_dir:
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / f"improve_iter_{iteration or 'unknown'}.json").write_text(
            json.dumps(transcript, indent=2)
        )

    return description


def main() -> None:
    parser = argparse.ArgumentParser(description="Improve a skill description from trigger eval")
    parser.add_argument("--eval-results", required=True, help="Path to eval results JSON")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--history", default=None, help="Path to history JSON")
    parser.add_argument("--model", required=True, help="Model for optimization")
    parser.add_argument(
        "--provider",
        default="anthropic",
        choices=["anthropic", "openai-compatible"],
        help="Provider used to optimize the description",
    )
    parser.add_argument(
        "--provider-config",
        default="{}",
        help="JSON string or path to JSON config file",
    )
    parser.add_argument("--verbose", action="store_true", help="Print verbose output")
    args = parser.parse_args()

    skill_path = Path(args.skill_path)
    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    eval_results = json.loads(Path(args.eval_results).read_text())
    history = json.loads(Path(args.history).read_text()) if args.history else []
    provider_config = parse_provider_config(args.provider_config)

    skill_name, _, skill_content = parse_skill_md(skill_path)
    current_description = eval_results["description"]

    if args.verbose:
        summary = eval_results["summary"]
        print(
            f"Current score: {summary['passed']}/{summary['total']} | provider={args.provider}",
            file=sys.stderr,
        )

    new_description = improve_description(
        skill_name=skill_name,
        skill_content=skill_content,
        current_description=current_description,
        eval_results=eval_results,
        history=history,
        model=args.model,
        provider=args.provider,
        provider_config=provider_config,
    )

    output = {
        "description": new_description,
        "history": history
        + [
            {
                "description": current_description,
                "passed": eval_results["summary"]["passed"],
                "failed": eval_results["summary"]["failed"],
                "total": eval_results["summary"]["total"],
                "results": eval_results["results"],
            }
        ],
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
