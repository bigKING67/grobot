import {
  isRuntimeBinaryPathInputError,
  isRuntimeRepoRootPathInputError,
  resolveRuntimeBinaryPath,
} from "../runtime-health";
import { writeStatusInputError } from "./input-error-output";

export interface StatusRuntimeBinaryPathResult {
  exitCode?: 2;
  runtimeBinaryPath?: string;
}

export function resolveStatusRuntimeBinaryPath(
  runtimeImpl: string,
  outputJson: boolean,
): StatusRuntimeBinaryPathResult {
  if (runtimeImpl !== "rust") {
    return {};
  }
  try {
    return { runtimeBinaryPath: resolveRuntimeBinaryPath() };
  } catch (error) {
    if (
      isRuntimeBinaryPathInputError(error)
      || isRuntimeRepoRootPathInputError(error)
    ) {
      writeStatusInputError(error, outputJson);
      return { exitCode: 2 };
    }
    throw error;
  }
}
