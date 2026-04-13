import { spawnSync } from "node:child_process";

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

export function resolveRuntimeBinaryPath(): string {
  const envPath = process.env.GROBOT_RUNTIME_BIN;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return envPath.trim();
  }
  const repoRoot = process.env.GROBOT_TS_DEV_REPO_ROOT;
  if (typeof repoRoot === "string" && repoRoot.trim().length > 0) {
    return `${removeTrailingSlashes(repoRoot)}/runtime/target/debug/grobot-runtime`;
  }
  return `${process.cwd()}/runtime/target/debug/grobot-runtime`;
}

export function runRuntimeHealthcheck(runtimeBinaryPath: string): {
  ok: boolean;
  detail: string;
} {
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: "health-1",
    method: "runtime.health",
    params: {},
  });
  const run = spawnSync(runtimeBinaryPath, [], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 4_000,
    maxBuffer: 1_048_576,
  });
  if (run.error) {
    return { ok: false, detail: `spawn_failed: ${String(run.error)}` };
  }
  if (run.status !== 0) {
    return {
      ok: false,
      detail: `exit_status_${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
    };
  }
  const firstLine = String(run.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return { ok: false, detail: "empty_stdout" };
  }
  try {
    const payload = JSON.parse(firstLine) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return { ok: false, detail: "invalid_json_payload" };
    }
    const record = payload as Record<string, unknown>;
    const result = record.result;
    if (typeof result !== "object" || result === null) {
      return { ok: false, detail: "missing_result" };
    }
    const status = (result as Record<string, unknown>).status;
    if (status !== "ok") {
      return { ok: false, detail: `runtime_status=${String(status)}` };
    }
    return { ok: true, detail: "runtime.health=ok" };
  } catch (error) {
    return { ok: false, detail: `json_parse_failed: ${String(error)}` };
  }
}
