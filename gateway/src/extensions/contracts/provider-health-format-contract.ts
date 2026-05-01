import { formatProviderHealthSnapshot } from "../../orchestration/entrypoints/dev-cli/start/run-start-provider-health";
import { type SessionProviderRuntimeState } from "../../orchestration/entrypoints/dev-cli/start/session-registry";

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

const payload = {
  has_header: text.includes("[provider-health]"),
  has_session: text.includes("会话: feishu:grobot:dm:provider-health-contract"),
  has_sticky: text.includes("固定供应商: alpha"),
  has_alpha_closed: text.includes("- alpha 状态=正常(CLOSED)"),
  has_beta_open: text.includes("- beta 状态=熔断中(OPEN)"),
  has_latency_field: text.includes("延迟EWMA_ms="),
  has_error_rate_field: text.includes("错误率EWMA="),
  has_rpm_field: text.includes("rpm="),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
