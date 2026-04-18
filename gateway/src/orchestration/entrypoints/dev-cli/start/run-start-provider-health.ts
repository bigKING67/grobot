import {
  renderProviderHealthScreen,
  type ProviderHealthSnapshotInput,
} from "../ui/screens/provider-health-screen";

export function formatProviderHealthSnapshot(
  input: ProviderHealthSnapshotInput,
): string {
  return renderProviderHealthScreen(input);
}
