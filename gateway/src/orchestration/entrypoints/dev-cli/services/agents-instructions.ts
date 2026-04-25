import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
export const AGENTS_INSTRUCTION_SEPARATOR = "\n\n--- project-doc ---\n\n";

export interface ResolveAgentsInstructionBlockInput {
  projectRoot: string;
  workDir: string;
  filename?: string;
}

export interface AgentsInstructionBlock {
  block?: string;
  sources: string[];
}

function trimTrailingSlashes(path: string): string {
  if (/^[\\/]+$/.test(path)) {
    return path.startsWith("\\") ? "\\" : "/";
  }
  return path.replace(/[\\/]+$/, "");
}

function resolveInstructionDirs(input: ResolveAgentsInstructionBlockInput): string[] {
  const projectRoot = trimTrailingSlashes(resolve(input.projectRoot || process.cwd()));
  const workDir = trimTrailingSlashes(resolve(input.workDir || projectRoot));
  const relativeWorkDir = relative(projectRoot, workDir);
  if (
    relativeWorkDir.startsWith("..")
    || isAbsolute(relativeWorkDir)
  ) {
    return [projectRoot];
  }
  if (!relativeWorkDir) {
    return [projectRoot];
  }
  const dirs = [projectRoot];
  let current = projectRoot;
  for (const part of relativeWorkDir.split(/[\\/]+/)) {
    if (!part || part === ".") {
      continue;
    }
    current = resolve(current, part);
    dirs.push(current);
  }
  return dirs;
}

function readNonEmptyText(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const content = readFileSync(path, "utf8").trim();
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

export function resolveAgentsInstructionBlock(
  input: ResolveAgentsInstructionBlockInput,
): AgentsInstructionBlock {
  const filename = input.filename?.trim() || DEFAULT_AGENTS_FILENAME;
  const sections: string[] = [];
  const sources: string[] = [];
  for (const dir of resolveInstructionDirs(input)) {
    const source = resolve(dir, filename);
    const content = readNonEmptyText(source);
    if (!content) {
      continue;
    }
    sources.push(source);
    sections.push([
      `# ${filename} instructions for ${dir}`,
      "<INSTRUCTIONS>",
      content,
      "</INSTRUCTIONS>",
    ].join("\n"));
  }
  return {
    block: sections.length > 0 ? sections.join(AGENTS_INSTRUCTION_SEPARATOR) : undefined,
    sources,
  };
}
