export {
  DEFAULT_STATUS_LINE_CONFIG,
  DEFAULT_STATUS_LINE_SEGMENT_ORDER,
  DEFAULT_STATUS_LINE_SEGMENTS,
  STATUS_LINE_SEGMENT_IDS,
  STATUS_LINE_TEMPLATE_FALLBACKS,
  STATUS_LINE_TEMPLATES,
  type StatusLineConfig,
  type StatusLineConfigInput,
  type StatusLineLayoutMode,
  type StatusLinePromptInput,
  type StatusLinePromptParts,
  type StatusLineSegmentId,
  type StatusLineTemplateConfig,
  type StatusLineTemplateId,
  type StatusLineTheme,
} from "../components/status-line/contract";
export { normalizeStatusLineConfig } from "../components/status-line/reducer";
export {
  measureDisplayWidth,
  renderStatusLinePrompt,
  resolveStatusLinePromptParts,
} from "../components/status-line/render";
