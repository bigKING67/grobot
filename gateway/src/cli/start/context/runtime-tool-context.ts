import { readFileSync } from "node:fs";
import { type RuntimeToolContext } from "../../../models/types";
import { buildRuntimeToolContextForMessage } from "../../../tools/runtime/default-enabled-tools";
import {
  resolveRuntimeToolDescribeDecision,
  type RuntimeToolEnabledToolsSource,
} from "../../services/runtime-tool-describe-decision";
import { parseTomlStringArray, stripInlineComment } from "./toml";

function readToolsAllowlistFromProjectToml(projectTomlPath?: string): string[] {
  if (!projectTomlPath) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  let inToolsSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inToolsSection = sectionMatch[1] === "tools";
      continue;
    }
    if (!inToolsSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    if (kvMatch[1] !== "allow") {
      continue;
    }
    return parseTomlStringArray(kvMatch[2]);
  }
  return [];
}

export interface RuntimeToolContextDiagnostics {
  enabledToolsSource: RuntimeToolEnabledToolsSource;
  enabledToolsSourceDetail?: string;
  manifestFingerprint: string;
  manifestToolCount: number;
  manifestDefaultEnabledCount: number;
  schemaProfilesFingerprint: string | null;
}

export interface ResolvedRuntimeToolContext {
  context: RuntimeToolContext;
  diagnostics: RuntimeToolContextDiagnostics;
}

export function resolveRuntimeToolContext(
  workDir: string,
  projectTomlPath?: string,
): ResolvedRuntimeToolContext {
  const bashAllowlist = readToolsAllowlistFromProjectToml(projectTomlPath);
  const maxToolRoundsRaw = process.env.GROBOT_MAX_TOOL_ROUNDS;
  const parsedMaxToolRounds =
    typeof maxToolRoundsRaw === "string" &&
    /^\d+$/.test(maxToolRoundsRaw.trim())
      ? Number.parseInt(maxToolRoundsRaw.trim(), 10)
      : undefined;
  const maxToolRounds =
    typeof parsedMaxToolRounds === "number" &&
    Number.isFinite(parsedMaxToolRounds)
      ? Math.min(Math.max(parsedMaxToolRounds, 1), 32)
      : 8;
  const noToolFallbackModeRaw = process.env.GROBOT_NO_TOOL_FALLBACK_MODE
    ?.trim()
    .toLowerCase();
  const noToolFallbackMode =
    noToolFallbackModeRaw === "off" ||
    noToolFallbackModeRaw === "safe" ||
    noToolFallbackModeRaw === "strict"
      ? noToolFallbackModeRaw
      : "safe";
  const maxRecoveryRoundsRaw = process.env.GROBOT_MAX_RECOVERY_ROUNDS;
  const parsedMaxRecoveryRounds =
    typeof maxRecoveryRoundsRaw === "string" &&
    /^\d+$/.test(maxRecoveryRoundsRaw.trim())
      ? Number.parseInt(maxRecoveryRoundsRaw.trim(), 10)
      : undefined;
  const maxRecoveryRounds =
    typeof parsedMaxRecoveryRounds === "number" &&
    Number.isFinite(parsedMaxRecoveryRounds)
      ? Math.min(Math.max(parsedMaxRecoveryRounds, 0), 8)
      : 2;
  const runtimeToolDescribeDecision = resolveRuntimeToolDescribeDecision();
  const enabledTools = runtimeToolDescribeDecision.enabledTools;
  const context =
    buildRuntimeToolContextForMessage(
      {
        workDir,
        enabledTools,
        bashAllowlist,
        maxToolRounds,
        noToolFallbackMode,
        maxRecoveryRounds,
      },
      undefined,
    ) ?? {
      workDir,
      enabledTools,
      bashAllowlist,
      maxToolRounds,
      noToolFallbackMode,
      maxRecoveryRounds,
    };
  return {
    context,
    diagnostics: {
      enabledToolsSource: runtimeToolDescribeDecision.enabledToolsSource,
      enabledToolsSourceDetail:
        runtimeToolDescribeDecision.enabledToolsSourceDetail,
      manifestFingerprint: runtimeToolDescribeDecision.manifestFingerprint,
      manifestToolCount: runtimeToolDescribeDecision.manifestToolCount,
      manifestDefaultEnabledCount:
        runtimeToolDescribeDecision.manifestDefaultEnabledCount,
      schemaProfilesFingerprint:
        runtimeToolDescribeDecision.schemaProfilesFingerprint,
    },
  };
}
