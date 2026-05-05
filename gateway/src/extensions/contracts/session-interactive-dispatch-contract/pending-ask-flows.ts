import { includesEvent, runDispatchCase, stripAnsi } from "./helpers";

export async function runPendingAskDispatchFlows() {
  const pendingAskBlockedStatus = await runDispatchCase("/status", { pendingAskCount: 2 });
  const pendingAskAllowHelp = await runDispatchCase("/help", { pendingAskCount: 2 });
  const pendingAskAllowInterrupt = await runDispatchCase("/interrupt", { pendingAskCount: 2 });
  const pendingAskAllowSessions = await runDispatchCase("/sessions", { pendingAskCount: 2 });
  const pendingAskAllowResume = await runDispatchCase("/resume", { pendingAskCount: 2 });
  const pendingAskAllowRewind = await runDispatchCase("/rewind", { pendingAskCount: 2 });
  const pendingAskAllowAsk = await runDispatchCase("/ask", { pendingAskCount: 2 });
  const pendingAskAllowAskInvalidArgs = await runDispatchCase("/ask status", { pendingAskCount: 2 });
  const pendingAskPlainAnswer = await runDispatchCase("继续执行快速方案", { pendingAskCount: 2 });
  const pendingAskEmptyOpensSelector = await runDispatchCase("", { pendingAskCount: 2 });
  const pendingAskQuestionMarkOpensSelector = await runDispatchCase("?", { pendingAskCount: 2 });
  const pendingAskBlockedBurstFirst = await runDispatchCase("/model", {
    pendingAskCount: 3,
    nowMs: 1_000_000,
  });
  const pendingAskBlockedBurstSecond = await runDispatchCase("/status", {
    pendingAskCount: 3,
    nowMs: 1_000_500,
  });
  const pendingAskBlockedBurstThird = await runDispatchCase("/health", {
    pendingAskCount: 3,
    nowMs: 1_003_000,
  });

  return {
    pending_ask_blocked_status_warned: includesEvent(pendingAskBlockedStatus.events, "writeStdout"),
    pending_ask_blocked_status_opened_menu: includesEvent(
      pendingAskBlockedStatus.events,
      "openStatusMenu",
    ),
    pending_ask_blocked_status_hint_has_reply_guidance:
      pendingAskBlockedStatus.stdout.includes("Reply first before running other commands."),
    pending_ask_blocked_status_hint_has_prompt_summary:
      pendingAskBlockedStatus.stdout.includes("Enter open picker")
      && !pendingAskBlockedStatus.stdout.includes("question="),
    pending_ask_blocked_status_hint_has_short_menu_hint:
      pendingAskBlockedStatus.stdout.includes("Enter open picker"),
    pending_ask_help_allowed: includesEvent(pendingAskAllowHelp.events, "showHelp"),
    pending_ask_help_blocked_warned: includesEvent(pendingAskAllowHelp.events, "writeStdout"),
    pending_ask_interrupt_allowed: includesEvent(
      pendingAskAllowInterrupt.events,
      "requestRuntimeInterrupt",
    ),
    pending_ask_sessions_allowed: includesEvent(
      pendingAskAllowSessions.events,
      "openSessionMenu:sessions",
    ),
    pending_ask_resume_allowed: includesEvent(
      pendingAskAllowResume.events,
      "openSessionMenu:resume",
    ),
    pending_ask_rewind_allowed: includesEvent(
      pendingAskAllowRewind.events,
      "openSessionMenu:rewind",
    ),
    pending_ask_ask_allowed:
      stripAnsi(pendingAskAllowAsk.stdout).includes("Unknown command")
      && !stripAnsi(pendingAskAllowAsk.stdout).includes("● Unknown command"),
    pending_ask_ask_invalid_args_warned: includesEvent(
      pendingAskAllowAskInvalidArgs.events,
      "writeStdout",
    ),
    pending_ask_ask_invalid_args_dispatched:
      stripAnsi(pendingAskAllowAskInvalidArgs.stdout).includes("Unknown command")
      && !stripAnsi(pendingAskAllowAskInvalidArgs.stdout).includes("● Unknown command"),
    pending_ask_plain_text_runs_turn: includesEvent(
      pendingAskPlainAnswer.events,
      "runTurn:继续执行快速方案",
    ),
    pending_ask_plain_text_blocked_warned: includesEvent(
      pendingAskPlainAnswer.events,
      "writeStdout",
    ),
    pending_ask_empty_opens_selector: includesEvent(
      pendingAskEmptyOpensSelector.events,
      "selectPendingAskAnswer",
    ),
    pending_ask_empty_selection_runs_turn: includesEvent(
      pendingAskEmptyOpensSelector.events,
      "runTurn:core",
    ),
    pending_ask_question_mark_opens_selector: includesEvent(
      pendingAskQuestionMarkOpensSelector.events,
      "selectPendingAskAnswer",
    ),
    pending_ask_question_mark_selection_runs_turn: includesEvent(
      pendingAskQuestionMarkOpensSelector.events,
      "runTurn:core",
    ),
    pending_ask_burst_first_warned: includesEvent(
      pendingAskBlockedBurstFirst.events,
      "writeStdout",
    ),
    pending_ask_burst_second_suppressed: !includesEvent(
      pendingAskBlockedBurstSecond.events,
      "writeStdout",
    ),
    pending_ask_burst_third_warned: includesEvent(
      pendingAskBlockedBurstThird.events,
      "writeStdout",
    ),
    pending_ask_burst_third_mentions_suppressed_count:
      pendingAskBlockedBurstThird.stdout.includes("1 duplicate notices collapsed."),
  };
}
