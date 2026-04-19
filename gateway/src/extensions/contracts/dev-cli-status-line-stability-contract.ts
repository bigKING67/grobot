import {
  measureDisplayWidth,
  renderStatusLinePrompt,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/status-line-screen";

const baseInput = {
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.643,
  estimatedTokens: 3214,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "status line stability regression",
  promptLabel: "› ",
};

function renderStatusLineWithColumns(columns: number): string {
  const rendered = renderStatusLinePrompt({
    ...baseInput,
    terminalColumns: columns,
  });
  return rendered.split("\n")[0] ?? "";
}

function main(): void {
  const baselineOutput = renderStatusLinePrompt({
    ...baseInput,
    terminalColumns: 96,
  });

  const repeatCount = 600;
  let deterministicStable = true;
  for (let index = 0; index < repeatCount; index += 1) {
    const nextOutput = renderStatusLinePrompt({
      ...baseInput,
      terminalColumns: 96,
    });
    if (nextOutput !== baselineOutput) {
      deterministicStable = false;
      break;
    }
  }

  const warningInput = {
    ...baseInput,
    contextWindowUsageRatio: 0.944,
    terminalColumns: 108,
  };
  const warningBaseline = renderStatusLinePrompt(warningInput);
  let warningStable = true;
  for (let index = 0; index < repeatCount; index += 1) {
    const nextOutput = renderStatusLinePrompt(warningInput);
    if (nextOutput !== warningBaseline) {
      warningStable = false;
      break;
    }
  }

  const columnsToValidate = [42, 48, 62, 82, 108, 140];
  const widthsWithinColumns = columnsToValidate.every((columns) => {
    const line = renderStatusLineWithColumns(columns);
    return measureDisplayWidth(line) <= columns;
  });

  const highFrequencyCount = 2_500;
  const startedAt = Date.now();
  let hash = 0;
  for (let index = 0; index < highFrequencyCount; index += 1) {
    const line = renderStatusLineWithColumns(84);
    const charIndex = line.length > 0 ? index % line.length : 0;
    const codePoint = line.length > 0 ? line.charCodeAt(charIndex) : 0;
    hash = (hash + codePoint) % 100_000_007;
  }
  const elapsedMs = Date.now() - startedAt;
  const averageMsPerRender = highFrequencyCount > 0
    ? elapsedMs / highFrequencyCount
    : 0;
  const performanceWithinSoftBudget = elapsedMs <= 10_000;

  const line96 = renderStatusLineWithColumns(96);
  const noInvalidTokens =
    line96.includes("undefined") === false
    && line96.includes("NaN") === false
    && line96.includes("null") === false;

  const warningLines = warningBaseline.split("\n");
  const warningHasSeparateLine = warningLines.length >= 2;

  const payload = {
    deterministic_stable: deterministicStable,
    warning_stable: warningStable,
    widths_within_columns: widthsWithinColumns,
    no_invalid_tokens: noInvalidTokens,
    warning_has_separate_line: warningHasSeparateLine,
    high_frequency_render_count: highFrequencyCount,
    high_frequency_elapsed_ms: elapsedMs,
    high_frequency_average_ms: Number(averageMsPerRender.toFixed(4)),
    performance_within_soft_budget: performanceWithinSoftBudget,
    anti_dce_hash: hash,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
