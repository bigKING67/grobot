import {
  renderProviderHealthScreen,
  type ProviderHealthSnapshotInput,
} from "../tui/screens/provider-health-screen";

export function formatProviderHealthSnapshot(
  input: ProviderHealthSnapshotInput,
): string {
  return renderProviderHealthScreen(input);
}
