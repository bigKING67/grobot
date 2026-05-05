import {
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

interface PersistRunStartModelToConfigInput {
  configTomlPath?: string;
  projectName: string;
  workDir: string;
  homeDir: string;
  providerName?: string;
  modelId: string;
}

interface ParsedProviderBlock {
  startLine: number;
  endLine: number;
  name?: string;
  model?: string;
  modelLine?: number;
}

interface ParsedProjectBlock {
  startLine: number;
  endLine: number;
  name?: string;
  workDir?: string;
  selectedProvider?: string;
  providers: ParsedProviderBlock[];
}

export type PersistRunStartModelToConfigResult =
  | {
    ok: true;
    providerName: string;
    previousModel?: string;
    source: "config_toml:provider.model";
    path: string;
  }
  | {
    ok: false;
    message: string;
  };

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

function normalizeConfigPathForMatch(path: string): string {
  return removeTrailingSlashes(path).replace(/\\/g, "/");
}

function toAbsolutePath(rawPath: string, homeDir: string, baseDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return removeTrailingSlashes(baseDir);
  }
  let expanded = trimmed;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/")) {
    expanded = `${homeDir}/${expanded.slice(2)}`;
  }
  if (expanded.startsWith("/") || expanded.startsWith("\\")) {
    return removeTrailingSlashes(expanded);
  }
  return removeTrailingSlashes(`${removeTrailingSlashes(baseDir)}/${expanded}`);
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function splitInlineComment(line: string): { code: string; comment: string } {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return {
        code: line.slice(0, index),
        comment: line.slice(index),
      };
    }
  }
  return {
    code: line,
    comment: "",
  };
}

function parseTomlString(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("\"")) {
    const match = trimmed.match(/^"((?:\\.|[^"\\])*)"/);
    if (match && typeof match[1] === "string") {
      return match[1]
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\")
        .trim();
    }
  }
  return trimmed;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function parseProjectBlocks(raw: string): { lines: string[]; projects: ParsedProjectBlock[] } {
  const lines = raw.split(/\r?\n/);
  const projects: ParsedProjectBlock[] = [];
  let activeSection = "";
  let currentProject: ParsedProjectBlock | undefined;
  let currentProvider: ParsedProviderBlock | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const originalLine = lines[lineIndex];
    const line = stripInlineComment(originalLine).trim();
    if (!line) {
      continue;
    }
    const arraySectionMatch = line.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
    if (arraySectionMatch) {
      activeSection = arraySectionMatch[1];
      if (activeSection === "projects") {
        currentProvider = undefined;
        currentProject = {
          startLine: lineIndex,
          endLine: lines.length - 1,
          providers: [],
        };
        projects.push(currentProject);
      } else if (activeSection === "projects.agent.providers") {
        if (!currentProject) {
          continue;
        }
        currentProvider = {
          startLine: lineIndex,
          endLine: lines.length - 1,
        };
        currentProject.providers.push(currentProvider);
      } else {
        currentProvider = undefined;
      }
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      activeSection = sectionMatch[1];
      if (activeSection !== "projects.agent.providers") {
        currentProvider = undefined;
      }
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch || !currentProject) {
      continue;
    }
    const key = kvMatch[1];
    const parsedValue = parseTomlString(kvMatch[2]);
    if (!parsedValue) {
      continue;
    }
    if (activeSection === "projects") {
      if (key === "name") {
        currentProject.name = parsedValue;
      } else if (key === "work_dir") {
        currentProject.workDir = parsedValue;
      }
      continue;
    }
    if (activeSection === "projects.agent") {
      if (key === "provider") {
        currentProject.selectedProvider = parsedValue;
      }
      continue;
    }
    if (activeSection === "projects.agent.providers" && currentProvider) {
      if (key === "name") {
        currentProvider.name = parsedValue;
      } else if (key === "model") {
        currentProvider.model = parsedValue;
        currentProvider.modelLine = lineIndex;
      }
    }
  }

  for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
    const project = projects[projectIndex];
    const nextProject = projects[projectIndex + 1];
    project.endLine = (nextProject?.startLine ?? lines.length) - 1;
    for (let providerIndex = 0; providerIndex < project.providers.length; providerIndex += 1) {
      const provider = project.providers[providerIndex];
      const nextProvider = project.providers[providerIndex + 1];
      provider.endLine = Math.min(
        project.endLine,
        (nextProvider?.startLine ?? (project.endLine + 1)) - 1,
      );
    }
  }

  return {
    lines,
    projects,
  };
}

