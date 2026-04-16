import {
  ensureSearchableProject
} from "./chunk-BV4YBNBI.js";
import "./chunk-GYK2PYHT.js";
import "./chunk-WQHSYTJN.js";
import {
  retrieveCodeContext
} from "./chunk-EP7WNOXO.js";
import "./chunk-35HO3GPM.js";
import "./chunk-44FXLQ5V.js";
import "./chunk-CA4WQHZS.js";

// src/promptContext/detect.ts
function detectLanguage(text) {
  const matches = text.match(/[\u4e00-\u9fff]/g);
  const count = matches?.length ?? 0;
  return count >= 3 ? "zh" : "en";
}

// src/promptContext/technicalTerms.ts
var MAX_TERMS = 20;
var MIN_TERM_LEN = 3;
var MAX_TERM_LEN = 64;
function extractTechnicalTerms(prompt) {
  const terms = /* @__PURE__ */ new Set();
  for (const m of prompt.matchAll(/`([^`]+)`/g)) {
    const val = m[1].trim();
    if (val.length >= MIN_TERM_LEN && val.length <= MAX_TERM_LEN) {
      terms.add(val);
    }
  }
  for (const m of prompt.matchAll(
    /(?:^|\s)((?:[\w./-]+\/)?[\w-]+\.[a-zA-Z]\w{0,7})(?=[\s,;:.)}\]>]|$)/gm
  )) {
    const val = m[1];
    if (val.length >= MIN_TERM_LEN && val.length <= MAX_TERM_LEN) {
      terms.add(val);
    }
  }
  for (const m of prompt.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g)) {
    if (m[1].length >= MIN_TERM_LEN && m[1].length <= MAX_TERM_LEN) {
      terms.add(m[1]);
    }
  }
  for (const m of prompt.matchAll(/\b([a-z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g)) {
    if (m[1].length >= MIN_TERM_LEN && m[1].length <= MAX_TERM_LEN) {
      terms.add(m[1]);
    }
  }
  for (const m of prompt.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) {
    if (m[1].length >= MIN_TERM_LEN && m[1].length <= MAX_TERM_LEN) {
      terms.add(m[1]);
    }
  }
  return Array.from(terms).slice(0, MAX_TERMS);
}

// src/promptContext/index.ts
var PROMPT_CONTEXT_CONFIG_OVERRIDE = {
  maxTotalChars: 12e3,
  maxSegmentsPerFile: 2
};
async function buildPromptContext(options) {
  const language = detectLanguage(options.prompt);
  const technicalTerms = Array.from(
    /* @__PURE__ */ new Set([
      ...extractTechnicalTerms(options.prompt),
      ...options.explicitPaths || [],
      ...options.explicitSymbols || []
    ])
  );
  if (!options.repoPath) {
    return {
      prompt: options.prompt,
      language,
      technicalTerms,
      retrieval: {
        status: "skipped",
        topPaths: [],
        evidence: []
      }
    };
  }
  try {
    const retrieve = options.retrieve ?? ((input) => ensureSearchableProject(input.repoPath).then(
      () => retrieveCodeContext(input, {
        configOverride: PROMPT_CONTEXT_CONFIG_OVERRIDE
      })
    ));
    const result = await retrieve({
      repoPath: options.repoPath,
      informationRequest: options.prompt,
      technicalTerms
    });
    const evidence = result.files.flatMap(
      (file) => file.segments.map((segment) => ({
        path: file.path,
        startLine: segment.startLine,
        endLine: segment.endLine,
        score: segment.score,
        breadcrumb: segment.breadcrumb,
        text: segment.text
      }))
    );
    return {
      prompt: options.prompt,
      language,
      technicalTerms,
      retrieval: {
        status: "ok",
        topPaths: result.files.map((file) => file.path),
        evidence
      }
    };
  } catch (error) {
    return {
      prompt: options.prompt,
      language,
      technicalTerms,
      retrieval: {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        topPaths: [],
        evidence: []
      }
    };
  }
}
function renderPromptContext(result, format) {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}
`;
  }
  const lines = [
    `language: ${result.language}`,
    `technicalTerms: ${result.technicalTerms.join(", ") || "<none>"}`,
    `retrieval: ${result.retrieval.status}`
  ];
  if (result.retrieval.topPaths.length > 0) {
    lines.push(`topPaths: ${result.retrieval.topPaths.join(", ")}`);
  }
  if (result.retrieval.error) {
    lines.push(`error: ${result.retrieval.error}`);
  }
  return `${lines.join("\n")}
`;
}
export {
  buildPromptContext,
  renderPromptContext
};
//# sourceMappingURL=promptContext-XM36PCDP.js.map