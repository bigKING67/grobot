import { includesEvent, runDispatchCase } from "./helpers";

export async function runSessionDispatchFlows() {
  const switchPrefixMiss = await runDispatchCase("/switcher");
  const continuePrefixMiss = await runDispatchCase("/continue-next");
  const resumePrefixMiss = await runDispatchCase("/resumable");
  const switchMenu = await runDispatchCase("/switch");
  const continueMenu = await runDispatchCase("/continue");
  const resumeMenu = await runDispatchCase("/resume");
  const switchLegacyWithId = await runDispatchCase("/switch session-legacy", { stdinIsTty: false });
  const switchLegacyWithIdTty = await runDispatchCase("/switch session-legacy", { stdinIsTty: true });
  const continueLegacyWithId = await runDispatchCase("/continue session-legacy", { stdinIsTty: false });
  const continueLegacyWithIdTty = await runDispatchCase("/continue session-legacy", { stdinIsTty: true });
  const resumeLegacyWithId = await runDispatchCase("/resume session-legacy", { stdinIsTty: false });
  const resumeLegacyWithIdTty = await runDispatchCase("/resume session-legacy", { stdinIsTty: true });
  const resumeMenuAliasTty = await runDispatchCase("/resume menu", { stdinIsTty: true });
  const resumeFindPrefixTty = await runDispatchCase("/resume session-lega", { stdinIsTty: true });
  const resumeFindKeywordTty = await runDispatchCase("/resume find legacy", { stdinIsTty: true });
  const resumeSearchKeywordTty = await runDispatchCase("/resume search old", { stdinIsTty: true });
  const resumeSearchCompactTitleTty = await runDispatchCase("/resume search legacysession", {
    stdinIsTty: true,
  });
  const resumeSearchCompactIdTty = await runDispatchCase("/resume search sessionlegacy", {
    stdinIsTty: true,
  });
  const resumeSearchCompactIdUnderscoreTty = await runDispatchCase("/resume search session_legacy", {
    stdinIsTty: true,
  });
  const resumeSearchCompactIdSpaceTty = await runDispatchCase("/resume search session legacy", {
    stdinIsTty: true,
  });
  const resumeSearchQuotedTitleTty = await runDispatchCase('/resume search "legacy session"', {
    stdinIsTty: true,
  });
  const resumeFindUpdatedAtTty = await runDispatchCase("/resume find 2026-04-19", { stdinIsTty: true });
  const resumeSearchUpdatedAtDigitsTty = await runDispatchCase("/resume search 20260418", {
    stdinIsTty: true,
  });
  const resumeSearchUpdatedAtDigitsContainsTty = await runDispatchCase("/resume search 0419", {
    stdinIsTty: true,
  });
  const resumeSearchSeparatorOnlyTty = await runDispatchCase("/resume search ---", {
    stdinIsTty: true,
  });
  const resumeFindActiveTty = await runDispatchCase("/resume find main", { stdinIsTty: true });
  const resumeFindMissingTty = await runDispatchCase("/resume find missing", { stdinIsTty: true });
  const resumeFindMultipleTty = await runDispatchCase("/resume session", { stdinIsTty: true });
  const resumeFindMultipleOverflowTty = await runDispatchCase("/resume session", {
    stdinIsTty: true,
    sessionSummaries: [
      {
        id: "main",
        title: "Main Session",
        summary: "active",
        updatedAt: "2026-04-20T00:00:00.000Z",
        active: true,
      },
      {
        id: "session-legacy",
        title: "Legacy Session",
        summary: "historical",
        updatedAt: "2026-04-19T23:59:00.000Z",
        active: false,
      },
      {
        id: "session-archive",
        title: "Archive Session",
        summary: "old",
        updatedAt: "2026-04-18T23:59:00.000Z",
        active: false,
      },
      {
        id: "session-ops",
        title: "Ops Session",
        summary: "ops queue",
        updatedAt: "2026-04-18T20:59:00.000Z",
        active: false,
      },
      {
        id: "session-growth",
        title: "Growth Session",
        summary: "growth notes",
        updatedAt: "2026-04-18T19:59:00.000Z",
        active: false,
      },
      {
        id: "session-data",
        title: "Data Session",
        summary: "data review",
        updatedAt: "2026-04-18T18:59:00.000Z",
        active: false,
      },
      {
        id: "session-ux",
        title: "UX Session",
        summary: "ux polish",
        updatedAt: "2026-04-18T17:59:00.000Z",
        active: false,
      },
    ],
  });
  const resumeFindEmptyTty = await runDispatchCase("/resume find", { stdinIsTty: true });

  return {
    switch_prefix_miss_hits_run_turn: includesEvent(switchPrefixMiss.events, "runTurn:/switcher"),
    switch_prefix_miss_opened_menu: includesEvent(switchPrefixMiss.events, "openSessionMenu:switch"),
    continue_prefix_miss_hits_run_turn: includesEvent(continuePrefixMiss.events, "runTurn:/continue-next"),
    continue_prefix_miss_opened_menu: includesEvent(continuePrefixMiss.events, "openSessionMenu:continue"),
    resume_prefix_miss_hits_run_turn: includesEvent(resumePrefixMiss.events, "runTurn:/resumable"),
    resume_prefix_miss_opened_menu: includesEvent(resumePrefixMiss.events, "openSessionMenu:resume"),
    switch_menu_opened: includesEvent(switchMenu.events, "openSessionMenu:switch"),
    continue_menu_opened: includesEvent(continueMenu.events, "openSessionMenu:continue"),
    resume_menu_opened: includesEvent(resumeMenu.events, "openSessionMenu:resume"),
    switch_legacy_with_id_warned: includesEvent(switchLegacyWithId.events, "writeStdout"),
    switch_legacy_with_id_opened_menu: includesEvent(switchLegacyWithId.events, "openSessionMenu:switch"),
    switch_legacy_with_id_skips_direct_switch: !includesEvent(switchLegacyWithId.events, "switchSession"),
    switch_legacy_with_id_tty_warned: includesEvent(switchLegacyWithIdTty.events, "writeStdout"),
    switch_legacy_with_id_tty_opened_sessions_menu: includesEvent(
      switchLegacyWithIdTty.events,
      "openSessionMenu:sessions",
    ),
    continue_legacy_with_id_warned: includesEvent(continueLegacyWithId.events, "writeStdout"),
    continue_legacy_with_id_opened_menu: includesEvent(continueLegacyWithId.events, "openSessionMenu:continue"),
    continue_legacy_with_id_skips_direct_continue: !includesEvent(continueLegacyWithId.events, "continueFromSession"),
    continue_legacy_with_id_tty_warned: includesEvent(continueLegacyWithIdTty.events, "writeStdout"),
    continue_legacy_with_id_tty_opened_sessions_menu: includesEvent(
      continueLegacyWithIdTty.events,
      "openSessionMenu:sessions",
    ),
    resume_legacy_with_id_warned: includesEvent(resumeLegacyWithId.events, "writeStdout"),
    resume_legacy_with_id_direct_switch: includesEvent(resumeLegacyWithId.events, "switchSession"),
    resume_legacy_with_id_opened_menu: includesEvent(resumeLegacyWithId.events, "openSessionMenu:resume"),
    resume_legacy_with_id_tty_warned: includesEvent(resumeLegacyWithIdTty.events, "writeStdout"),
    resume_legacy_with_id_tty_direct_switch: includesEvent(resumeLegacyWithIdTty.events, "switchSession"),
    resume_legacy_with_id_tty_opened_resume_menu: includesEvent(
      resumeLegacyWithIdTty.events,
      "openSessionMenu:resume",
    ),
    resume_menu_alias_tty_opened_menu: includesEvent(
      resumeMenuAliasTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_prefix_tty_direct_switch: includesEvent(
      resumeFindPrefixTty.events,
      "switchSession:session-legacy",
    ),
    resume_find_keyword_tty_direct_switch: includesEvent(
      resumeFindKeywordTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_keyword_tty_direct_switch: includesEvent(
      resumeSearchKeywordTty.events,
      "switchSession:session-archive",
    ),
    resume_search_compact_title_tty_direct_switch: includesEvent(
      resumeSearchCompactTitleTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_compact_id_tty_direct_switch: includesEvent(
      resumeSearchCompactIdTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_compact_id_underscore_tty_direct_switch: includesEvent(
      resumeSearchCompactIdUnderscoreTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_compact_id_space_tty_direct_switch: includesEvent(
      resumeSearchCompactIdSpaceTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_quoted_title_tty_direct_switch: includesEvent(
      resumeSearchQuotedTitleTty.events,
      "switchSession:session-legacy",
    ),
    resume_find_updated_at_tty_direct_switch: includesEvent(
      resumeFindUpdatedAtTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_updated_at_digits_tty_direct_switch: includesEvent(
      resumeSearchUpdatedAtDigitsTty.events,
      "switchSession:session-archive",
    ),
    resume_search_updated_at_digits_contains_tty_direct_switch: includesEvent(
      resumeSearchUpdatedAtDigitsContainsTty.events,
      "switchSession:session-legacy",
    ),
    resume_search_separator_only_tty_warned: includesEvent(
      resumeSearchSeparatorOnlyTty.events,
      "writeStdout",
    ),
    resume_search_separator_only_tty_direct_switch: includesEvent(
      resumeSearchSeparatorOnlyTty.events,
      "switchSession",
    ),
    resume_search_separator_only_tty_opened_menu: includesEvent(
      resumeSearchSeparatorOnlyTty.events,
      "openSessionMenu:resume",
    ),
    resume_search_separator_only_tty_no_match_message: resumeSearchSeparatorOnlyTty.stdout.includes(
      "没有匹配的会话",
    ),
    resume_search_separator_only_tty_no_match_has_tip: resumeSearchSeparatorOnlyTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    resume_find_active_tty_warned: includesEvent(resumeFindActiveTty.events, "writeStdout"),
    resume_find_active_tty_direct_switch: includesEvent(resumeFindActiveTty.events, "switchSession"),
    resume_find_active_tty_opened_menu: includesEvent(
      resumeFindActiveTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_active_tty_message_has_prefix: resumeFindActiveTty.stdout.includes(
      "会话已是当前会话",
    ),
    resume_find_active_tty_message_has_menu_hint: resumeFindActiveTty.stdout.includes(
      "使用 /resume 打开菜单。",
    ),
    resume_find_missing_tty_warned: includesEvent(resumeFindMissingTty.events, "writeStdout"),
    resume_find_missing_tty_direct_switch: includesEvent(resumeFindMissingTty.events, "switchSession"),
    resume_find_missing_tty_opened_menu: includesEvent(
      resumeFindMissingTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_missing_tty_no_match_has_tip: resumeFindMissingTty.stdout.includes(
      "紧凑查询会忽略空格、\"_\" 和 \"-\"。",
    ),
    resume_find_multiple_tty_warned: includesEvent(resumeFindMultipleTty.events, "writeStdout"),
    resume_find_multiple_tty_direct_switch: includesEvent(resumeFindMultipleTty.events, "switchSession"),
    resume_find_multiple_tty_includes_quick_pick: resumeFindMultipleTty.stdout.includes(
      "/resume session-legacy",
    ),
    resume_find_multiple_tty_includes_title_preview: resumeFindMultipleTty.stdout.includes(
      "| 标题=",
    ),
    resume_find_multiple_tty_includes_summary_preview: resumeFindMultipleTty.stdout.includes(
      "| 摘要=",
    ),
    resume_find_multiple_overflow_tty_includes_overflow_line: resumeFindMultipleOverflowTty.stdout.includes(
      "... 还有 1 项",
    ),
    resume_find_multiple_overflow_tty_includes_quick_pick_header: resumeFindMultipleOverflowTty.stdout.includes(
      "快速选择:",
    ),
    resume_surface_avoids_legacy_marker:
      !resumeFindActiveTty.stdout.includes("[session]")
      && !resumeFindMultipleTty.stdout.includes("[session]")
      && !resumeFindMultipleOverflowTty.stdout.includes("[session]")
      && !resumeFindMissingTty.stdout.includes("[session]"),
    session_command_redirect_surface_avoids_legacy_marker:
      !switchLegacyWithIdTty.stdout.includes("[session]")
      && !continueLegacyWithIdTty.stdout.includes("[session]"),
    resume_find_multiple_tty_opened_menu: includesEvent(
      resumeFindMultipleTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_empty_tty_warned: includesEvent(resumeFindEmptyTty.events, "writeStdout"),
    resume_find_empty_tty_opened_menu: includesEvent(
      resumeFindEmptyTty.events,
      "openSessionMenu:resume",
    ),
    resume_find_empty_tty_usage_has_updated_at: resumeFindEmptyTty.stdout.includes(
      "用法: /resume find <id|title|summary|updated-at>",
    ),
  };
}
