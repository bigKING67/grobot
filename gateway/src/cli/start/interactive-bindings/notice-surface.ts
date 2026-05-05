import { renderInfoPanel } from "../../tui/components/info-panel/render";

export function buildCompactNotice(
  title: string,
  lines: ReadonlyArray<string> = [],
): string {
  const normalized = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const [primary, ...detailLines] = normalized;
  return renderInfoPanel({
    title,
    sections: [{
      rows: [{
        title: primary ?? "No details",
        detailLines,
      }],
    }],
  });
}
