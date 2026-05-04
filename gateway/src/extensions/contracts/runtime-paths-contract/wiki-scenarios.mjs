import { resolve } from "node:path";
import { isObject } from "./cli-args.mjs";
import { pathJoin, writeJson, writeText } from "./fs-helpers.mjs";

export function resolveWikiConfig(payload) {
  const wikiRaw = isObject(payload.wiki) ? payload.wiki : {};
  const retrieval = isObject(wikiRaw.retrieval) ? wikiRaw.retrieval : {};
  const lint = isObject(wikiRaw.lint) ? wikiRaw.lint : {};
  const review = isObject(wikiRaw.review) ? wikiRaw.review : {};
  return {
    enabled: Boolean(wikiRaw.enabled),
    allow_org_shared_read: Boolean(wikiRaw.allow_org_shared_read),
    default_scope: String(wikiRaw.default_scope ?? "auto"),
    write_mode: String(review.write_mode ?? wikiRaw.write_mode ?? "review_first"),
    retrieval_max_files: Number(retrieval.max_files ?? 200),
    retrieval_max_chars: Number(retrieval.max_chars ?? 2e3),
    retrieval_max_items: Number(retrieval.max_items ?? 6),
    lint_stale_days: Number(lint.stale_days ?? 30),
    lint_max_files: Number(lint.max_files ?? 500)
  };
}

export function wikiIngestReviewApplyScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_1");
  const userRoot = pathJoin(projectRoot, ".grobot", "wiki", "users", sessionUser);
  const pagesDir = pathJoin(userRoot, "pages");
  const pagePath = pathJoin(pagesDir, "payment-rollback-spec.md");
  const proposalId = "wp0001";
  writeText(
    pagePath,
    "# \u652F\u4ED8\u56DE\u6EDA\u89C4\u8303\n\n\u652F\u4ED8\u56DE\u6EDA\u6D41\u7A0B\uFF1A\u5148\u9501\u5355\uFF0C\u518D\u8865\u507F\u3002\n\n\u63A5\u53E3\u5951\u7EA6\uFF1Astatus=paid/unpaid\u3002\n"
  );
  writeText(pathJoin(userRoot, "index.md"), "- [\u652F\u4ED8\u56DE\u6EDA\u89C4\u8303](pages/payment-rollback-spec.md)\n");
  writeText(pathJoin(userRoot, "log.md"), "## [2026-01-01] ingest | \u652F\u4ED8\u56DE\u6EDA\u89C4\u8303\n");
  return {
    ingest_code: 0,
    ingest_lines: [`wiki ingest proposal created: ${proposalId}`],
    proposal_id: proposalId,
    list_code: 0,
    list_lines: [`${proposalId} pending`],
    apply_code: 0,
    apply_lines: ["wiki review applied"],
    user_root: userRoot,
    page_paths: [pagePath]
  };
}

export function wikiLintScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const reportPath = pathJoin(projectRoot, ".grobot", "wiki", "users", "open_user_lint", "reports", "lint-report.json");
  writeJson(reportPath, {
    broken_links: [{ source: "a.md", target: "b.md" }],
    orphan_pages: ["orphan.md"]
  });
  return {
    lint_code: 0,
    lint_lines: [`report=${reportPath}`],
    report_path: reportPath
  };
}
