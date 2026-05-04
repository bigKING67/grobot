import { resolve } from "node:path";
import { isObject, requireOption } from "./cli-args.mjs";
import { findProjectRoot, pathJoin, writeJson, writeText } from "./fs-helpers.mjs";

export function resolveRuntimePaths(options) {
  const home = resolve(requireOption(options, "home"));
  const workDir = resolve(requireOption(options, "work-dir"));
  const repoRoot = resolve(options.get("repo-root") ?? process.cwd());
  const projectRootOverride = options.get("project-root");
  const projectRoot = projectRootOverride && projectRootOverride.trim() ? resolve(projectRootOverride) : findProjectRoot(workDir) ?? findProjectRoot(repoRoot) ?? repoRoot;
  const projectDir = pathJoin(projectRoot, ".grobot");
  return {
    home,
    project_root: projectRoot,
    project_toml: pathJoin(projectDir, "project.toml"),
    config_toml: pathJoin(home, "config.toml"),
    sessions_dir: pathJoin(home, "session"),
    global_hooks_dir: pathJoin(home, "hooks"),
    project_hooks_dir: pathJoin(projectDir, "hooks"),
    project_memory_dir: pathJoin(projectDir, "memory")
  };
}

export function resolveSessionStoreConfig(payload) {
  const sessionRoot = resolve(String(payload.session_root ?? ""));
  const projectToml = isObject(payload.project_toml) ? payload.project_toml : {};
  const sessionCfg = isObject(projectToml.session) ? projectToml.session : {};
  const ttlFromProject = sessionCfg.resume_ttl_secs;
  const ttl = typeof ttlFromProject === "number" ? Math.trunc(ttlFromProject) : 1800;
  const sessionBackendArg = typeof payload.session_backend_arg === "string" ? payload.session_backend_arg : "file";
  return {
    root: sessionRoot,
    ttl_secs: ttl,
    backend: sessionBackendArg
  };
}

export function persistMemoryLayersScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const home = resolve(String(payload.home ?? ""));
  const sessionKey = String(payload.session_key ?? "feishu:demo:dm:workspace");
  const projectMemoryDir = pathJoin(projectRoot, ".grobot", "memory");
  const globalMemoryDir = pathJoin(home, "memory", "global");
  const sessionMemoryDir = pathJoin(home, "memory", "session");
  const slug = sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  const sessionSnapshot = pathJoin(sessionMemoryDir, `${slug}.json`);
  const projectLog = pathJoin(projectMemoryDir, "memory.jsonl");
  const globalLog = pathJoin(globalMemoryDir, "memory.jsonl");
  const row = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    session_key: sessionKey,
    compact_memory: payload.compact_memory ?? {}
  };
  writeJson(sessionSnapshot, {
    session_key: sessionKey,
    compact_memory: payload.compact_memory ?? {}
  });
  writeText(projectLog, `${JSON.stringify(row)}
`);
  writeText(globalLog, `${JSON.stringify(row)}
`);
  return {
    warnings: [],
    session_snapshot: sessionSnapshot,
    project_log: projectLog,
    global_log: globalLog
  };
}
