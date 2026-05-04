import { renderReactTerminalSelectMenu } from "../../react/select-menu";
import type { RenderTerminalSelectMenuInput } from "./contract";

export type {
  RenderTerminalSelectMenuInput,
  TerminalSelectMenuInput,
  TerminalSelectMenuItem,
  TerminalSelectMenuLayout,
  TerminalSelectMenuModelPickerMeta,
  TerminalSelectMenuPlanApprovalMeta,
  TerminalSelectMenuResult,
  TerminalSelectMenuViewport,
} from "./contract";

export function renderTerminalSelectMenu(input: RenderTerminalSelectMenuInput): string {
  return renderReactTerminalSelectMenu(input);
}
