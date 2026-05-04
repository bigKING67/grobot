export type JsonRecord = Record<string, unknown>;

export type MockModelCall = {
  bodyText: string;
  toolNames: string[];
  toolArgsByName: Record<string, string[]>;
  hasToolResult: boolean;
};

export type ToolCallSpec = {
  name: string;
  arguments: JsonRecord;
};

export type ErrorDataExpectation = {
  diagnosticKind: string;
  tool: string;
  operation: string;
  profile: string;
  advancedToolSchema: boolean;
  recoveryStage: string;
  recommendedNextAction: string;
  recoverable: boolean;
  recoveryPolicyVersion: string;
  backend?: string;
  mappedTool?: string;
  hiddenArgs?: string[];
  visibleArgsIncludes?: string[];
  visibleArgsExcludes?: string[];
  visibleToolsIncludes?: string[];
  visibleToolsExcludes?: string[];
  enabledToolsIncludes?: string[];
  enabledToolsExcludes?: string[];
  recoveryHintIncludes?: string[];
};

export type RuntimeRpcResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type StructuredErrorDataCheckResult = {
  structuredChecks: number;
  recoveryActionCatalogChecks: number;
};

export type SurfaceCase = {
  id: string;
  profile: string;
  advancedToolSchema: boolean;
  enabledTools: string[];
  modelVisibleTools: string[];
  toolCall: ToolCallSpec;
  expectedOutcome: "success" | "error";
  expectedAssistantMessage?: string;
  expectedErrorClass?: string;
  expectedErrorData?: ErrorDataExpectation;
  schemaExpectations: Array<{
    tool: string;
    includes?: string[];
    excludes?: string[];
  }>;
};

export type SurfaceCaseResult = {
  id: string;
  profile: string;
  outcome: "success" | "error";
  runtime_call_count: number;
  first_model_tool_names: string[];
  tool_end_status: string;
  tool_end_error_class: string | null;
  schema_projection_checks: number;
  structured_error_data_checks: number;
  recovery_action_catalog_checks: number;
};
