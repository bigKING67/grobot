import type { RuntimeEvent } from "../../models/types";

export class RuntimeRpcError extends Error {
  public readonly errorClass: string;
  public readonly errorMessage: string;
  public readonly errorData: Record<string, unknown> | undefined;
  public readonly traceId: string;
  public readonly runtimeEvents: RuntimeEvent[];

  public constructor(input: {
    message: string;
    errorClass: string;
    errorMessage: string;
    errorData?: Record<string, unknown>;
    traceId: string;
    runtimeEvents: RuntimeEvent[];
  }) {
    super(input.message);
    this.name = "RuntimeRpcError";
    this.errorClass = input.errorClass;
    this.errorMessage = input.errorMessage;
    this.errorData = input.errorData;
    this.traceId = input.traceId;
    this.runtimeEvents = input.runtimeEvents;
  }
}

export function extractRuntimeErrorEvents(error: unknown): readonly RuntimeEvent[] {
  return error instanceof RuntimeRpcError ? error.runtimeEvents : [];
}

export function extractRuntimeErrorData(error: unknown): Record<string, unknown> | undefined {
  return error instanceof RuntimeRpcError ? error.errorData : undefined;
}

export function extractRuntimeErrorClass(error: unknown): string | undefined {
  if (!(error instanceof RuntimeRpcError)) {
    return undefined;
  }
  const trimmed = error.errorClass.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
