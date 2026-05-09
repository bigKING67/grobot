import { type OptionValue, readExplicitOptionalNonEmptyString } from "../cli-args";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectRoot,
  resolveProjectStateRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";

export interface StatusPathContext {
  readonly homeDir: string;
  readonly projectRoot: string;
  readonly workDir: string;
  readonly projectStateRoot: string;
  readonly projectTomlPath: string | undefined;
  readonly configTomlPath: string | undefined;
  readonly configSource: "none" | "project_work_dir" | "project_root" | "home" | "custom";
  readonly projectName: string;
}

export function resolveStatusPathContext(
  options: Record<string, OptionValue>,
): StatusPathContext {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const configSource =
    configTomlPath == null
      ? "none"
      : configTomlPath.startsWith(`${workDir}/.grobot/`)
        ? "project_work_dir"
        : configTomlPath.startsWith(`${projectRoot}/.grobot/`)
          ? "project_root"
          : configTomlPath.startsWith(`${homeDir}/`)
            ? "home"
            : "custom";
  const projectName =
    readExplicitOptionalNonEmptyString(options, "project") ?? basenameFromPath(workDir);
  return {
    homeDir,
    projectRoot,
    workDir,
    projectStateRoot,
    projectTomlPath,
    configTomlPath,
    configSource,
    projectName,
  };
}
