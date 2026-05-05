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
  has_header: plain.includes("模型通道"),
  has_session: plain.includes("会话 provider-health-contract"),
  hides_raw_session_namespace:
    !plain.includes("session feishu:grobot:dm")
    && !plain.includes("feishu:grobot:dm:provider-health-contract"),
  has_sticky: plain.includes("会话固定通道 alpha"),
  hides_raw_sticky_label: !plain.includes("sticky alpha"),
  has_alpha_closed: plain.includes("• alpha · 正常"),
  has_beta_open: plain.includes("• beta · 熔断中"),
  hides_raw_status_codes:
    !plain.includes("(CLOSED)")
    && !plain.includes("(OPEN)")
    && !plain.includes("(HALF_OPEN)"),
  has_latency_field: plain.includes("延迟 112.3ms"),
  has_error_rate_field: plain.includes("错误率 1.0%"),
  has_rpm_field: plain.includes("每分钟 120"),
  has_human_cooldown: plain.includes("冷却 30 秒"),
  has_human_error_class: plain.includes("最近错误 请求超时"),
  hides_raw_error_class: !plain.includes("最近错误 timeout"),
  hides_raw_rpm_burst_labels:
    !plain.includes("rpm 120")
    && !plain.includes("burst 120"),
  uses_reference_detail_rows:
    plain.includes("  ⎿  失败 0")
    && plain.includes("  ⎿  并发 4 · 每分钟 120 · 突发 120")
    && plain.includes("  ⎿  打开至"),
  avoids_machine_prefix:
    !plain.includes("[provider-health]")
    && !plain.includes("状态=")
    && !plain.includes("延迟EWMA_ms=")
    && !plain.includes("错误率EWMA="),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
