import {
  readEnvOptionalNonEmptyString,
  readExplicitOptionalNonEmptyString,
  type OptionValue,
} from "../cli-args";

export interface StatusRuntimeOverrides {
  providerOverrideFromCli?: string;
  modelFromCli?: string;
  baseUrlFromCli?: string;
  apiKeyFromCli?: string;
  providerOverrideFromEnv?: string;
  modelFromEnv?: string;
  baseUrlFromEnv?: string;
  apiKeyFromEnv?: string;
}

export function resolveStatusRuntimeOverrides(
  options: Record<string, OptionValue>,
  env: Record<string, string | undefined> = process.env,
): StatusRuntimeOverrides {
  return {
    providerOverrideFromCli: readExplicitOptionalNonEmptyString(options, "provider"),
    modelFromCli: readExplicitOptionalNonEmptyString(options, "model"),
    baseUrlFromCli: readExplicitOptionalNonEmptyString(options, "base-url"),
    apiKeyFromCli: readExplicitOptionalNonEmptyString(options, "api-key"),
    providerOverrideFromEnv: readEnvOptionalNonEmptyString(env, "GROBOT_PROVIDER", "provider"),
    modelFromEnv: readEnvOptionalNonEmptyString(env, "GROBOT_MODEL", "model"),
    baseUrlFromEnv: readEnvOptionalNonEmptyString(env, "GROBOT_BASE_URL", "base-url"),
    apiKeyFromEnv: readEnvOptionalNonEmptyString(env, "GROBOT_API_KEY", "api-key"),
  };
}
