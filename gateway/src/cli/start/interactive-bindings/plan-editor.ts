import { spawnSync } from "node:child_process";
import { relative as relativePath, resolve as resolvePath } from "node:path";

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatSpawnError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function detectPlatformFromEnv(): "darwin" | "win32" | "other" {
  const hints = String(
    process.env.OSTYPE ?? process.env.OS ?? "",
  ).toLowerCase();
  if (hints.includes("darwin") || hints.includes("mac")) {
    return "darwin";
  }
  if (hints.includes("windows") || hints === "win32") {
    return "win32";
  }
  return "other";
}

export function formatPlanPathForPanel(
  workDir: string,
  planPath: string | undefined,
): string | undefined {
  const rawPath = planPath?.trim();
  if (!rawPath) {
    return undefined;
  }
  const resolvedPlanPath = resolvePath(rawPath);
  const relativePlanPath = relativePath(workDir, resolvedPlanPath);
  if (
    relativePlanPath &&
    !relativePlanPath.startsWith("..") &&
    !relativePlanPath.startsWith("/")
  ) {
    return relativePlanPath;
  }
  return rawPath;
}

export function launchPlanFileInEditor(planPath: string): {
  ok: boolean;
  detail: string;
} {
  const currentPlatform = detectPlatformFromEnv();
  const editor = String(process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (editor.length > 0) {
    const script = `${editor} ${quoteShellArg(planPath)}`;
    const result = spawnSync("sh", ["-lc", script]);
    if (result.error) {
      return { ok: false, detail: formatSpawnError(result.error) };
    }
    if (typeof result.status === "number" && result.status !== 0) {
      return {
        ok: false,
        detail: `editor exited with code ${String(result.status)}`,
      };
    }
    return { ok: true, detail: "opened by $VISUAL/$EDITOR" };
  }
  if (currentPlatform === "darwin") {
    const result = spawnSync("open", ["-t", planPath]);
    if (result.error) {
      return { ok: false, detail: formatSpawnError(result.error) };
    }
    if (typeof result.status === "number" && result.status !== 0) {
      return {
        ok: false,
        detail: `open exited with code ${String(result.status)}`,
      };
    }
    return { ok: true, detail: "opened by macOS open -t" };
  }
  if (currentPlatform === "win32") {
    const result = spawnSync("cmd", ["/c", "start", "", planPath]);
    if (result.error) {
      return { ok: false, detail: formatSpawnError(result.error) };
    }
    return { ok: true, detail: "opened by Windows start" };
  }
  const result = spawnSync("xdg-open", [planPath]);
  if (result.error) {
    return { ok: false, detail: formatSpawnError(result.error) };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return {
      ok: false,
      detail: `xdg-open exited with code ${String(result.status)}`,
    };
  }
  return { ok: true, detail: "opened by xdg-open" };
}
