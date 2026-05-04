import type {
  ErrorDataExpectation,
  JsonRecord,
  MockModelCall,
  StructuredErrorDataCheckResult,
  SurfaceCase,
} from "./types";

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

export function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export function expectSameStringSet(actual: readonly string[], expected: readonly string[], message: string): void {
  const actualSorted = sortedUnique(actual);
  const expectedSorted = sortedUnique(expected);
  const actualJson = JSON.stringify(actualSorted);
  const expectedJson = JSON.stringify(expectedSorted);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: actual=${actualJson} expected=${expectedJson}`);
  }
  if (actual.length !== actualSorted.length) {
    throw new Error(`${message}: duplicate values in actual=${JSON.stringify(actual)}`);
  }
}

export function assertSchemaExpectations(
  firstCall: MockModelCall,
  expectations: SurfaceCase["schemaExpectations"],
  caseId: string,
): number {
  let checks = 0;
  for (const expectation of expectations) {
    const properties = firstCall.toolArgsByName[expectation.tool] ?? [];
    for (const argName of expectation.includes ?? []) {
      checks += 1;
      expect(
        properties.includes(argName),
        `${caseId}: expected ${expectation.tool}.${argName} to be visible; visible=${JSON.stringify(properties)}`,
      );
    }
    for (const argName of expectation.excludes ?? []) {
      checks += 1;
      expect(
        !properties.includes(argName),
        `${caseId}: expected ${expectation.tool}.${argName} to be hidden; visible=${JSON.stringify(properties)}`,
      );
    }
  }
  return checks;
}

function stringArrayField(data: JsonRecord, field: string, label: string): string[] {
  const value = data[field];
  expect(Array.isArray(value), `${label}: expected ${field} to be an array`);
  return value.map((item, index) => {
    expect(typeof item === "string", `${label}: expected ${field}[${String(index)}] to be string`);
    return item;
  });
}

function expectStringField(
  data: JsonRecord,
  field: string,
  expected: string,
  label: string,
): number {
  expectEqual(data[field], expected, `${label}: ${field}`);
  return 1;
}

function expectBooleanField(
  data: JsonRecord,
  field: string,
  expected: boolean,
  label: string,
): number {
  expectEqual(data[field], expected, `${label}: ${field}`);
  return 1;
}

function assertArrayIncludes(
  data: JsonRecord,
  field: string,
  expected: readonly string[] | undefined,
  label: string,
): number {
  let checks = 0;
  if (!expected || expected.length === 0) {
    return checks;
  }
  const values = stringArrayField(data, field, label);
  for (const item of expected) {
    checks += 1;
    expect(values.includes(item), `${label}: expected ${field} to include ${item}; values=${JSON.stringify(values)}`);
  }
  return checks;
}

function assertArrayExcludes(
  data: JsonRecord,
  field: string,
  expected: readonly string[] | undefined,
  label: string,
): number {
  let checks = 0;
  if (!expected || expected.length === 0) {
    return checks;
  }
  const values = stringArrayField(data, field, label);
  for (const item of expected) {
    checks += 1;
    expect(!values.includes(item), `${label}: expected ${field} to exclude ${item}; values=${JSON.stringify(values)}`);
  }
  return checks;
}

function assertErrorDataExpectation(
  data: JsonRecord,
  expectation: ErrorDataExpectation,
  caseId: string,
  source: string,
): number {
  const label = `${caseId}: ${source} error_data`;
  let checks = 0;
  checks += expectStringField(data, "diagnostic_kind", expectation.diagnosticKind, label);
  checks += expectStringField(data, "tool", expectation.tool, label);
  checks += expectStringField(data, "operation", expectation.operation, label);
  checks += expectStringField(data, "tool_surface_profile", expectation.profile, label);
  checks += expectBooleanField(data, "advanced_tool_schema", expectation.advancedToolSchema, label);
  checks += expectStringField(data, "recovery_stage", expectation.recoveryStage, label);
  checks += expectStringField(data, "recommended_next_action", expectation.recommendedNextAction, label);
  checks += expectBooleanField(data, "recoverable", expectation.recoverable, label);
  checks += expectStringField(data, "recovery_policy_version", expectation.recoveryPolicyVersion, label);
  if (typeof expectation.backend === "string") {
    checks += expectStringField(data, "backend", expectation.backend, label);
  }
  if (typeof expectation.mappedTool === "string") {
    checks += expectStringField(data, "mapped_tool", expectation.mappedTool, label);
  }
  if (expectation.hiddenArgs) {
    expectSameStringSet(stringArrayField(data, "hidden_args", label), expectation.hiddenArgs, `${label}: hidden_args`);
    checks += 1;
  }
  checks += assertArrayIncludes(data, "visible_args", expectation.visibleArgsIncludes, label);
  checks += assertArrayExcludes(data, "visible_args", expectation.visibleArgsExcludes, label);
  checks += assertArrayIncludes(data, "visible_tools", expectation.visibleToolsIncludes, label);
  checks += assertArrayExcludes(data, "visible_tools", expectation.visibleToolsExcludes, label);
  checks += assertArrayIncludes(data, "enabled_tools", expectation.enabledToolsIncludes, label);
  checks += assertArrayExcludes(data, "enabled_tools", expectation.enabledToolsExcludes, label);
  if (expectation.recoveryHintIncludes && expectation.recoveryHintIncludes.length > 0) {
    const recoveryHint = data.recovery_hint;
    expect(typeof recoveryHint === "string", `${label}: recovery_hint must be string`);
    for (const fragment of expectation.recoveryHintIncludes) {
      checks += 1;
      expect(recoveryHint.includes(fragment), `${label}: recovery_hint must include ${fragment}; value=${recoveryHint}`);
    }
  }
  return checks;
}

function assertRecoveryActionInCatalog(
  value: unknown,
  recoveryActions: readonly string[],
  caseId: string,
  source: string,
): number {
  expect(typeof value === "string" && value.length > 0, `${caseId}: ${source} recommended_next_action missing`);
  expect(
    recoveryActions.includes(value),
    `${caseId}: ${source} recommended_next_action not in runtime recovery catalog: ${value}`,
  );
  return 1;
}

export function assertStructuredErrorData(
  surfaceCase: SurfaceCase,
  rpcData: JsonRecord | null,
  toolEndPayload: JsonRecord,
  toolRecoveryPayload: JsonRecord | null,
  recoveryActions: readonly string[],
): StructuredErrorDataCheckResult {
  if (!surfaceCase.expectedErrorData) {
    return { structuredChecks: 0, recoveryActionCatalogChecks: 0 };
  }
  let checks = 0;
  let actionCatalogChecks = 0;
  const toolEndErrorData = isRecord(toolEndPayload.error_data) ? toolEndPayload.error_data : null;
  expect(toolEndErrorData !== null, `${surfaceCase.id}: tool_end must expose structured error_data`);
  checks += assertErrorDataExpectation(
    toolEndErrorData,
    surfaceCase.expectedErrorData,
    surfaceCase.id,
    "tool_end",
  );
  actionCatalogChecks += assertRecoveryActionInCatalog(
    toolEndErrorData.recommended_next_action,
    recoveryActions,
    surfaceCase.id,
    "tool_end error_data",
  );

  expect(rpcData !== null, `${surfaceCase.id}: RPC error must expose structured error_data`);
  checks += assertErrorDataExpectation(
    rpcData,
    surfaceCase.expectedErrorData,
    surfaceCase.id,
    "rpc_error",
  );
  actionCatalogChecks += assertRecoveryActionInCatalog(
    rpcData.recommended_next_action,
    recoveryActions,
    surfaceCase.id,
    "rpc_error error_data",
  );

  expect(toolRecoveryPayload !== null, `${surfaceCase.id}: tool_recovery event missing`);
  const toolRecoveryErrorData = isRecord(toolRecoveryPayload.error_data)
    ? toolRecoveryPayload.error_data
    : null;
  expect(toolRecoveryErrorData !== null, `${surfaceCase.id}: tool_recovery must expose structured error_data`);
  expectEqual(
    toolRecoveryPayload.error_class,
    surfaceCase.expectedErrorClass,
    `${surfaceCase.id}: tool_recovery error class`,
  );
  checks += 1;
  expectEqual(
    toolRecoveryPayload.recovery_stage,
    surfaceCase.expectedErrorData.recoveryStage,
    `${surfaceCase.id}: tool_recovery recovery_stage`,
  );
  checks += 1;
  expectEqual(
    toolRecoveryPayload.recommended_next_action,
    surfaceCase.expectedErrorData.recommendedNextAction,
    `${surfaceCase.id}: tool_recovery recommended_next_action`,
  );
  checks += 1;
  actionCatalogChecks += assertRecoveryActionInCatalog(
    toolRecoveryPayload.recommended_next_action,
    recoveryActions,
    surfaceCase.id,
    "tool_recovery payload",
  );
  expectEqual(
    toolRecoveryPayload.recoverable,
    surfaceCase.expectedErrorData.recoverable,
    `${surfaceCase.id}: tool_recovery recoverable`,
  );
  checks += 1;
  checks += assertErrorDataExpectation(
    toolRecoveryErrorData,
    surfaceCase.expectedErrorData,
    surfaceCase.id,
    "tool_recovery",
  );
  actionCatalogChecks += assertRecoveryActionInCatalog(
    toolRecoveryErrorData.recommended_next_action,
    recoveryActions,
    surfaceCase.id,
    "tool_recovery error_data",
  );
  return { structuredChecks: checks, recoveryActionCatalogChecks: actionCatalogChecks };
}
