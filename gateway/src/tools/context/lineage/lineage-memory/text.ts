import type { LineageIntentTag } from "./types";

export function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export function normalizeText(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/:(\d+)(?::\d+)?$/, "")
    .toLowerCase();
}

export function extractPathHints(raw: string): string[] {
  const matches = raw.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g) ?? [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of matches) {
    const normalized = normalizePath(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 10) {
      break;
    }
  }
  return output;
}

export function isPathOverlap(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function inferIntentTags(raw: string): Set<LineageIntentTag> {
  const text = normalizeText(raw);
  const tags = new Set<LineageIntentTag>();
  const add = (tag: LineageIntentTag): void => {
    tags.add(tag);
  };
  if (
    /(^|\s)(feat|feature|add|introduce|implement|support)(\(|:|\s)/.test(text)
    || /(新增|实现|支持|功能)/.test(text)
  ) {
    add("feature");
  }
  if (
    /(^|\s)(fix|bug|hotfix|repair|resolve|patch)(\(|:|\s)/.test(text)
    || /(修复|修正|补丁|故障)/.test(text)
  ) {
    add("fix");
  }
  if (
    /(^|\s)(refactor|cleanup|rename|restructure|reorg)(\(|:|\s)/.test(text)
    || /(重构|整理|重命名)/.test(text)
  ) {
    add("refactor");
  }
  if (
    /(^|\s)(test|spec|contract|e2e|unit)(\(|:|\s)/.test(text)
    || /(测试|回归|验收)/.test(text)
  ) {
    add("test");
  }
  if (
    /(^|\s)(perf|optimi[sz]e|latency|throughput|cache)(\(|:|\s)/.test(text)
    || /(性能|优化|延迟|吞吐|缓存)/.test(text)
  ) {
    add("perf");
  }
  if (
    /(^|\s)(docs|readme|comment|guide|manual)(\(|:|\s)/.test(text)
    || /(文档|说明|注释)/.test(text)
  ) {
    add("docs");
  }
  if (
    /(^|\s)(chore|infra|build|tooling)(\(|:|\s)/.test(text)
    || /(工程|脚本|工具链)/.test(text)
  ) {
    add("chore");
  }
  if (
    /(^|\s)(security|auth|permission|rbac|abac|vuln|cve)(\(|:|\s)/.test(text)
    || /(安全|权限|鉴权|漏洞|风控)/.test(text)
  ) {
    add("security");
  }
  if (
    /(^|\s)(deps?|dependency|upgrade|bump)(\(|:|\s)/.test(text)
    || /(依赖|升级|版本)/.test(text)
  ) {
    add("deps");
  }
  if (
    /(^|\s)(ci|pipeline|workflow|action)(\(|:|\s)/.test(text)
    || /(流水线|发布流程|工作流)/.test(text)
  ) {
    add("ci");
  }
  return tags;
}

export function resolveRepoLabel(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  const label = (slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized).trim();
  if (!label) {
    return "repo";
  }
  return label;
}

export function resolveParentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

export function truncateSummary(text: string, maxLength = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}
