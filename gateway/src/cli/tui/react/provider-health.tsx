import React from "react";
import { Box, Text, renderStaticInk } from "./static-ink";
import { createCliTheme } from "../theme/ansi-theme";
import { truncateDisplayWidth } from "../terminal/display-width";
import type {
  ProviderHealthRow,
  ProviderHealthViewModel,
} from "../components/provider-health/contract";

const PROVIDER_HEALTH_COLUMNS = 120;

function resolveTone(row: ProviderHealthRow): "brand" | "remember" | "info" {
  if (row.severity === "error") {
    return "info";
  }
  if (row.severity === "warning") {
    return "remember";
  }
  return "brand";
}

function renderProviderRow(row: ProviderHealthRow, index: number): React.ReactElement {
  const label = `${row.name} · ${row.statusLabel}`;
  return (
    <Box key={index} flexDirection="column">
      <Box flexDirection="row">
        <Text tone={resolveTone(row)}>•</Text>
        <Text>{` ${truncateDisplayWidth(label, PROVIDER_HEALTH_COLUMNS - 2, { compact: true })}`}</Text>
      </Box>
      {row.detailLines.map((detail, detailIndex) => (
        <Text key={`${index}-${detailIndex}`} tone="muted">
          {truncateDisplayWidth(`  ⎿  ${detail}`, PROVIDER_HEALTH_COLUMNS)}
        </Text>
      ))}
    </Box>
  );
}

export function renderReactProviderHealthScreen(
  input: ProviderHealthViewModel,
): string {
  const body = input.rows.length > 0
    ? input.rows.map((row, index) => renderProviderRow(row, index))
    : [(
      <Text key="empty" tone="muted">
        {input.emptyMessage ?? "No model providers"}
      </Text>
    )];
  return renderStaticInk(
    <Box flexDirection="column">
      <Text tone="brand" bold>{input.title}</Text>
      {input.subtitle ? (
        <Text tone="muted">{truncateDisplayWidth(input.subtitle, PROVIDER_HEALTH_COLUMNS, { compact: true })}</Text>
      ) : null}
      <Box flexDirection="column">
        {body}
      </Box>
    </Box>,
    createCliTheme("interactive_tty"),
  );
}
