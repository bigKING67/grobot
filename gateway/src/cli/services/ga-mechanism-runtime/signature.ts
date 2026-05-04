import { cleanText } from "./utils";

const SIGNATURE_STOPWORDS = new Set([
  "please",
  "using",
  "with",
  "from",
  "this",
  "that",
  "would",
  "should",
  "could",
  "into",
  "about",
  "agent",
  "grobot",
  "browser",
  "tool",
  "tools",
  "mcp",
  "继续",
  "一下",
  "这个",
  "那个",
  "然后",
  "需要",
  "帮我",
]);

export function collectDomainHints(raw: string): string[] {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return [];
  }
  const result: string[] = [];
  const pushUnique = (candidate: string): void => {
    const normalized = candidate.replace(/^www\./, "").trim();
    if (!normalized) {
      return;
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  };
  const urlHostPattern = /https?:\/\/([^/\s?#]+)/gi;
  let urlMatch = urlHostPattern.exec(text);
  while (urlMatch) {
    pushUnique(urlMatch[1] ?? "");
    urlMatch = urlHostPattern.exec(text);
  }
  const domainPattern = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi;
  let domainMatch = domainPattern.exec(text);
  while (domainMatch) {
    pushUnique(domainMatch[1] ?? "");
    domainMatch = domainPattern.exec(text);
  }
  return result.slice(0, 3);
}

export function detectIntentTags(raw: string): string[] {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return [];
  }
  const tags: string[] = [];
  const push = (value: string): void => {
    if (!tags.includes(value)) {
      tags.push(value);
    }
  };
  if (/(登录|登入|login|sign[ -]?in|账号|密码)/i.test(text)) {
    push("auth_login");
  }
  if (/(提取|抓取|抽取|scan|extract|parse|crawl|文档)/i.test(text)) {
    push("extract_info");
  }
  if (/(点击|click|勾选|checkbox|同意|submit|提交)/i.test(text)) {
    push("ui_action");
  }
  if (/(对比|compare|diff|分析|analysis|复盘|review)/i.test(text)) {
    push("analyze");
  }
  if (tags.length === 0) {
    push("generic");
  }
  return tags.slice(0, 3);
}

function collectSignatureKeywords(raw: string): string[] {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return [];
  }
  const keywords: string[] = [];
  const push = (value: string): void => {
    if (!value || SIGNATURE_STOPWORDS.has(value)) {
      return;
    }
    if (!keywords.includes(value)) {
      keywords.push(value);
    }
  };
  const latinTokens = text.match(/[a-z0-9_]{3,}/g) ?? [];
  for (const token of latinTokens) {
    push(token);
  }
  const hanTokens = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const token of hanTokens) {
    push(token);
  }
  return keywords.slice(0, 4);
}

export function normalizeTaskSignature(userText: string): string {
  const lowered = cleanText(userText).toLowerCase();
  if (!lowered) {
    return "";
  }
  const domains = collectDomainHints(lowered);
  const intents = detectIntentTags(lowered);
  const topics = collectSignatureKeywords(lowered);
  const parts: string[] = [];
  if (domains.length > 0) {
    parts.push(`domain:${domains[0]}`);
  }
  if (intents.length > 0) {
    parts.push(`intent:${intents.join("+")}`);
  }
  if (topics.length > 0) {
    parts.push(`topic:${topics.join("+")}`);
  }
  const composite = parts.join(" | ");
  if (composite.length > 0) {
    return composite.slice(0, 120);
  }
  if (lowered.length <= 120) {
    return lowered;
  }
  return lowered.slice(0, 120);
}

export function hasAmbiguousIntentSignal(raw: string): boolean {
  const text = cleanText(raw).toLowerCase();
  if (!text) {
    return false;
  }
  if (text.length <= 4) {
    return true;
  }
  if (/^(继续|继续打磨|继续优化|还是这个|同上)$/.test(text)) {
    return true;
  }
  const pronounHeavy = /(这个|那个|这里|那里|它|这样|那样|上面|之前|刚才)/.test(text);
  const lacksConcreteTarget = !(/[/\\]/.test(text) || /[a-z0-9_-]{3,}\.[a-z0-9]{1,6}/i.test(text));
  if (pronounHeavy && lacksConcreteTarget) {
    return true;
  }
  return /(怎么做|咋办|怎么办|如何处理)\??$/.test(text);
}
