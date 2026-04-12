#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import os
from pathlib import Path
from typing import Iterable


def _run_tsx(script_path: Path, args: Iterable[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
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
    return subprocess.run(cmd, capture_output=True, text=True, check=False, env=merged_env)


def run_ts_script(
    script_relative_path: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    script_path = Path(__file__).resolve().parents[1] / "src" / script_relative_path
    return _run_tsx(script_path, args, env=env)


def run_ts_contract(
    script_name: str,
    command: str,
    args: Iterable[str] = (),
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return run_ts_script(f"contracts/{script_name}", (command, *list(args)), env=env)
