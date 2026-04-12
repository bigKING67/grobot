type JsonObject = Record<string, unknown>;

const MANAGEMENT_ACTION_RELOAD = "reload";
const MANAGEMENT_ACTION_INTERRUPT = "interrupt";
const MANAGEMENT_ACTION_CONFIG_READ = "config_read";
const MANAGEMENT_ACTION_MCP_RESET = "mcp_reset";
const MANAGEMENT_ACTION_MEMORY_READ = "memory_read";
const MANAGEMENT_ACTION_MEMORY_IMPORT = "memory_import";
const MANAGEMENT_ACTION_MEMORY_FORGET = "memory_forget";
const MANAGEMENT_ACTION_MEMORY_LIFECYCLE = "memory_lifecycle";
const MANAGEMENT_ACTION_MEMORY_MANAGE = "memory_manage";

const MANAGEMENT_ACTION_MEMORY_GRANULAR = [
  MANAGEMENT_ACTION_MEMORY_READ,
  MANAGEMENT_ACTION_MEMORY_IMPORT,
  MANAGEMENT_ACTION_MEMORY_FORGET,
  MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
] as const;

const MANAGEMENT_ACTION_ALL = [
  MANAGEMENT_ACTION_RELOAD,
  MANAGEMENT_ACTION_INTERRUPT,
  MANAGEMENT_ACTION_CONFIG_READ,
  MANAGEMENT_ACTION_MCP_RESET,
  MANAGEMENT_ACTION_MEMORY_READ,
  MANAGEMENT_ACTION_MEMORY_IMPORT,
  MANAGEMENT_ACTION_MEMORY_FORGET,
  MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
  MANAGEMENT_ACTION_MEMORY_MANAGE,
] as const;

const CONFIG_SECTION_PATHS = "paths";
const CONFIG_SECTION_SELECTION = "selection";
const CONFIG_SECTION_SESSION_STORE = "session_store";
const CONFIG_SECTION_PROJECT_TOML = "project_toml";
const CONFIG_SECTION_CONFIG_TOML = "config_toml";

const CONFIG_SECTION_ALL = [
  CONFIG_SECTION_PATHS,
  CONFIG_SECTION_SELECTION,
  CONFIG_SECTION_SESSION_STORE,
  CONFIG_SECTION_PROJECT_TOML,
  CONFIG_SECTION_CONFIG_TOML,
] as const;

const DEFAULT_PUBLIC_CONFIG_SECTIONS = [
  CONFIG_SECTION_SELECTION,
  CONFIG_SECTION_SESSION_STORE,
] as const;

const CONFIG_PROFILE_OPERATOR = "operator";
const CONFIG_PROFILE_AUDITOR = "auditor";
const CONFIG_PROFILE_ADMIN = "admin";

const CONFIG_PROFILE_SECTION_MAP: Record<string, readonly string[] | null> = {
  [CONFIG_PROFILE_OPERATOR]: DEFAULT_PUBLIC_CONFIG_SECTIONS,
  [CONFIG_PROFILE_AUDITOR]: [
    CONFIG_SECTION_PATHS,
    CONFIG_SECTION_SELECTION,
    CONFIG_SECTION_SESSION_STORE,
    CONFIG_SECTION_PROJECT_TOML,
  ],
  [CONFIG_PROFILE_ADMIN]: null,
};

const POLICY_TEMPLATE_OPS_READ_ONLY = "ops_read_only";
const POLICY_TEMPLATE_AUDIT_READ = "audit_read";
const POLICY_TEMPLATE_FULL_ADMIN = "full_admin";
const POLICY_TEMPLATE_MEMORY_OPS_READONLY = "memory_ops_readonly";
const POLICY_TEMPLATE_MEMORY_OPS_WRITER = "memory_ops_writer";

const POLICY_TEMPLATE_ALL = [
  POLICY_TEMPLATE_OPS_READ_ONLY,
  POLICY_TEMPLATE_AUDIT_READ,
  POLICY_TEMPLATE_FULL_ADMIN,
  POLICY_TEMPLATE_MEMORY_OPS_READONLY,
  POLICY_TEMPLATE_MEMORY_OPS_WRITER,
] as const;

const POLICY_TEMPLATE_DEFAULTS: Record<
  string,
  { actions?: readonly string[]; config_profile?: string; config_sections?: readonly string[] | null }
> = {
  [POLICY_TEMPLATE_OPS_READ_ONLY]: {
    actions: [MANAGEMENT_ACTION_CONFIG_READ],
    config_profile: CONFIG_PROFILE_OPERATOR,
  },
  [POLICY_TEMPLATE_AUDIT_READ]: {
    actions: [MANAGEMENT_ACTION_CONFIG_READ],
    config_profile: CONFIG_PROFILE_AUDITOR,
  },
  [POLICY_TEMPLATE_FULL_ADMIN]: {
    actions: ["all"],
    config_profile: CONFIG_PROFILE_ADMIN,
  },
  [POLICY_TEMPLATE_MEMORY_OPS_READONLY]: {
    actions: [MANAGEMENT_ACTION_MEMORY_READ],
  },
  [POLICY_TEMPLATE_MEMORY_OPS_WRITER]: {
    actions: [
      MANAGEMENT_ACTION_MEMORY_IMPORT,
      MANAGEMENT_ACTION_MEMORY_FORGET,
      MANAGEMENT_ACTION_MEMORY_LIFECYCLE,
    ],
  },
};

