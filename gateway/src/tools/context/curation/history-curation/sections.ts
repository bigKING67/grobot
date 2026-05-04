interface SnapshotSections {
  architecture: string[];
  dependencyGraph: string[];
  symbolGraph: string[];
  workspace: string[];
  lineage: string[];
  modifiedFiles: string[];
  verification: string[];
  todos: string[];
  toolOutputs: string[];
}

export function createEmptySections(): SnapshotSections {
  return {
    architecture: [],
    dependencyGraph: [],
    symbolGraph: [],
    workspace: [],
    lineage: [],
    modifiedFiles: [],
    verification: [],
    todos: [],
    toolOutputs: [],
  };
}

export function looksLikeCodeIntent(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return false;
  }
  if (/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/.test(normalized)) {
    return true;
  }
  if (/```|`[^`]+`/.test(normalized)) {
    return true;
  }
  if (/[{}()[\];<>=>]/.test(normalized)) {
    return true;
  }
  const lowered = normalized.toLowerCase();
  const keywords = [
    "code",
    "coding",
    "source",
    "repo",
    "project",
    "module",
    "function",
    "class",
    "symbol",
    "dependency",
    "import",
    "compile",
    "build",
    "lint",
    "test",
    "debug",
    "error",
    "fix",
    "refactor",
    "pull request",
    "commit",
    "branch",
    "context engine",
    "context",
    "源码",
    "代码",
    "仓库",
    "工程",
    "函数",
    "类",
    "文件",
    "路径",
    "依赖",
    "符号",
    "报错",
    "修复",
    "重构",
    "测试",
    "编译",
    "压缩",
    "上下文",
  ];
  return keywords.some((keyword) => lowered.includes(keyword));
}

export function classifyRow(content: string, sections: SnapshotSections): void {
  const lowered = content.toLowerCase();
  if (lowered.includes("architecture")) {
    sections.architecture.push(content);
    return;
  }
  if (
    lowered.includes("modified files") ||
    lowered.includes("changed files") ||
    lowered.includes("file:")
  ) {
    sections.modifiedFiles.push(content);
    return;
  }
  if (
    lowered.includes("verification") ||
    lowered.includes("test") ||
    lowered.includes("pass") ||
    lowered.includes("fail")
  ) {
    sections.verification.push(content);
    return;
  }
  if (lowered.includes("todo") || lowered.includes("rollback")) {
    sections.todos.push(content);
    return;
  }
  if (lowered.includes("error") || lowered.includes("warning") || lowered.includes("timeout")) {
    sections.toolOutputs.push(content);
  }
}

function truncateLine(raw: string, maxChars: number): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function pushSection(
  lines: string[],
  title: string,
  items: readonly string[],
  cap: number,
  itemMaxChars: number,
): void {
  lines.push(`[${title}]`);
  if (items.length === 0) {
    lines.push("- (none)");
    return;
  }
  const seen = new Set<string>();
  const deduplicated: string[] = [];
  for (const item of items) {
    const normalized = truncateLine(item, itemMaxChars);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduplicated.push(normalized);
    if (deduplicated.length >= cap) {
      break;
    }
  }
  if (deduplicated.length === 0) {
    lines.push("- (none)");
    return;
  }
  for (const item of deduplicated) {
    lines.push(`- ${item}`);
  }
}
