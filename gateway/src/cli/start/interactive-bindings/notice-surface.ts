export function buildCompactNotice(
  title: string,
  lines: ReadonlyArray<string> = [],
): string {
  return [
    `● ${title}`,
    ...lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `  ${line}`),
    "",
    "",
  ].join("\n");
}
