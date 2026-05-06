import type { RuntimeEvent } from "../../../../models/types";
import type { ActivityFeedRow } from "./contract";
import {
  normalizeActivityPayload,
  normalizeToolName,
  outputSummary,
  payloadToolCallId,
} from "./tool-event";

export interface ActivityFeedRowBuilders {
  buildToolStartRow(event: RuntimeEvent): ActivityFeedRow | undefined;
  buildToolEndRow(event: RuntimeEvent): ActivityFeedRow | undefined;
  buildRecoveryRow(event: RuntimeEvent): ActivityFeedRow | undefined;
}

export interface BuildGroupedActivityRowsInput extends ActivityFeedRowBuilders {
  events: readonly RuntimeEvent[];
}

interface ToolCallState {
  id: string;
  toolName: string;
  lastIndex: number;
  startEvent?: RuntimeEvent;
  endEvent?: RuntimeEvent;
  recoveryEvents: RuntimeEvent[];
}

interface OrderedRow {
  order: number;
  row: ActivityFeedRow;
}

function eventToolIdentity(event: RuntimeEvent): { id: string; toolName: string } {
  const payload = normalizeActivityPayload(event);
  const summary = outputSummary(payload);
  return {
    id: payloadToolCallId(payload),
    toolName: normalizeToolName(payload, summary),
  };
}

function pushAnonymousRow(input: {
  output: OrderedRow[];
  event: RuntimeEvent;
  index: number;
  builders: ActivityFeedRowBuilders;
}): void {
  const row = (() => {
    if (input.event.eventType === "tool_start") {
      return input.builders.buildToolStartRow(input.event);
    }
    if (input.event.eventType === "tool_end") {
      return input.builders.buildToolEndRow(input.event);
    }
    if (input.event.eventType === "tool_recovery") {
      return input.builders.buildRecoveryRow(input.event);
    }
    return undefined;
  })();
  if (row) {
    input.output.push({ order: input.index, row });
  }
}

function resolveToolState(
  states: Map<string, ToolCallState>,
  event: RuntimeEvent,
  index: number,
): ToolCallState | undefined {
  const identity = eventToolIdentity(event);
  if (!identity.id) {
    return undefined;
  }
  let state = states.get(identity.id);
  if (!state) {
    state = {
      id: identity.id,
      toolName: identity.toolName,
      lastIndex: index,
      recoveryEvents: [],
    };
    states.set(identity.id, state);
  }
  state.toolName = identity.toolName || state.toolName;
  state.lastIndex = index;
  return state;
}

function rowForToolState(
  state: ToolCallState,
  builders: ActivityFeedRowBuilders,
): ActivityFeedRow | undefined {
  const baseRow = state.endEvent
    ? builders.buildToolEndRow(state.endEvent)
    : state.startEvent
      ? builders.buildToolStartRow(state.startEvent)
      : undefined;
  if (!baseRow) {
    return undefined;
  }
  return {
    ...baseRow,
    kind: baseRow.kind ?? "tool",
    toolName: baseRow.toolName ?? state.toolName,
    toolCallId: baseRow.toolCallId ?? state.id,
  };
}

function recoveryRowsForToolState(
  state: ToolCallState,
  builders: ActivityFeedRowBuilders,
): OrderedRow[] {
  const rows: OrderedRow[] = [];
  for (const event of state.recoveryEvents) {
    const row = builders.buildRecoveryRow(event);
    if (!row) {
      continue;
    }
    rows.push({
      order: state.lastIndex,
      row: {
        ...row,
        toolName: row.toolName ?? state.toolName,
        toolCallId: row.toolCallId ?? state.id,
      },
    });
  }
  return rows;
}

function canGroupRow(row: ActivityFeedRow): boolean {
  return row.kind !== "recovery"
    && isGroupableTool(row.toolName ?? "")
    && row.state === "success"
    && row.severity === "ok"
    && row.detailLines.length <= 1;
}

