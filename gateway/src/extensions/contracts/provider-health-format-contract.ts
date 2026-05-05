import { formatProviderHealthSnapshot } from "../../cli/start/status/provider-health";
import { type SessionProviderRuntimeState } from "../../cli/start/session-registry";

const nowMs = Date.now();
const states: SessionProviderRuntimeState[] = [
  {
    provider_name: "alpha",
    consecutive_failures: 0,
    last_error_class: undefined,
    circuit_open_until_ms: 0,
    ewma_latency_ms: 112.3,
    ewma_error_rate: 0.01,
  },
  {
    provider_name: "beta",
    consecutive_failures: 1,
    last_error_class: "timeout",
    circuit_open_until_ms: nowMs + 120_000,
    ewma_latency_ms: 532.1,
    ewma_error_rate: 0.21,
  },
];

const text = formatProviderHealthSnapshot({
  sessionKey: "feishu:grobot:dm:provider-health-contract",
  stickyProvider: "alpha",
  failureThreshold: 2,
  cooldownSecs: 30,
  providers: [
    {
      name: "alpha",
      maxInFlight: 4,
      requestsPerMinute: 120,
      burst: 120,
    },
    {
      name: "beta",
      maxInFlight: 2,
      requestsPerMinute: 30,
      burst: 30,
    },
  ],
  states,
});
const plain = text.replace(/\u001B\[[0-9;]*m/g, "");

const payload = {
  has_header: plain.includes("Model providers"),
  has_session: plain.includes("session provider-health-contract"),
  hides_raw_session_namespace:
    !plain.includes("session feishu:grobot:dm")
    && !plain.includes("feishu:grobot:dm:provider-health-contract"),
  has_sticky: plain.includes("Sticky provider alpha"),
  hides_raw_sticky_label: !plain.includes("sticky alpha"),
  has_alpha_closed: plain.includes("• alpha · Healthy"),
  has_beta_open: plain.includes("• beta · Open"),
  hides_raw_status_codes:
    !plain.includes("(CLOSED)")
    && !plain.includes("(OPEN)")
    && !plain.includes("(HALF_OPEN)"),
  has_latency_field: plain.includes("latency 112.3ms"),
  has_error_rate_field: plain.includes("error rate 1.0%"),
  has_rpm_field: plain.includes("rate 120/min"),
  has_human_cooldown: plain.includes("cooldown 30s"),
  has_human_error_class: plain.includes("last error Request timed out"),
  hides_raw_error_class: !plain.includes("last error timeout"),
  hides_raw_rpm_burst_labels:
    !plain.includes("requestsPerMinute 120")
    && !plain.includes("burstSize 120"),
  uses_reference_detail_rows:
    plain.includes("  ⎿  failures 0 · latency 112.3ms · error rate 1.0%")
    && plain.includes("  ⎿  in-flight 4 · rate 120/min · burst-cap 120")
    && plain.includes("  ⎿  open until"),
  avoids_machine_prefix:
    !plain.includes("[provider-health]")
    && !plain.includes("status=")
    && !plain.includes("ewma_latency_ms=")
    && !plain.includes("ewma_error_rate="),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
