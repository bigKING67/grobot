"""Shared utilities for skill-creator scripts."""

from __future__ import annotations

import re
from pathlib import Path

import yaml


def split_frontmatter(content: str) -> tuple[str, str]:
    """Split markdown content into YAML frontmatter and body."""
    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        raise ValueError("SKILL.md missing or invalid YAML frontmatter")
    return match.group(1), match.group(2)


def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    """Parse SKILL.md and return (name, description, full_content)."""
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        raise ValueError(f"SKILL.md not found: {skill_md}")

    content = skill_md.read_text()
    frontmatter_text, _ = split_frontmatter(content)

    try:
        frontmatter = yaml.safe_load(frontmatter_text)
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid SKILL.md frontmatter YAML: {exc}") from exc

    if not isinstance(frontmatter, dict):
        raise ValueError("SKILL.md frontmatter must be a mapping")

    name = frontmatter.get("name", "")
    description = frontmatter.get("description", "")
    if not isinstance(name, str):
        raise ValueError("SKILL.md frontmatter 'name' must be a string")
    if not isinstance(description, str):
        raise ValueError("SKILL.md frontmatter 'description' must be a string")

    return name.strip(), description.strip(), content

