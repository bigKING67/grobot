import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  expect,
  expectEqual,
  expectSameStringSet,
  isRecord,
  parseJson,
} from "./assertions";
import type { JsonRecord, RuntimeRpcResult } from "./types";

export function runtimeBinaryPath(repoRoot: string): string {
  return resolve(repoRoot, "runtime/target/debug", "grobot-runtime");
}

export function runRuntimeRequest(
  repoRoot: string,
  request: JsonRecord,
  envOverrides: Record<string, string | undefined>,
  timeoutMs = 120_000,
): Promise<RuntimeRpcResult> {
  return new Promise((resolveResult, rejectResult) => {
    const binaryPath = runtimeBinaryPath(repoRoot);
    if (!existsSync(binaryPath)) {
      rejectResult(new Error(`runtime binary missing: ${binaryPath}; run cargo build --manifest-path runtime/Cargo.toml`));
      return;
    }
    const previousEnv = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(envOverrides)) {
      previousEnv.set(key, process.env[key]);
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    const restoreEnv = () => {
      for (const [key, value] of previousEnv) {
        if (typeof value === "string") {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      }
    };
    const child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exitCode: 1,
        stdout,
        stderr: stderr.length > 0
          ? `${stderr}\nruntime surface execution timeout after ${String(timeoutMs)}ms`
          : `runtime surface execution timeout after ${String(timeoutMs)}ms`,
      });
    }, timeoutMs);

    const finish = (payload: RuntimeRpcResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      restoreEnv();
      resolveResult(payload);
    };

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string | Buffer) => {
        stdout += String(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string | Buffer) => {
        stderr += String(chunk);
      });
    }
    child.on("error", (error) => {
      restoreEnv();
      rejectResult(error);
    });
    child.on("close", (code) => {
      finish({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
      if (error) {
        child.kill("SIGKILL");
        finish({
          exitCode: 1,
          stdout,
          stderr: `runtime stdin write failed: ${String(error)}`,
        });
      }
    });
    child.stdin.end();
  });
}

export async function loadRuntimeRecoveryActions(repoRoot: string): Promise<string[]> {
  const runtimeResult = await runRuntimeRequest(
    repoRoot,
    {
      jsonrpc: "2.0",
      id: "surface-recovery-actions",
      method: "runtime.tools.describe",
      params: {},
    },
    { ...process.env },
  );
  expectEqual(runtimeResult.exitCode, 0, "runtime.tools.describe process exit");
  const payload = parseFirstJsonLine("runtime.tools.describe", runtimeResult.stdout);
  expect(
    isRecord(payload) && isRecord(payload.result) && Array.isArray(payload.result.tool_recovery_actions),
    "runtime.tools.describe must expose tool_recovery_actions",
  );
  const actions = payload.result.tool_recovery_actions
    .map((item) => (typeof item === "string" ? item : ""))
    .filter((item) => item.length > 0);
  expect(actions.length > 0, "runtime.tools.describe tool_recovery_actions must be non-empty");
  expectSameStringSet(actions, actions, "runtime.tools.describe tool_recovery_actions must be unique");
  return actions;
}

export function parseFirstJsonLine(name: string, stdout: string): unknown {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    throw new Error(`${name}: empty runtime stdout`);
  }
  try {
    return parseJson(firstLine);
  } catch (error) {
    throw new Error(`${name}: first stdout line is not JSON: ${String(error)}\n${stdout}`);
  }
}

export function eventRowsFromRpcPayload(payload: unknown): JsonRecord[] {
  if (!isRecord(payload)) {
    return [];
  }
  const resultEvents = isRecord(payload.result) && Array.isArray(payload.result.events)
    ? payload.result.events
    : null;
  const errorEvents = isRecord(payload.error)
    && isRecord(payload.error.data)
    && Array.isArray(payload.error.data.events)
    ? payload.error.data.events
    : null;
  const rows = resultEvents ?? errorEvents ?? [];
  return rows.filter(isRecord);
}

export function rpcAssistantMessage(payload: unknown): string {
  return isRecord(payload)
    && isRecord(payload.result)
    && typeof payload.result.assistant_message === "string"
    ? payload.result.assistant_message
    : "";
}

export function rpcErrorClass(payload: unknown): string {
  return isRecord(payload)
    && isRecord(payload.error)
    && isRecord(payload.error.data)
    && typeof payload.error.data.error_class === "string"
    ? payload.error.data.error_class
    : "";
}

export function rpcErrorData(payload: unknown): JsonRecord | null {
  return isRecord(payload)
    && isRecord(payload.error)
    && isRecord(payload.error.data)
    && isRecord(payload.error.data.error_data)
    ? payload.error.data.error_data
    : null;
}

export function eventPayload(event: JsonRecord): JsonRecord {
  return isRecord(event.payload) ? event.payload : {};
}

export function findToolEndEvent(events: JsonRecord[], toolName: string): JsonRecord | null {
  return events.find((event) => {
    if (event.event_type !== "tool_end") {
      return false;
    }
    const payload = eventPayload(event);
    return payload.tool_name === toolName;
  }) ?? null;
}

export function findToolRecoveryPayload(events: JsonRecord[], toolName: string): JsonRecord | null {
  const event = events.find((candidate) => {
    if (candidate.event_type !== "tool_recovery") {
      return false;
    }
    const payload = eventPayload(candidate);
    return payload.tool_name === toolName;
  }) ?? null;
  return event ? eventPayload(event) : null;
}