function isGroupableTool(toolName: string): boolean {
  return toolName === "read"
    || toolName === "search"
    || toolName === "semantic_search"
    || toolName === "$web_search"
    || toolName === "web_search"
    || toolName === "glob"
    || toolName === "list";
}

function commonVerb(rows: readonly ActivityFeedRow[]): string {
  const [first] = rows;
  if (!first) {
    return "Tool";
  }
  const [verb] = first.title.trim().split(/\s+/);
  return verb || "Tool";
}

function groupedToolTitle(toolName: string, rows: readonly ActivityFeedRow[]): string {
  const count = rows.length;
  const verb = commonVerb(rows);
  if (toolName === "read") {
    return `Read ${String(count)} files`;
  }
  if (toolName === "search" || toolName === "semantic_search" || toolName === "$web_search" || toolName === "web_search") {
    return `Search ${String(count)} queries`;
  }
  if (toolName === "glob" || toolName === "list") {
    return `Explore ${String(count)} paths`;
  }
  return `${verb} ${String(count)} ${count === 1 ? "item" : "items"}`;
}

function detailForGroupedRows(rows: readonly ActivityFeedRow[]): string[] {
  const details = rows
    .map((row) => {
      const [detail] = row.detailLines;
      return detail ? `${row.title} · ${detail}` : row.title;
    })
    .filter(Boolean)
    .slice(0, 3);
  const remaining = rows.length - details.length;
  if (remaining > 0) {
    return [...details, `... ${String(remaining)} more`];
  }
  return details;
}

function compactGroupedRows(rows: OrderedRow[]): OrderedRow[] {
  const output: OrderedRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const current = rows[index];
    const toolName = current?.row.toolName ?? "";
    if (!current || !toolName || !canGroupRow(current.row)) {
      if (current) {
        output.push(current);
      }
      index += 1;
      continue;
    }
    const group = [current];
    let cursor = index + 1;
    while (
      cursor < rows.length
      && rows[cursor]?.row.toolName === toolName
      && canGroupRow(rows[cursor].row)
    ) {
      group.push(rows[cursor]);
      cursor += 1;
    }
    if (group.length < 3) {
      output.push(...group);
      index = cursor;
      continue;
    }
    const groupRows = group.map((item) => item.row);
    output.push({
      order: group[group.length - 1].order,
      row: {
        title: groupedToolTitle(toolName, groupRows),
        detailLines: detailForGroupedRows(groupRows),
        severity: "ok",
        state: "success",
        kind: "tool-group",
        toolName,
        count: group.length,
      },
    });
    index = cursor;
  }
  return output;
}

export function buildGroupedActivityRows(input: BuildGroupedActivityRowsInput): ActivityFeedRow[] {
  const states = new Map<string, ToolCallState>();
  const anonymousRows: OrderedRow[] = [];
  input.events.forEach((event, index) => {
    if (
      event.eventType !== "tool_start"
      && event.eventType !== "tool_end"
      && event.eventType !== "tool_recovery"
    ) {
      return;
    }
    const state = resolveToolState(states, event, index);
    if (!state) {
      pushAnonymousRow({ output: anonymousRows, event, index, builders: input });
      return;
    }
    if (event.eventType === "tool_start") {
      state.startEvent = event;
    } else if (event.eventType === "tool_end") {
      state.endEvent = event;
    } else if (event.eventType === "tool_recovery") {
      state.recoveryEvents.push(event);
    }
  });

  const stateRows: OrderedRow[] = [];
  for (const state of states.values()) {
    const row = rowForToolState(state, input);
    if (row) {
      stateRows.push({ order: state.lastIndex, row });
    }
    stateRows.push(...recoveryRowsForToolState(state, input));
  }
  const orderedRows = [...anonymousRows, ...stateRows].sort((left, right) => left.order - right.order);
  return compactGroupedRows(orderedRows).map((item) => item.row);
}
