#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import os
from pathlib import Path
from typing import Iterable


def _run_tsx(script_path: Path, args: Iterable[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    repo_root = Path(__file__).resolve().parents[2]
    local_tsx = repo_root / "node_modules" / ".bin" / "tsx"
    if local_tsx.exists():
        cmd = [
            str(local_tsx),
            str(script_path),
            *list(args),
        ]
    else:
        cmd = [
            "npx",
            "--yes",
            "--package",
            "tsx@4.20.6",
            "tsx",
            str(script_path),
            *list(args),
        ]
    merged_env = os.environ.copy()
    if env is not None:
        merged_env.update(env)
    return subprocess.run(cmd, capture_output=True, text=True, check=False, env=merged_env, cwd=str(repo_root))


def run_ts_script(
    script_relative_path: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    script_path = Path(__file__).resolve().parents[1] / "src" / script_relative_path
    return _run_tsx(script_path, args, env=env)


def run_node_script(
    script_relative_path: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    repo_root = Path(__file__).resolve().parents[2]
    cmd = _build_node_cmd(script_relative_path, args)
    merged_env = os.environ.copy()
    if env is not None:
        merged_env.update(env)
    return subprocess.run(cmd, capture_output=True, text=True, check=False, env=merged_env, cwd=str(repo_root))


def spawn_node_script(
    script_relative_path: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
    cwd: str | Path | None = None,
    text: bool = True,
    stdout: int | None = None,
    stderr: int | None = None,
) -> subprocess.Popen[str]:
    repo_root = Path(__file__).resolve().parents[2]
    cmd = _build_node_cmd(script_relative_path, args)
    merged_env = os.environ.copy()
    if env is not None:
        merged_env.update(env)
    return subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd is not None else str(repo_root),
        text=text,
        stdout=stdout,
        stderr=stderr,
        env=merged_env,
    )


def _build_node_cmd(script_relative_path: str, args: Iterable[str]) -> list[str]:
    script_path = Path(__file__).resolve().parents[1] / "src" / script_relative_path
    return [
        "node",
        str(script_path),
        *list(args),
    ]


def run_ts_contract(
    script_name: str,
    command: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return run_ts_script(f"contracts/{script_name}", (command, *list(args)), env=env)


def run_node_contract(
    script_name: str,
    command: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return run_node_script(f"contracts/{script_name}", (command, *list(args)), env=env)


def spawn_node_contract(
    script_name: str,
    command: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
    cwd: str | Path | None = None,
    text: bool = True,
    stdout: int | None = None,
    stderr: int | None = None,
) -> subprocess.Popen[str]:
    return spawn_node_script(
        f"contracts/{script_name}",
        (command, *list(args)),
        env=env,
        cwd=cwd,
        text=text,
        stdout=stdout,
        stderr=stderr,
    )
