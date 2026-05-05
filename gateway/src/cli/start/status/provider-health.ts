import { renderProviderHealthScreen } from "../../tui/components/provider-health/render";
import type { ProviderHealthSnapshotInput } from "../../tui/components/provider-health/contract";

export function formatProviderHealthSnapshot(
  input: ProviderHealthSnapshotInput,
): string {
  return renderProviderHealthScreen(input);
}
