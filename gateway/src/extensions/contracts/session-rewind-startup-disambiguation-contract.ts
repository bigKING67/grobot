import { resolveStartupRewindDisambiguation } from "../../orchestration/entrypoints/dev-cli/start/session-rewind-startup-disambiguation";

const CANDIDATES = [
  {
    checkpointId: "legacy-a",
    createdAt: "2026-04-24T09:50:00.000Z",
    userText: "legacy alpha",
    assistantText: "assistant alpha",
    historyBeforeCount: 8,
    historyAfterCount: 10,
    changedFilesCount: 1,
  },
  {
    checkpointId: "legacy-b",
    createdAt: "2026-04-24T09:40:00.000Z",
    userText: "legacy beta",
    assistantText: "assistant beta",
    historyBeforeCount: 6,
    historyAfterCount: 8,
    changedFilesCount: 2,
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
    throw new Error(`session-rewind-startup-disambiguation-contract failed: ${labels}`);
  }
}

async function run(): Promise<void> {
  let nonTtyPickerCallCount = 0;
  const ttyPicked = await resolveStartupRewindDisambiguation({
    stdinIsTTY: true,
    rewindTarget: {
      targetCheckpointId: "legacy-a",
      requiresDisambiguation: true,
      disambiguationCandidates: CANDIDATES,
    },
    pickCheckpoint: async () => ({
      kind: "checkpoint",
      checkpointId: "legacy-b",
    }),
  });
  const ttyCancelled = await resolveStartupRewindDisambiguation({
    stdinIsTTY: true,
    rewindTarget: {
      targetCheckpointId: "legacy-a",
      requiresDisambiguation: true,
      disambiguationCandidates: CANDIDATES,
    },
    pickCheckpoint: async () => ({
      kind: "cancelled",
    }),
  });
  const nonTtyAuto = await resolveStartupRewindDisambiguation({
    stdinIsTTY: false,
    rewindTarget: {
      targetCheckpointId: "legacy-a",
      requiresDisambiguation: true,
      disambiguationCandidates: CANDIDATES,
    },
    pickCheckpoint: async () => {
      nonTtyPickerCallCount += 1;
      return {
        kind: "checkpoint",
        checkpointId: "legacy-b",
      };
    },
  });
  const noDisambiguation = await resolveStartupRewindDisambiguation({
    stdinIsTTY: true,
    rewindTarget: {
      targetCheckpointId: "legacy-a",
      requiresDisambiguation: false,
    },
  });

  assertAll([
    check("tty_disambiguation_picks_explicit_checkpoint", ttyPicked.targetCheckpointId === "legacy-b"),
    check("tty_disambiguation_pick_has_no_messages", ttyPicked.messages.length === 0),
    check("tty_disambiguation_cancel_clears_target", typeof ttyCancelled.targetCheckpointId === "undefined"),
    check(
      "tty_disambiguation_cancel_has_notice",
      (ttyCancelled.messages.join("")).includes("startup rewind picker cancelled"),
    ),
    check("non_tty_does_not_call_picker", nonTtyPickerCallCount === 0),
    check("non_tty_keeps_auto_selected_target", nonTtyAuto.targetCheckpointId === "legacy-a"),
    check(
      "non_tty_reports_auto_selected_notice",
      (nonTtyAuto.messages.join("")).includes("non-tty startup auto-selected"),
    ),
    check("no_disambiguation_keeps_target", noDisambiguation.targetCheckpointId === "legacy-a"),
    check("no_disambiguation_has_no_messages", noDisambiguation.messages.length === 0),
  ]);
}

void run();
