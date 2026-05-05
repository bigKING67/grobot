import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { measureDisplayWidth } from "../../tui/terminal/display-width";
import type { InfoPanelRow } from "../../tui/components/info-panel/contract";

function resolvePlanSurfaceColumns(input: {
  title: string;
  subtitle?: string;
  rows: readonly InfoPanelRow[];
  footerLines?: readonly string[];
}): number {
  const widest = Math.max(
    measureDisplayWidth(input.title),
    measureDisplayWidth(input.subtitle ?? ""),
    ...input.rows.flatMap((row) => [
      measureDisplayWidth(row.title) + 2,
      ...(row.detailLines ?? []).map((line) => measureDisplayWidth(line) + 8),
    ]),
    ...(input.footerLines ?? []).map((line) => measureDisplayWidth(line)),
  );
  return Math.max(96, widest + 10);
}

export function renderPlanSurface(input: {
  title: string;
  rows: readonly InfoPanelRow[];
  subtitle?: string;
  footerLines?: readonly string[];
}): string {
  return renderInfoPanel({
    title: input.title,
    titleTone: "planMode",
    subtitle: input.subtitle,
    sections: [
      {
        rows: input.rows,
      },
    ],
    footerLines: input.footerLines,
    terminalColumns: resolvePlanSurfaceColumns(input),
  });
}
