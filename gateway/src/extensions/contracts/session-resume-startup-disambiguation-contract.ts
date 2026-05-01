import { resolveStartupResumeDisambiguation } from "../../orchestration/entrypoints/dev-cli/start/session-resume-startup-disambiguation";

const CANDIDATES = [
  {
    id: "session-legacy",
    sessionKey: "tenant__legacy",
    title: "Legacy Session",
    summary: "legacy context",
    updatedAt: "2026-04-24T09:59:00.000Z",
    active: false,
  },
  {
    id: "session-archive",
    sessionKey: "tenant__archive",
    title: "Archive Session",
    summary: "archive context",
    updatedAt: "2026-04-23T20:00:00.000Z",
    active: false,
  },
] as const;

function check(label: string, condition: boolean): [string, boolean] {
  return [label, condition];
}

function assertAll(checks: ReadonlyArray<[string, boolean]>): void {
  const failed = checks.filter(([, passed]) => !passed);
  const payload = Object.fromEntries(checks);
  console.log(JSON.stringify(payload));
  if (failed.length > 0) {
    const labels = failed.map(([label]) => label).join(", ");
    throw new Error(`session-resume-startup-disambiguation-contract failed: ${labels}`);
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

async function run(): Promise<void> {
  let nonTtyPickerCallCount = 0;
  const ttyPicked = await resolveStartupResumeDisambiguation({
    stdinIsTTY: true,
    resumeTarget: {
      targetSessionId: "session-legacy",
      requiresDisambiguation: true,
      disambiguationCandidates: CANDIDATES,
    },
    pickSession: async () => ({
      kind: "session",
      sessionId: "session-archive",
    }),
  });
  const ttyCancelled = await resolveStartupResumeDisambiguation({
    stdinIsTTY: true,
    resumeTarget: {
      targetSessionId: "session-legacy",
      requiresDisambiguation: true,
      disambiguationCandidates: CANDIDATES,
    },
    pickSession: async () => ({
      kind: "cancelled",
    }),
  });
  const nonTtyAuto = await resolveStartupResumeDisambiguation({
    stdinIsTTY: false,
    resumeTarget: {
      targetSessionId: "session-legacy",
      requiresDisambiguation: true,
      disambiguationCandidates: CANDIDATES,
    },
    pickSession: async () => {
      nonTtyPickerCallCount += 1;
      return {
        kind: "session",
        sessionId: "session-archive",
      };
    },
  });
  const noDisambiguation = await resolveStartupResumeDisambiguation({
    stdinIsTTY: true,
    resumeTarget: {
      targetSessionId: "session-legacy",
      requiresDisambiguation: false,
    },
  });
  const nonTtyAutoText = nonTtyAuto.messages.join("");
  const nonTtyAutoPlain = stripAnsi(nonTtyAutoText);

  assertAll([
    check("tty_disambiguation_picks_explicit_session", ttyPicked.targetSessionId === "session-archive"),
    check("tty_disambiguation_pick_has_no_messages", ttyPicked.messages.length === 0),
    check("tty_disambiguation_cancel_clears_target", typeof ttyCancelled.targetSessionId === "undefined"),
    check(
      "tty_disambiguation_cancel_is_silent",
      ttyCancelled.messages.length === 0,
    ),
    check("non_tty_does_not_call_picker", nonTtyPickerCallCount === 0),
    check("non_tty_keeps_auto_selected_target", nonTtyAuto.targetSessionId === "session-legacy"),
    check(
      "non_tty_reports_auto_selected_notice",
      nonTtyAutoPlain.includes("已自动选择启动会话")
      && nonTtyAutoPlain.includes("会话: session-legacy"),
    ),
    check("non_tty_notice_avoids_legacy_marker", !nonTtyAutoText.includes("[session]")),
    check("no_disambiguation_keeps_target", noDisambiguation.targetSessionId === "session-legacy"),
    check("no_disambiguation_has_no_messages", noDisambiguation.messages.length === 0),
  ]);
}

void run();
