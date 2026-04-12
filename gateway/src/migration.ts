import { GatewayImpl, RuntimeImpl } from "./types";

export interface MigrationOptions {
  gatewayImpl: GatewayImpl;
  runtimeImpl: RuntimeImpl;
  shadowMode: boolean;
}

const DEFAULT_OPTIONS: MigrationOptions = {
  gatewayImpl: "python",
  runtimeImpl: "python",
  shadowMode: false,
};

function parseGatewayImpl(value: unknown): GatewayImpl {
  if (value === "python" || value === "ts") {
    return value;
  }
  return DEFAULT_OPTIONS.gatewayImpl;
}

function parseRuntimeImpl(value: unknown): RuntimeImpl {
  if (value === "python" || value === "rust") {
    return value;
  }
  return DEFAULT_OPTIONS.runtimeImpl;
}

export function resolveMigrationOptions(
  overrides?: Partial<MigrationOptions>,
): MigrationOptions {
  const candidate = overrides ?? {};
  return {
    gatewayImpl: parseGatewayImpl(candidate.gatewayImpl),
    runtimeImpl: parseRuntimeImpl(candidate.runtimeImpl),
    shadowMode: Boolean(candidate.shadowMode),
  };
}