type ManagementCredential = {
  name: string;
  token: string;
  source: string;
  actions: string[];
  interrupt_session_prefixes: string[];
  config_sections: string[] | null;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonArg(raw: string, argName: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${argName} must be a JSON object`);
  }
  return parsed;
}

function parseArgs(argv: string[]): { command: string; options: Map<string, string> } {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function normalizeManagementActions(rawActions: unknown): string[] {
  const allowedActions = new Set<string>(MANAGEMENT_ACTION_ALL as readonly string[]);
  if (!Array.isArray(rawActions)) {
    return [...MANAGEMENT_ACTION_ALL];
  }
  const normalized: string[] = [];
  for (const item of rawActions) {
    if (typeof item !== "string") {
      continue;
    }
    const token = item.trim().toLowerCase();
    if (token === "*" || token === "all") {
      return [...MANAGEMENT_ACTION_ALL];
    }
    if (allowedActions.has(token) && !normalized.includes(token)) {
      normalized.push(token);
    }
  }
  return normalized;
}

function managementActionAllowed(actions: readonly string[], requiredAction: string): boolean {
  if (actions.includes(requiredAction)) {
    return true;
  }
  if (
    MANAGEMENT_ACTION_MEMORY_GRANULAR.includes(requiredAction as (typeof MANAGEMENT_ACTION_MEMORY_GRANULAR)[number]) &&
    actions.includes(MANAGEMENT_ACTION_MEMORY_MANAGE)
  ) {
    return true;
  }
  return false;
}

function normalizeInterruptPrefixes(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const token = item.trim();
    if (token && !normalized.includes(token)) {
      normalized.push(token);
    }
  }
  return normalized;
}

function normalizeConfigSections(rawSections: unknown): string[] | null {
  if (!Array.isArray(rawSections)) {
    return null;
  }
  const normalized: string[] = [];
  for (const item of rawSections) {
    if (typeof item !== "string") {
      continue;
    }
    const token = item.trim().toLowerCase();
    if (token === "*" || token === "all") {
      return null;
    }
    if (CONFIG_SECTION_ALL.includes(token as (typeof CONFIG_SECTION_ALL)[number]) && !normalized.includes(token)) {
      normalized.push(token);
    }
  }
  return normalized;
}

function normalizeConfigProfile(rawProfile: unknown): string | null {
  if (typeof rawProfile !== "string") {
    return null;
  }
  const token = rawProfile.trim().toLowerCase();
  return token || null;
}

function normalizePolicyTemplate(rawTemplate: unknown): string | null {
  if (typeof rawTemplate !== "string") {
    return null;
  }
  const token = rawTemplate.trim().toLowerCase();
  return token || null;
}

function resolveManagementPolicyTemplate(rawTemplate: unknown, scope: string): JsonObject {
  const template = normalizePolicyTemplate(rawTemplate);
  if (template === null) {
    return {};
  }
  const defaults = POLICY_TEMPLATE_DEFAULTS[template];
  if (!defaults) {
    throw new Error(`Unknown policy template "${template}" for ${scope}. Supported: ${POLICY_TEMPLATE_ALL.join(", ")}`);
  }
  return { ...defaults };
}

function resolveConfigSectionsByProfile(rawProfile: unknown, scope: string): string[] | null {
  const profile = normalizeConfigProfile(rawProfile);
  if (profile === null) {
    return null;
  }
  if (!(profile in CONFIG_PROFILE_SECTION_MAP)) {
    throw new Error(
      `Unknown config profile "${profile}" for ${scope}. Supported: ${Object.keys(CONFIG_PROFILE_SECTION_MAP).join(", ")}`
    );
  }
  const mapped = CONFIG_PROFILE_SECTION_MAP[profile];
  return mapped === null ? null : [...mapped];
}

function buildManagementCredential(payload: JsonObject): ManagementCredential | null {
  const tokenRaw = payload.token;
  if (typeof tokenRaw !== "string" || tokenRaw.trim().length === 0) {
    return null;
  }
  const source = typeof payload.source === "string" ? payload.source : "config";
  const name = typeof payload.name === "string" ? payload.name : "credential";
  const templateDefaults = resolveManagementPolicyTemplate(payload.raw_policy_template, `management credential "${name}"`);

  let resolvedRawActions = payload.raw_actions;
  if (!Array.isArray(resolvedRawActions)) {
    resolvedRawActions = templateDefaults.actions;
  }

  let resolvedRawInterruptPrefixes = payload.raw_interrupt_prefixes;
  if (!Array.isArray(resolvedRawInterruptPrefixes)) {
    resolvedRawInterruptPrefixes = templateDefaults.interrupt_session_prefixes;
  }

  let resolvedRawConfigSections = payload.raw_config_sections;
  if (!Array.isArray(resolvedRawConfigSections)) {
    resolvedRawConfigSections = templateDefaults.config_sections;
  }

  let resolvedRawConfigProfile = payload.raw_config_profile;
  if (normalizeConfigProfile(resolvedRawConfigProfile) === null) {
    resolvedRawConfigProfile = templateDefaults.config_profile;
  }

  const actions = normalizeManagementActions(resolvedRawActions);
  let configSections = normalizeConfigSections(resolvedRawConfigSections);
  if (!Array.isArray(resolvedRawConfigSections)) {
    configSections = resolveConfigSectionsByProfile(resolvedRawConfigProfile, `management credential "${name}"`);
  }

  return {
    name,
    token: tokenRaw.trim(),
    source,
    actions,
    interrupt_session_prefixes: normalizeInterruptPrefixes(resolvedRawInterruptPrefixes),
    config_sections: configSections,
  };
}

function dedupeManagementCredentials(credentials: ManagementCredential[]): ManagementCredential[] {
  const deduped: ManagementCredential[] = [];
  for (const credential of credentials) {
    if (deduped.some((item) => item.token === credential.token)) {
      continue;
    }
    deduped.push(credential);
  }
  return deduped;
}

function resolveManagementCredentials(configToml: JsonObject, overrideToken: string | null): { credentials: ManagementCredential[]; source: string } {
  if (overrideToken && overrideToken.trim()) {
    const credential = buildManagementCredential({
      token: overrideToken,
      source: "cli",
      name: "cli_override",
      raw_actions: [...MANAGEMENT_ACTION_ALL],
    });
    return { credentials: credential ? [credential] : [], source: "cli" };
  }

  const envToken = (process.env.GROBOT_MANAGEMENT_TOKEN ?? "").trim();
  if (envToken) {
    const credential = buildManagementCredential({
      token: envToken,
      source: "env",
      name: "env_token",
      raw_actions: [...MANAGEMENT_ACTION_ALL],
    });
    return { credentials: credential ? [credential] : [], source: "env" };
  }

  const managementCfg = configToml.management;
  if (!isObject(managementCfg)) {
    return { credentials: [], source: "none" };
  }

  const credentials: ManagementCredential[] = [];
  const sourceTokens: string[] = [];

  const tokensCfg = managementCfg.tokens;
  if (Array.isArray(tokensCfg)) {
    tokensCfg.forEach((item, index) => {
      if (!isObject(item)) {
        return;
      }
      const nameRaw = item.name;
      const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw : `token_${index + 1}`;
      const credential = buildManagementCredential({
        token: item.token,
        source: "config_tokens",
        name,
        raw_policy_template: item.policy_template,
        raw_actions: item.actions,
        raw_interrupt_prefixes: item.interrupt_session_prefixes,
        raw_config_sections: item.config_sections,
        raw_config_profile: item.config_profile,
      });
      if (credential) {
        credentials.push(credential);
      }
    });
    if (credentials.length > 0) {
      sourceTokens.push("config_tokens");
    }
  }

  const single = buildManagementCredential({
    token: managementCfg.token,
    source: "config",
    name: "management.token",
    raw_policy_template: managementCfg.policy_template,
    raw_actions: managementCfg.actions,
    raw_interrupt_prefixes: managementCfg.interrupt_session_prefixes,
    raw_config_sections: managementCfg.config_sections,
    raw_config_profile: managementCfg.config_profile,
  });
  if (single) {
    credentials.push(single);
    sourceTokens.push("config");
  }

  const deduped = dedupeManagementCredentials(credentials);
  if (deduped.length === 0) {
    return { credentials: [], source: "none" };
  }
  return { credentials: deduped, source: sourceTokens.length > 0 ? sourceTokens.join("+") : "config" };
}

export function runCli(argv: string[]): number {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "build-credential": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      const credential = buildManagementCredential(payload);
      process.stdout.write(`${JSON.stringify({ credential })}\n`);
      return 0;
    }
    case "action-allowed": {
      const actionsRaw = parseJsonArg(requireOption(options, "payload"), "--payload").actions;
      const requiredAction = requireOption(options, "required-action");
      const actions = Array.isArray(actionsRaw)
        ? actionsRaw.filter((item): item is string => typeof item === "string")
        : [];
      process.stdout.write(`${JSON.stringify({ allowed: managementActionAllowed(actions, requiredAction) })}\n`);
      return 0;
    }
    case "resolve-credentials": {
      const config = parseJsonArg(requireOption(options, "config"), "--config");
      const overrideToken = options.get("override-token") ?? null;
      const resolved = resolveManagementCredentials(config, overrideToken);
      process.stdout.write(`${JSON.stringify(resolved)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("management-policy-contract");

if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`management-policy-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
