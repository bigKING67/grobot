import { readFileSync } from "node:fs";
import { type StatusLineConfigInput } from "../../tui/components/status-line/contract";
import {
  parsePercentageAsRatio,
  parseTomlBoolean,
  parseTomlInteger,
  parseTomlNumber,
  parseTomlString,
  parseTomlStringArray,
  parseTomlStringRaw,
  stripInlineComment,
} from "./toml";

export function readStatusLineConfigFromProjectToml(
  projectTomlPath?: string,
): StatusLineConfigInput | undefined {
  if (!projectTomlPath) {
    return undefined;
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const statusLineConfig: StatusLineConfigInput = {};
  const statusLineSegments: Partial<
    Record<"model" | "project" | "context" | "tokens" | "session", boolean>
  > = {};
  let activeSection = "";
  let hasSignal = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      activeSection = sectionMatch[1];
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const rawValue = kvMatch[2];
    if (activeSection === "statusline") {
      if (key === "enabled") {
        const parsed = parseTomlBoolean(rawValue);
        if (typeof parsed === "boolean") {
          statusLineConfig.enabled = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "layout_mode" || key === "layout") {
        const parsed = parseTomlString(rawValue);
        if (typeof parsed === "string" && parsed.length > 0) {
          statusLineConfig.layoutMode = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "theme") {
        const parsed = parseTomlString(rawValue);
        if (typeof parsed === "string" && parsed.length > 0) {
          statusLineConfig.theme = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "separator") {
        const parsed = parseTomlStringRaw(rawValue);
        if (typeof parsed === "string" && parsed.length > 0) {
          statusLineConfig.separator = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "segment_order") {
        const parsed = parseTomlStringArray(rawValue);
        if (parsed.length > 0) {
          statusLineConfig.segmentOrder = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "warning_threshold_ratio") {
        const parsed = parseTomlNumber(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.warningThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "critical_threshold_ratio") {
        const parsed = parseTomlNumber(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.criticalThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "warning_threshold_percent") {
        const parsed = parsePercentageAsRatio(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.warningThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "critical_threshold_percent") {
        const parsed = parsePercentageAsRatio(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.criticalThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "budget_snapshot_cache_ttl_ms") {
        const parsed = parseTomlInteger(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.budgetSnapshotCacheTtlMs = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "session_topic_cache_ttl_ms") {
        const parsed = parseTomlInteger(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.sessionTopicCacheTtlMs = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "session_topic_max_width") {
        const parsed = parseTomlInteger(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.sessionTopicMaxWidth = parsed;
          hasSignal = true;
        }
        continue;
      }
      continue;
    }
    if (activeSection === "statusline.segments") {
      const parsed = parseTomlBoolean(rawValue);
      if (typeof parsed !== "boolean") {
        continue;
      }
      if (
        key === "model" ||
        key === "project" ||
        key === "context" ||
        key === "tokens" ||
        key === "session"
      ) {
        statusLineSegments[key] = parsed;
        hasSignal = true;
      }
    }
  }
  if (!hasSignal) {
    return undefined;
  }
  if (Object.keys(statusLineSegments).length > 0) {
    statusLineConfig.segments = statusLineSegments;
  }
  return statusLineConfig;
}
