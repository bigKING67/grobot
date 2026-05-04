import {
  isRecord,
  parseStrictStringArray,
} from "./json-utils";
import {
  type RuntimeToolRecoveryCatalogParseResult,
  type RuntimeToolRecoveryCatalogRow,
} from "./types";

export function parseRuntimeToolRecoveryCatalogWithDiagnostics(
  value: unknown,
): RuntimeToolRecoveryCatalogParseResult {
  if (value == null) {
    return { rows: [], rawCount: 0, invalidReason: null };
  }
  if (!Array.isArray(value)) {
    return { rows: [], rawCount: 0, invalidReason: "recovery_catalog_not_array" };
  }
  const rows: RuntimeToolRecoveryCatalogRow[] = [];
  let invalidRowCount = 0;
  for (const item of value) {
    if (!isRecord(item)) {
      invalidRowCount += 1;
      continue;
    }
    const errorClasses = parseStrictStringArray(item.error_classes);
    const riskClass =
      typeof item.risk_class === "string" ? item.risk_class.trim() : "";
    const stage = typeof item.stage === "string" ? item.stage.trim() : "";
    const recommendedNextAction =
      typeof item.recommended_next_action === "string"
        ? item.recommended_next_action.trim()
        : "";
    const recoverable =
      typeof item.recoverable === "boolean" ? item.recoverable : null;
    if (
      errorClasses == null ||
      errorClasses.length === 0 ||
      !riskClass ||
      !stage ||
      !recommendedNextAction ||
      recoverable == null
    ) {
      invalidRowCount += 1;
      continue;
    }
    rows.push({
      errorClasses,
      riskClass,
      stage,
      recommendedNextAction,
      recoverable,
    });
  }
  return {
    rows,
    rawCount: value.length,
    invalidReason:
      invalidRowCount > 0
        ? `recovery_catalog_invalid_rows:${invalidRowCount}`
        : null,
  };
}
