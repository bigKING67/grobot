import { includesEvent, runDispatchCase, stripAnsi } from "./helpers";

export async function runRewindDispatchFlows() {
  const rewindPrefixMiss = await runDispatchCase("/rewinder");
  const rewindMenu = await runDispatchCase("/rewind");
  const checkpointMenu = await runDispatchCase("/checkpoint");
  const rewindQueryTty = await runDispatchCase("/rewind latest", { stdinIsTty: true });
  const rewindQueryNoActiveSessionTty = await runDispatchCase("/rewind latest", {
    stdinIsTty: true,
    activeSessionId: "",
  });
  const rewindQueryNoQuickPathTty = await runDispatchCase("/rewind latest", {
    stdinIsTty: true,
    disableRewindSession: true,
  });
  const rewindSearchMissingTty = await runDispatchCase("/rewind search missing", { stdinIsTty: true });
  const rewindQueryMultipleTty = await runDispatchCase("/rewind legacy", { stdinIsTty: true });
  const rewindQueryMultipleOverflowTty = await runDispatchCase("/rewind legacy", {
    stdinIsTty: true,
    rewindCheckpoints: [
      {
        checkpointId: "latest",
        createdAt: "2026-04-20T08:00:00.000Z",
        userText: "latest checkpoint",
        assistantText: "latest assistant",
        historyBeforeCount: 24,
        historyAfterCount: 26,
        changedFilesCount: 2,
      },
      {
        checkpointId: "legacy-a",
        createdAt: "2026-04-19T08:00:00.000Z",
        userText: "legacy checkpoint alpha",
        assistantText: "legacy assistant alpha",
        historyBeforeCount: 12,
        historyAfterCount: 14,
        changedFilesCount: 1,
      },
      {
        checkpointId: "legacy-b",
        createdAt: "2026-04-18T08:00:00.000Z",
        userText: "legacy checkpoint beta",
        assistantText: "legacy assistant beta",
        historyBeforeCount: 10,
        historyAfterCount: 11,
        changedFilesCount: 3,
      },
      {
        checkpointId: "legacy-c",
        createdAt: "2026-04-17T08:00:00.000Z",
        userText: "legacy checkpoint gamma",
        assistantText: "legacy assistant gamma",
        historyBeforeCount: 8,
        historyAfterCount: 9,
        changedFilesCount: 2,
      },
      {
        checkpointId: "legacy-d",
        createdAt: "2026-04-16T08:00:00.000Z",
        userText: "legacy checkpoint delta",
        assistantText: "legacy assistant delta",
        historyBeforeCount: 7,
        historyAfterCount: 8,
        changedFilesCount: 2,
      },
      {
        checkpointId: "legacy-e",
        createdAt: "2026-04-15T08:00:00.000Z",
        userText: "legacy checkpoint epsilon",
        assistantText: "legacy assistant epsilon",
        historyBeforeCount: 6,
        historyAfterCount: 7,
        changedFilesCount: 1,
      },
      {
        checkpointId: "legacy-f",
        createdAt: "2026-04-14T08:00:00.000Z",
        userText: "legacy checkpoint zeta",
        assistantText: "legacy assistant zeta",
        historyBeforeCount: 5,
        historyAfterCount: 6,
        changedFilesCount: 1,
      },
    ],
  });
  const rewindFindQueryModeTty = await runDispatchCase("/rewind find latest both", { stdinIsTty: true });
  const rewindSearchUserTextTty = await runDispatchCase("/rewind search alpha conversation", { stdinIsTty: true });
  const rewindSearchAssistantTextTty = await runDispatchCase("/rewind search beta code", { stdinIsTty: true });
  const rewindSearchUserTextCompactTty = await runDispatchCase("/rewind search legacycheckpointalpha", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdCompactTty = await runDispatchCase("/rewind search legacya", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdUnderscoreTty = await runDispatchCase("/rewind search legacy_a", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdSpaceTty = await runDispatchCase("/rewind search legacy a", {
    stdinIsTty: true,
  });
  const rewindSearchCheckpointIdQuotedTty = await runDispatchCase('/rewind search "legacy a"', {
    stdinIsTty: true,
  });
  const rewindSearchCreatedAtTty = await runDispatchCase("/rewind search 2026-04-20", { stdinIsTty: true });
  const rewindSearchCreatedAtDigitsTty = await runDispatchCase("/rewind search 20260420", { stdinIsTty: true });
  const rewindSearchCreatedAtDigitsContainsTty = await runDispatchCase("/rewind search 0420", { stdinIsTty: true });
  const rewindSearchSeparatorOnlyTty = await runDispatchCase("/rewind search ___", { stdinIsTty: true });
  const rewindFindModeKeywordQueryTty = await runDispatchCase("/rewind find code", { stdinIsTty: true });
  const rewindSummarizeTty = await runDispatchCase("/rewind summarize", { stdinIsTty: true });
  const rewindCodeModeTty = await runDispatchCase("/rewind latest code", { stdinIsTty: true });
  const checkpointQueryTty = await runDispatchCase("/checkpoint latest conversation", {
    stdinIsTty: true,
  });
  const checkpointSearchCreatedAtTty = await runDispatchCase("/checkpoint search 2026-04-20", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdCompactTty = await runDispatchCase("/checkpoint search legacya", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdUnderscoreTty = await runDispatchCase("/checkpoint search legacy_a", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdSpaceTty = await runDispatchCase("/checkpoint search legacy a", {
    stdinIsTty: true,
  });
  const checkpointSearchCheckpointIdQuotedTty = await runDispatchCase('/checkpoint search "legacy a"', {
    stdinIsTty: true,
  });
  const checkpointSearchCreatedAtDigitsTty = await runDispatchCase("/checkpoint search 20260420", {
    stdinIsTty: true,
  });
  const checkpointSearchCreatedAtDigitsContainsTty = await runDispatchCase("/checkpoint search 0420", {
    stdinIsTty: true,
  });
  const checkpointFindEmptyTty = await runDispatchCase("/checkpoint find", { stdinIsTty: true });
  const rewindFindEmptyTty = await runDispatchCase("/rewind find", { stdinIsTty: true });
  const rewindModeOnlyTty = await runDispatchCase("/rewind conversation", { stdinIsTty: true });
  const rewindWithArgs = await runDispatchCase("/rewind latest");
  const rewindWarningStdout = [
    rewindQueryNoActiveSessionTty.stdout,
    rewindQueryNoQuickPathTty.stdout,
    rewindSearchMissingTty.stdout,
    rewindQueryMultipleTty.stdout,
    rewindQueryMultipleOverflowTty.stdout,
    rewindSearchSeparatorOnlyTty.stdout,
    rewindFindModeKeywordQueryTty.stdout,
    rewindFindEmptyTty.stdout,
    rewindModeOnlyTty.stdout,
    rewindWithArgs.stdout,
  ].join("\n");

  return {
    rewind_prefix_miss_hits_run_turn: includesEvent(rewindPrefixMiss.events, "runTurn:/rewinder"),
    rewind_prefix_miss_opened_menu: includesEvent(rewindPrefixMiss.events, "openSessionMenu:rewind"),
    rewind_menu_opened: includesEvent(rewindMenu.events, "openSessionMenu:rewind"),
    checkpoint_menu_opened: includesEvent(checkpointMenu.events, "openSessionMenu:rewind"),
    rewind_query_tty_dispatched: includesEvent(rewindQueryTty.events, "rewindSession"),
    rewind_query_tty_exact_checkpoint: includesEvent(
      rewindQueryTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_query_tty_opened_menu: includesEvent(rewindQueryTty.events, "openSessionMenu:rewind"),
    rewind_query_no_active_session_tty_warned: includesEvent(
      rewindQueryNoActiveSessionTty.events,
      "writeStdout",
    ),
    rewind_query_no_active_session_tty_dispatched: includesEvent(
      rewindQueryNoActiveSessionTty.events,
      "rewindSession",
    ),
    rewind_query_no_active_session_tty_opened_menu: includesEvent(
      rewindQueryNoActiveSessionTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_query_no_active_session_surface_is_human:
      stripAnsi(rewindQueryNoActiveSessionTty.stdout).includes("当前会话不可用于回退")
      && stripAnsi(rewindQueryNoActiveSessionTty.stdout).includes("使用 /rewind 打开菜单。"),
    rewind_query_no_quick_path_tty_warned: includesEvent(
      rewindQueryNoQuickPathTty.events,
      "writeStdout",
    ),
    rewind_query_no_quick_path_tty_dispatched: includesEvent(
      rewindQueryNoQuickPathTty.events,
      "rewindSession",
    ),
    rewind_query_no_quick_path_tty_opened_menu: includesEvent(
      rewindQueryNoQuickPathTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_query_no_quick_path_surface_is_human:
      stripAnsi(rewindQueryNoQuickPathTty.stdout).includes("回退快速路径不可用")
      && stripAnsi(rewindQueryNoQuickPathTty.stdout).includes("使用 /rewind 打开菜单。"),
    rewind_search_missing_tty_warned: includesEvent(rewindSearchMissingTty.events, "writeStdout"),
    rewind_search_missing_tty_dispatched: includesEvent(
      rewindSearchMissingTty.events,
      "rewindSession",
    ),
    rewind_search_missing_tty_opened_menu: includesEvent(
      rewindSearchMissingTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_search_missing_tty_no_match_has_tip: rewindSearchMissingTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    rewind_search_missing_surface_is_human:
      stripAnsi(rewindSearchMissingTty.stdout).includes("没有匹配的检查点")
      && stripAnsi(rewindSearchMissingTty.stdout).includes("查询: missing"),
    rewind_query_multiple_tty_warned: includesEvent(rewindQueryMultipleTty.events, "writeStdout"),
    rewind_query_multiple_tty_dispatched: includesEvent(
      rewindQueryMultipleTty.events,
      "rewindSession",
    ),
    rewind_query_multiple_tty_includes_quick_pick: rewindQueryMultipleTty.stdout.includes(
      `${"/rewind"} legacy-a`,
    ),
    rewind_query_multiple_tty_includes_assistant_preview: rewindQueryMultipleTty.stdout.includes(
      "| 助手=",
    ),
    rewind_query_multiple_surface_is_human:
      stripAnsi(rewindQueryMultipleTty.stdout).includes("找到多个匹配的检查点")
      && stripAnsi(rewindQueryMultipleTty.stdout).includes("使用 /rewind 明确选择一个。"),
    rewind_query_multiple_overflow_tty_includes_overflow_line: rewindQueryMultipleOverflowTty.stdout.includes(
      "... 还有 1 项",
    ),
    rewind_query_multiple_overflow_tty_includes_quick_pick_header: rewindQueryMultipleOverflowTty.stdout.includes(
      "快速选择:",
    ),
    rewind_warning_surfaces_avoid_legacy_marker: !rewindWarningStdout.includes("[rewind]"),
    rewind_query_multiple_tty_opened_menu: includesEvent(
      rewindQueryMultipleTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_find_query_mode_tty_dispatched: includesEvent(
      rewindFindQueryModeTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_user_text_tty_dispatched: includesEvent(
      rewindSearchUserTextTty.events,
      "rewindSession:main:legacy-a:conversation:slash:rewind:query",
    ),
    rewind_search_assistant_text_tty_dispatched: includesEvent(
      rewindSearchAssistantTextTty.events,
      "rewindSession:main:legacy-b:code:slash:rewind:query",
    ),
    rewind_search_user_text_compact_tty_dispatched: includesEvent(
      rewindSearchUserTextCompactTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_compact_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdCompactTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_underscore_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdUnderscoreTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_space_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdSpaceTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_checkpoint_id_quoted_tty_dispatched: includesEvent(
      rewindSearchCheckpointIdQuotedTty.events,
      "rewindSession:main:legacy-a:both:slash:rewind:query",
    ),
    rewind_search_created_at_tty_dispatched: includesEvent(
      rewindSearchCreatedAtTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_created_at_digits_tty_dispatched: includesEvent(
      rewindSearchCreatedAtDigitsTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_created_at_digits_contains_tty_dispatched: includesEvent(
      rewindSearchCreatedAtDigitsContainsTty.events,
      "rewindSession:main:latest:both:slash:rewind:query",
    ),
    rewind_search_separator_only_tty_warned: includesEvent(
      rewindSearchSeparatorOnlyTty.events,
      "writeStdout",
    ),
    rewind_search_separator_only_tty_dispatched: includesEvent(
      rewindSearchSeparatorOnlyTty.events,
      "rewindSession",
    ),
    rewind_search_separator_only_tty_opened_menu: includesEvent(
      rewindSearchSeparatorOnlyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_search_separator_only_tty_no_match_message: rewindSearchSeparatorOnlyTty.stdout.includes(
      "没有匹配的检查点",
    ) && stripAnsi(rewindSearchSeparatorOnlyTty.stdout).includes("查询: ___"),
    rewind_search_separator_only_tty_no_match_has_tip: rewindSearchSeparatorOnlyTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    rewind_find_mode_keyword_query_warned: includesEvent(
      rewindFindModeKeywordQueryTty.events,
      "writeStdout",
    ),
    rewind_find_mode_keyword_query_dispatched: includesEvent(
      rewindFindModeKeywordQueryTty.events,
      "rewindSession",
    ),
    rewind_find_mode_keyword_query_no_match_message: rewindFindModeKeywordQueryTty.stdout.includes(
      "没有匹配的检查点",
    ) && stripAnsi(rewindFindModeKeywordQueryTty.stdout).includes("查询: code"),
    rewind_find_mode_keyword_query_no_match_has_tip: rewindFindModeKeywordQueryTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    rewind_find_mode_keyword_query_opened_menu: includesEvent(
      rewindFindModeKeywordQueryTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_summarize_tty_dispatched: includesEvent(
      rewindSummarizeTty.events,
      "rewindSession:main:<latest>:summarize:slash:rewind:summarize",
    ),
    rewind_code_mode_tty_dispatched: includesEvent(
      rewindCodeModeTty.events,
      "rewindSession:main:latest:code:slash:rewind:query",
    ),
    checkpoint_query_tty_dispatched: includesEvent(
      checkpointQueryTty.events,
      "rewindSession:main:latest:conversation:slash:checkpoint:query",
    ),
    checkpoint_search_created_at_tty_dispatched: includesEvent(
      checkpointSearchCreatedAtTty.events,
      "rewindSession:main:latest:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_compact_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdCompactTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_underscore_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdUnderscoreTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_space_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdSpaceTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_checkpoint_id_quoted_tty_dispatched: includesEvent(
      checkpointSearchCheckpointIdQuotedTty.events,
      "rewindSession:main:legacy-a:both:slash:checkpoint:query",
    ),
    checkpoint_search_created_at_digits_tty_dispatched: includesEvent(
      checkpointSearchCreatedAtDigitsTty.events,
      "rewindSession:main:latest:both:slash:checkpoint:query",
    ),
    checkpoint_search_created_at_digits_contains_tty_dispatched: includesEvent(
      checkpointSearchCreatedAtDigitsContainsTty.events,
      "rewindSession:main:latest:both:slash:checkpoint:query",
    ),
    checkpoint_find_empty_tty_warned: includesEvent(checkpointFindEmptyTty.events, "writeStdout"),
    checkpoint_find_empty_tty_dispatched: includesEvent(checkpointFindEmptyTty.events, "rewindSession"),
    checkpoint_find_empty_tty_opened_menu: includesEvent(
      checkpointFindEmptyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_find_empty_tty_warned: includesEvent(rewindFindEmptyTty.events, "writeStdout"),
    rewind_find_empty_tty_dispatched: includesEvent(rewindFindEmptyTty.events, "rewindSession"),
    rewind_find_empty_tty_opened_menu: includesEvent(
      rewindFindEmptyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_mode_only_tty_warned: includesEvent(rewindModeOnlyTty.events, "writeStdout"),
    rewind_mode_only_tty_dispatched: includesEvent(rewindModeOnlyTty.events, "rewindSession"),
    rewind_mode_only_tty_opened_menu: includesEvent(
      rewindModeOnlyTty.events,
      "openSessionMenu:rewind",
    ),
    rewind_with_args_warned: includesEvent(rewindWithArgs.events, "writeStdout"),
    rewind_with_args_opened_menu: includesEvent(rewindWithArgs.events, "openSessionMenu:rewind"),
    rewind_with_args_hits_run_turn: includesEvent(rewindWithArgs.events, "runTurn:/rewind latest"),
  };
}