function resolveTargetProject(input: {
  projects: readonly ParsedProjectBlock[];
  projectName: string;
  workDir: string;
  homeDir: string;
}): ParsedProjectBlock | undefined {
  const byName = input.projects.find((project) => project.name?.trim() === input.projectName);
  if (byName) {
    return byName;
  }
  const normalizedWorkDir = normalizeConfigPathForMatch(input.workDir);
  const byWorkDir = input.projects.find((project) => {
    if (!project.workDir) {
      return false;
    }
    const expandedWorkDir = toAbsolutePath(
      project.workDir,
      input.homeDir,
      process.cwd(),
    );
    return normalizeConfigPathForMatch(expandedWorkDir) === normalizedWorkDir;
  });
  if (byWorkDir) {
    return byWorkDir;
  }
  return input.projects[0];
}

function resolveTargetProvider(input: {
  project: ParsedProjectBlock;
  providerName?: string;
}): ParsedProviderBlock | undefined {
  const requestedProvider = input.providerName?.trim();
  if (requestedProvider) {
    const matched = input.project.providers.find((provider) => provider.name?.trim() === requestedProvider);
    if (matched) {
      return matched;
    }
  }
  const selectedProvider = input.project.selectedProvider?.trim();
  if (selectedProvider) {
    const matched = input.project.providers.find((provider) => provider.name?.trim() === selectedProvider);
    if (matched) {
      return matched;
    }
  }
  return input.project.providers[0];
}

function resolveProviderIndent(input: {
  lines: readonly string[];
  provider: ParsedProviderBlock;
}): string {
  for (let lineIndex = input.provider.startLine + 1; lineIndex <= input.provider.endLine; lineIndex += 1) {
    const line = input.lines[lineIndex] ?? "";
    const code = stripInlineComment(line);
    const kvMatch = code.match(/^(\s*)[A-Za-z0-9_]+\s*=/);
    if (kvMatch && typeof kvMatch[1] === "string") {
      return kvMatch[1];
    }
  }
  return "  ";
}

function writeFileAtomically(input: {
  targetPath: string;
  content: string;
}): void {
  const tempPath = `${input.targetPath}.tmp.${String(process.pid)}.${String(Date.now())}`;
  writeFileSync(tempPath, input.content, "utf8");
  try {
    renameSync(tempPath, input.targetPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // best effort cleanup
    }
    throw error;
  }
}

export async function persistRunStartModelToConfig(
  input: PersistRunStartModelToConfigInput,
): Promise<PersistRunStartModelToConfigResult> {
  const configTomlPath = input.configTomlPath?.trim();
  if (!configTomlPath) {
    return {
      ok: false,
      message: "Model sync failed: config_toml path unavailable",
    };
  }
  const modelId = input.modelId.trim();
  if (!modelId) {
    return {
      ok: false,
      message: "Model sync failed: target model is empty",
    };
  }

  let rawToml = "";
  try {
    rawToml = readFileSync(configTomlPath, "utf8");
  } catch {
    return {
      ok: false,
      message: `Model sync failed: cannot read config_toml (${configTomlPath})`,
    };
  }
  const { lines, projects } = parseProjectBlocks(rawToml);
  if (projects.length === 0) {
    return {
      ok: false,
      message: "Model sync failed: config_toml has no [[projects]] entries",
    };
  }
  const project = resolveTargetProject({
    projects,
    projectName: input.projectName,
    workDir: input.workDir,
    homeDir: input.homeDir,
  });
  if (!project) {
    return {
      ok: false,
      message: "Model sync failed: cannot resolve project config block",
    };
  }
  const provider = resolveTargetProvider({
    project,
    providerName: input.providerName,
  });
  if (!provider) {
    return {
      ok: false,
      message: "Model sync failed: target project has no usable [[projects.agent.providers]] block",
    };
  }

  const providerIndent = resolveProviderIndent({
    lines,
    provider,
  });
  const escapedModelId = escapeTomlString(modelId);
  const renderedModelLine = `${providerIndent}model = "${escapedModelId}"`;
  if (
    typeof provider.modelLine === "number"
    && provider.modelLine >= 0
    && provider.modelLine < lines.length
  ) {
    const originalLine = lines[provider.modelLine] ?? "";
    const { comment } = splitInlineComment(originalLine);
    lines[provider.modelLine] = comment.trim().length > 0
      ? `${renderedModelLine} ${comment.trimStart()}`
      : renderedModelLine;
  } else {
    const insertAt = Math.min(provider.endLine + 1, lines.length);
    lines.splice(insertAt, 0, renderedModelLine);
  }

  const eol = rawToml.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingNewline = rawToml.endsWith("\n") || rawToml.endsWith("\r\n");
  const nextRawToml = lines.join(eol) + (hasTrailingNewline ? eol : "");
  try {
    writeFileAtomically({
      targetPath: configTomlPath,
      content: nextRawToml,
    });
  } catch {
    return {
      ok: false,
      message: `Model sync failed: cannot write config_toml (${configTomlPath})`,
    };
  }

  return {
    ok: true,
    providerName: provider.name?.trim() || input.providerName?.trim() || "<unnamed-provider>",
    previousModel: provider.model?.trim(),
    source: "config_toml:provider.model",
    path: configTomlPath,
  };
}
