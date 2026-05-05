import { relative as relativePath, resolve as resolvePath } from "node:path";
import { PLAN_STATUS_PATH_MAX_CHARS } from "./constants";
import {
  measureDisplayWidth,
  truncateDisplayWidth,
} from "../../tui/terminal/display-width";

export function resolvePlanEditorDisplayName(): string | undefined {
  const rawEditor = String(process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (rawEditor.length === 0) {
    return undefined;
  }
  const command = rawEditor.split(/\s+/)[0] ?? rawEditor;
  const parts = command.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? command;
}

export function formatHumanPlanFilePath(input: {
  workDir: string;
  planPath?: string;
}): string {
  const rawPath = input.planPath?.trim();
  if (!rawPath) {
    return "unavailable";
  }
  const resolvedPlanPath = resolvePath(rawPath);
  const relativePlanPath = relativePath(input.workDir, resolvedPlanPath);
  const displayPath = relativePlanPath
    && !relativePlanPath.startsWith("..")
    && !relativePlanPath.startsWith("/")
    ? relativePlanPath
    : rawPath;
  if (measureDisplayWidth(displayPath) <= PLAN_STATUS_PATH_MAX_CHARS) {
    return displayPath;
  }
  const parts = displayPath.split(/[\\/]+/).filter((part) => part.length > 0);
  if (parts.length >= 4) {
    const compactPath = [
      parts[0],
      parts[1],
      "...",
      parts[parts.length - 1],
    ].join("/");
    if (measureDisplayWidth(compactPath) <= PLAN_STATUS_PATH_MAX_CHARS) {
      return compactPath;
    }
  }
  return truncateDisplayWidth(displayPath, PLAN_STATUS_PATH_MAX_CHARS, {
    compact: true,
  });
}
