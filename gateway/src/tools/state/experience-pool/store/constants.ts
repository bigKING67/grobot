export const EXPERIENCE_POOL_VERSION = "v1";
export const MAX_KEYWORDS = 32;
export const MAX_SOP_STEPS = 8;
export const MAX_FAILURE_SIGNALS = 6;
export const MAX_GUARDRAILS = 8;
export const MAX_SCENARIO_TAGS = 8;
export const MAX_CONFLICT_SIGNALS = 6;
export const MAX_ATTEMPT_HISTORY = 20;
export const MAX_EVIDENCE = 24;

export const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "then",
  "than",
  "need",
  "have",
  "has",
  "was",
  "were",
  "are",
  "you",
  "your",
  "please",
  "just",
  "about",
  "这里",
  "这个",
  "那个",
  "然后",
  "继续",
  "一下",
  "就是",
  "主要",
  "已经",
  "需要",
  "还是",
  "我们",
  "你们",
  "他们",
  "以及",
  "并且",
  "相关",
  "好的",
]);

export const TASK_TYPE_RULES: ReadonlyArray<{
  taskType: string;
  pattern: RegExp;
}> = [
  {
    taskType: "debug_fix",
    pattern: /(debug|bug|fix|error|exception|fail|failure|报错|错误|异常|失败|修复|排查|故障)/i,
  },
  {
    taskType: "feature_build",
    pattern: /(implement|feature|build|add|create|新增|实现|开发|接入|落地|打磨)/i,
  },
  {
    taskType: "architecture_refactor",
    pattern: /(refactor|rework|optimi[sz]e|architecture|重构|优化|机制|架构|治理)/i,
  },
  {
    taskType: "verification_testing",
    pattern: /(test|verify|contract|assert|check|验收|验证|测试|评测|合约)/i,
  },
  {
    taskType: "deployment_ops",
    pattern: /(deploy|release|rollout|infra|operation|上线|部署|发布|运维|环境)/i,
  },
  {
    taskType: "documentation",
    pattern: /(docs?|readme|spec|guide|report|文档|说明|报告|总结)/i,
  },
];

export const SCENARIO_TAG_RULES: ReadonlyArray<{
  tag: string;
  pattern: RegExp;
}> = [
  { tag: "auth_session", pattern: /(auth|login|session|token|cookie|401|403|登录|鉴权|会话|权限)/i },
  { tag: "context_engine", pattern: /(context|compression|budget|utilization|auto-limit|semantic|上下文|压缩|预算)/i },
  { tag: "memory_orchestrator", pattern: /(memory orchestrator|memory|lineage|recall|inject|记忆|回忆|注入)/i },
  { tag: "experience_pool", pattern: /(experience|sop|attempt|复用|经验池|经验)/i },
  { tag: "scheduler", pattern: /(scheduler|cron|schedule|定时|调度)/i },
  { tag: "runtime_provider", pattern: /(provider|model|runtime|timeout|429|upstream|模型|路由|超时)/i },
  { tag: "mcp_tooling", pattern: /(mcp|tool call|tool|插件|工具链)/i },
  { tag: "frontend_ui", pattern: /(frontend|ui|ux|页面|样式|组件|交互)/i },
  { tag: "backend_api", pattern: /(backend|api|server|gateway|接口|后端)/i },
  { tag: "database_state", pattern: /(database|db|postgres|redis|schema|migration|数据库|表|迁移)/i },
  { tag: "git_workflow", pattern: /(git|commit|rebase|stash|branch|提交|分支)/i },
  { tag: "ci_quality", pattern: /(ci|lint|typecheck|pipeline|check|质量门禁|构建)/i },
];
