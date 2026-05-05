import {
  resolveStartupResumeTarget,
  type StartupResumeSessionSummary,
} from "../../cli/start/startup/session-resume";
import {
  resolveResumeRequested,
  resolveResumeSelector,
} from "../../cli/start/session/options";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const SESSION_FIXTURE: readonly StartupResumeSessionSummary[] = [
  {
    id: "main",
    sessionKey: "tenant__main",
    title: "Main Session",
    summary: "active workspace",
    updatedAt: "2026-04-24T10:00:00.000Z",
    active: true,
  },
  {
    id: "session-legacy",
    sessionKey: "tenant__legacy",
    title: "Legacy Session",
    summary: "historical context",
    updatedAt: "2026-04-24T09:59:00.000Z",
    active: false,
  },
  {
    id: "session-archive",
    sessionKey: "tenant__archive",
    title: "Archive Session",
    summary: "older context",
    updatedAt: "2026-04-23T20:00:00.000Z",
    active: false,
  },
];

function check(label: string, condition: boolean): [string, boolean] {
  return [label, condition];
}

function assertAll(checks: ReadonlyArray<[string, boolean]>): void {
  const failed = checks.filter(([, passed]) => !passed);
  const payload = Object.fromEntries(checks);
  console.log(JSON.stringify(payload));
  if (failed.length > 0) {
    const labels = failed.map(([label]) => label).join(", ");
    throw new Error(`session-resume-startup-contract failed: ${labels}`);
  }
}

