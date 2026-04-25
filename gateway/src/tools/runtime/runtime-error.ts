import type { RuntimeEvent } from "../../models/types";

export class RuntimeRpcError extends Error {
  public readonly errorClass: string;
  public readonly errorMessage: string;
  public readonly traceId: string;
  public readonly runtimeEvents: RuntimeEvent[];

  public constructor(input: {
    message: string;
    errorClass: string;
    errorMessage: string;
    traceId: string;
    runtimeEvents: RuntimeEvent[];
  }) {
    super(input.message);
    this.name = "RuntimeRpcError";
    this.errorClass = input.errorClass;
    this.errorMessage = input.errorMessage;
    this.traceId = input.traceId;
    this.runtimeEvents = input.runtimeEvents;
  }
}

export function extractRuntimeErrorEvents(error: unknown): readonly RuntimeEvent[] {
  return error instanceof RuntimeRpcError ? error.runtimeEvents : [];
}
