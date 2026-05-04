import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { readManagementTokenFromToml } from "../services/management-config";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveInterruptStorePath,
  resolveMemoryStorePath,
  resolveProjectStateRoot,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import { parseBind, type BindConfig } from "./bind-config";
import { memoryStoreRedisKey } from "./memory-store-runtime";

interface ExecutionPlaneConfigInput {
  gatewayImplArg?: string;
  runtimeImplArg?: string;
  shadowModeArg?: boolean;
  noShadowModeArg?: boolean;
  projectTomlPath?: string;
}

export interface RunServeContext {
  options: Record<string, OptionValue>;
  homeDir: string;
  projectRoot: string;
  workDir: string;
  projectTomlPath: string | undefined;
  configTomlPath: string | undefined;
  bind: BindConfig;
  projectName: string;
  managementToken: string | undefined;
  executionPlaneInput: ExecutionPlaneConfigInput;
  projectStateRoot: string;
  interruptStorePath: string;
  memoryStorePath: string;
  memoryStoreKey: string;
}

export function resolveRunServeContext(options: Record<string, OptionValue>): RunServeContext {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const bind = parseBind(readOptionString(options, "bind"));
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const managementToken =
    readOptionString(options, "management-token") ??
    process.env.GROBOT_MANAGEMENT_TOKEN ??
    readManagementTokenFromToml(configTomlPath);
  const executionPlaneInput: ExecutionPlaneConfigInput = {
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  };
  const interruptStorePath = resolveInterruptStorePath(projectStateRoot);
  const memoryStorePath = resolveMemoryStorePath(projectStateRoot);
  const memoryStoreKey = memoryStoreRedisKey(projectName, workDir);

  return {
    options,
    homeDir,
    projectRoot,
    workDir,
    projectTomlPath,
    configTomlPath,
    bind,
    projectName,
    managementToken,
    executionPlaneInput,
    projectStateRoot,
    interruptStorePath,
    memoryStorePath,
    memoryStoreKey,
  };
}