function run(): void {
  const noIntent = resolveStartupResumeTarget({
    resumeRequested: false,
    resumeLastRequested: false,
    resumeAllRequested: false,
    sessions: SESSION_FIXTURE,
  });
  const resumeDefault = resolveStartupResumeTarget({
    resumeRequested: true,
    resumeLastRequested: false,
    resumeAllRequested: false,
    sessions: SESSION_FIXTURE,
  });
  const resumeLast = resolveStartupResumeTarget({
    resumeRequested: false,
    resumeLastRequested: true,
    resumeAllRequested: false,
    sessions: SESSION_FIXTURE,
  });
  const resumeExactId = resolveStartupResumeTarget({
    resumeRequested: true,
    resumeLastRequested: false,
    resumeAllRequested: false,
    resumeQuery: "session-archive",
    sessions: SESSION_FIXTURE,
  });
  const resumeSingleMatch = resolveStartupResumeTarget({
    resumeRequested: true,
    resumeLastRequested: false,
    resumeAllRequested: false,
    resumeQuery: "legacy",
    sessions: SESSION_FIXTURE,
  });
  const resumeMultipleMatches = resolveStartupResumeTarget({
    resumeRequested: true,
    resumeLastRequested: false,
    resumeAllRequested: false,
    resumeQuery: "session",
    sessions: [
      ...SESSION_FIXTURE,
      {
        id: "session-blueprint",
        sessionKey: "tenant__blueprint",
        title: "Session Blueprint",
        summary: "parallel branch",
        updatedAt: "2026-04-24T09:58:00.000Z",
        active: false,
      },
    ],
  });
  const resumeNoMatchFallback = resolveStartupResumeTarget({
    resumeRequested: true,
    resumeLastRequested: false,
    resumeAllRequested: false,
    resumeQuery: "missing-query",
    sessions: SESSION_FIXTURE,
  });
  const resumeNoMatchNoFallback = resolveStartupResumeTarget({
    resumeRequested: true,
    resumeLastRequested: false,
    resumeAllRequested: false,
    resumeQuery: "missing-query",
    sessions: [
      {
        id: "main",
        sessionKey: "tenant__main",
        title: "Main Session",
        summary: "active workspace",
        updatedAt: "2026-04-24T10:00:00.000Z",
        active: true,
      },
    ],
  });
  const resumeAllIncludesActiveByTitle = resolveStartupResumeTarget({
    resumeRequested: true,
    resumeLastRequested: false,
    resumeAllRequested: true,
    resumeQuery: "main session",
    sessions: SESSION_FIXTURE,
  });
  const resumeAllFlagOnly = resolveStartupResumeTarget({
    resumeRequested: false,
    resumeLastRequested: false,
    resumeAllRequested: true,
    sessions: SESSION_FIXTURE,
  });
  const resumeRequestedWithFalseLiteral = resolveResumeRequested({
    resume: "false",
  });
  const resumeSelectorWithFalseLiteral = resolveResumeSelector({
    resume: "false",
  });
  const startupResumeNoticeText = [
    resumeMultipleMatches.notice ?? "",
    resumeNoMatchFallback.notice ?? "",
    resumeNoMatchNoFallback.notice ?? "",
  ].join("\n");
  const startupResumeNoticePlain = stripAnsi(startupResumeNoticeText);

  assertAll([
    check("no_intent_skips_resume_target", typeof noIntent.targetSessionId === "undefined"),
    check("no_intent_skips_notice", typeof noIntent.notice === "undefined"),
    check("resume_default_targets_latest_non_active", resumeDefault.targetSessionId === "session-legacy"),
    check("resume_last_targets_latest_non_active", resumeLast.targetSessionId === "session-legacy"),
    check("resume_exact_id_targeted", resumeExactId.targetSessionId === "session-archive"),
    check("resume_single_query_match_targeted", resumeSingleMatch.targetSessionId === "session-legacy"),
    check("resume_multiple_query_auto_selects_top", resumeMultipleMatches.targetSessionId === "session-legacy"),
    check("resume_multiple_query_requires_disambiguation", resumeMultipleMatches.requiresDisambiguation === true),
    check(
      "resume_multiple_query_candidates_exposed",
      (resumeMultipleMatches.disambiguationCandidates ?? []).length === 3,
    ),
    check(
      "resume_multiple_query_notice_contains_tip",
      (resumeMultipleMatches.notice ?? "").includes("Hint: use --resume <session-id> to choose a target."),
    ),
    check(
      "resume_multiple_query_notice_surface_is_human",
      startupResumeNoticePlain.includes("Multiple resumable sessions found")
      && startupResumeNoticePlain.includes("• query session")
      && startupResumeNoticePlain.includes("  ⎿  3 sessions matched")
      && !startupResumeNoticePlain.includes("query:")
      && !startupResumeNoticePlain.includes("sessions matched:"),
    ),
    check(
      "resume_multiple_query_notice_uses_reference_detail_rows",
      startupResumeNoticePlain.includes("  ⎿  session-legacy")
      && startupResumeNoticePlain.includes("  ⎿  2026-04-24T09:59:00.000Z · title Legacy Session")
      && startupResumeNoticePlain.includes("  ⎿  summary historical context")
      && !startupResumeNoticePlain.includes(" | "),
    ),
    check("resume_startup_notices_avoid_legacy_title_bullet", !startupResumeNoticePlain.includes("●")),
    check(
      "resume_multiple_query_notice_no_autoselect_literal",
      !(resumeMultipleMatches.notice ?? "").includes("auto-selecting"),
    ),
    check(
      "resume_no_match_fallback_targets_latest_non_active",
      resumeNoMatchFallback.targetSessionId === "session-legacy",
    ),
    check(
      "resume_no_match_fallback_has_notice",
      (resumeNoMatchFallback.notice ?? "").includes("Fell back to latest resumable session"),
    ),
    check(
      "resume_no_match_without_fallback_has_notice",
      (resumeNoMatchNoFallback.notice ?? "").includes("No resumable sessions."),
    ),
    check(
      "resume_startup_notices_avoid_legacy_marker",
      !startupResumeNoticeText.includes("[session]"),
    ),
    check(
      "resume_all_can_match_active_title",
      resumeAllIncludesActiveByTitle.targetSessionId === "main",
    ),
    check("resume_all_flag_only_is_resume_intent", resumeAllFlagOnly.targetSessionId === "session-legacy"),
    check("resume_requested_accepts_false_literal_as_query", resumeRequestedWithFalseLiteral === true),
    check("resume_selector_keeps_false_literal", resumeSelectorWithFalseLiteral === "false"),
  ]);
}

run();
