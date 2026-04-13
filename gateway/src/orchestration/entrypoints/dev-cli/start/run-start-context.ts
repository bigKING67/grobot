import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import {
  basenameFromPath,
  resolveHomeDir,
  resolveInterruptStorePath,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import { createRunStartSessionStore } from "./run-start-session-store";
import { sessionRegistryFilePath } from "./session-registry";
import {
  parsePlatform,
  parseScope,
  resolveHandoffAutoOnExit,
  resolveHandoffRecentTurns,
  resolveHistoryTurns,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "./session-options";
import { buildHandoffPath } from "./run-start-io";

export function resolveRunStartContext(options: Record<string, OptionValue>) {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const historyTurns = resolveHistoryTurns(options);
  const handoffRecentTurns = resolveHandoffRecentTurns(options);
  const handoffAutoOnExit = resolveHandoffAutoOnExit(options);
  const handoffPath = buildHandoffPath(projectRoot);
  const interruptStorePath = resolveInterruptStorePath(homeDir);
  const subject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });

  const sessionNamespace = {
    platform: parsePlatform(resolveSessionPlatformOption(options)),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(resolveSessionScopeOption(options)),
    subject,
  } as const;
  const sessionNamespaceKey = buildSessionKey(sessionNamespace);
  const sessionRegistryFilePathValue = sessionRegistryFilePath(homeDir, sessionNamespaceKey);
  const sessionStore = createRunStartSessionStore({
    options,
    projectTomlPath,
    homeDir,
    sessionNamespaceKey,
    historyTurns,
  });

  return {
    homeDir,
    projectRoot,
    workDir,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    handoffPath,
    interruptStorePath,
    subject,
    executionPlane,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
  };
}
