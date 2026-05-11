import { runNodeScriptAsync } from "./harness.mjs";
import { planCaseBuckets } from "./case-bucket-planner.mjs";

function parseWorkerReport(result, bucket) {
  try {
    const report = JSON.parse(result.stdout);
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      throw new Error("worker report must be a JSON object");
    }
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error([
      `gateway worker ${String(bucket.index + 1)} emitted invalid JSON report: ${message}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n"));
  }
}

function recordWorkerReport(reporter, bucket, report) {
  const status = typeof report.status === "string" ? report.status : "unknown";
  const durationMs = Number.isFinite(report.duration_ms) ? report.duration_ms : 0;
  const stepCount = Number.isFinite(report.step_count) ? report.step_count : 0;
  const childCases = Array.isArray(report.cases)
    ? report.cases.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
  reporter.caseResult?.({
    type: "worker",
    worker: bucket.index + 1,
    status,
    cases: bucket.caseIds,
    child_case_count: childCases.length,
    child_failed_case_count: Number.isFinite(report.failed_case_count) ? report.failed_case_count : 0,
    child_step_count: stepCount,
    child_duration_ms: durationMs,
    top_slowest_steps: Array.isArray(report.top_slowest_steps) ? report.top_slowest_steps : [],
  });
  for (const childCase of childCases) {
    reporter.caseResult?.({
      type: "case",
      worker: bucket.index + 1,
      id: typeof childCase.id === "string" ? childCase.id : "",
      suite: typeof childCase.suite === "string" ? childCase.suite : "",
      status: typeof childCase.status === "string" ? childCase.status : "unknown",
      duration_ms: Number.isFinite(childCase.duration_ms) ? childCase.duration_ms : 0,
      split: childCase.split === true,
      child_at: typeof childCase.at === "string" ? childCase.at : "",
    });
  }
  reporter.step(`gateway-worker-${String(bucket.index + 1)}`, {
    cases: bucket.caseIds.join(","),
    child_duration_ms: durationMs,
    child_step_count: stepCount,
  });
}

export async function runCasesInWorkers(caseIdsToRun, workers, caseRecords, reporter) {
  if (workers <= 1 || caseIdsToRun.length <= 1) {
    return false;
  }
  const buckets = planCaseBuckets(caseIdsToRun, workers, caseRecords);
  const workerRuns = buckets
    .map(async (bucket) => ({
      bucket,
      result: await runNodeScriptAsync("gateway/tests/check-gateway-node.mjs", [
        ...bucket.caseIds.flatMap((caseId) => ["--case", caseId]),
        "--json",
      ], {
        env: {
          ...process.env,
          GROBOT_GATEWAY_TIMING_CONTEXT: "suite-worker",
        },
      }),
    }));
  const results = await Promise.all(workerRuns);
  const failures = results.filter(({ result }) => result.code !== 0);
  if (failures.length > 0) {
    const details = failures.map(({ bucket, result }) => [
      `[worker ${String(bucket.index + 1)}] exit=${result.code}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");
    throw new Error(`gateway worker run failed\n${details}`);
  }
  for (const { bucket, result } of results.sort((left, right) => left.bucket.index - right.bucket.index)) {
    recordWorkerReport(reporter, bucket, parseWorkerReport(result, bucket));
  }
  return true;
}
