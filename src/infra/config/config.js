const path = require("path");
const os = require("os");

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_ENV_VALUES = new Set(["0", "false", "no", "off"]);
const ALLOWED_ACCESS_MODES = new Set(["default", "full-access"]);

function readConfig() {
  const mode = process.argv[2] || "";
  const wecomMaxFileSizeMb = readNumberEnv("CODEX_IM_WECOM_MAX_FILE_SIZE_MB", 20);

  return {
    mode,
    workspaceAllowlist: readListEnv("CODEX_IM_WORKSPACE_ALLOWLIST"),
    codexEndpoint: process.env.CODEX_IM_CODEX_ENDPOINT || "",
    codexCommand: process.env.CODEX_IM_CODEX_COMMAND || "",
    defaultCodexModel: readTextEnv("CODEX_IM_DEFAULT_CODEX_MODEL"),
    defaultCodexEffort: readTextEnv("CODEX_IM_DEFAULT_CODEX_EFFORT"),
    defaultCodexAccessMode: readAccessModeEnv("CODEX_IM_DEFAULT_CODEX_ACCESS_MODE"),
    defaultWorkspaceId: process.env.CODEX_IM_DEFAULT_WORKSPACE_ID || "default",
    codexConfigPath: process.env.CODEX_IM_CODEX_CONFIG_FILE
      || path.join(os.homedir(), ".codex", "config.toml"),
    quotaAuthFilePath: process.env.CODEX_IM_QUOTA_AUTH_FILE
      || path.join(os.homedir(), ".codex", "auth.json"),
    quotaUsageUrl: process.env.CODEX_IM_QUOTA_USAGE_URL || "https://chatgpt.com/backend-api/wham/usage",
    quotaRequestTimeoutSeconds: readNumberEnv("CODEX_IM_QUOTA_TIMEOUT_SECONDS", 30),
    quotaAccessToken: readTextEnv("CODEX_IM_QUOTA_ACCESS_TOKEN"),
    quotaAccountId: readTextEnv("CODEX_IM_QUOTA_ACCOUNT_ID"),
    wecom: {
      botId: readTextEnv("WECOM_BOT_ID"),
      botSecret: readTextEnv("WECOM_BOT_SECRET") || readTextEnv("WECOM_SECRET"),
      wsEndpoint: readTextEnv("WECOM_WS_ENDPOINT") || "wss://openws.work.weixin.qq.com",
      streamingOutput: readBooleanEnv("CODEX_IM_WECOM_STREAMING_OUTPUT", false),
      maxFileSizeBytes: Math.max(1, wecomMaxFileSizeMb) * 1024 * 1024,
    },
    sessionsFile: process.env.CODEX_IM_SESSIONS_FILE
      || path.join(os.homedir(), ".codex-im", "sessions.json"),
  };
}

function readListEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBooleanEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

function readTextEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function readNumberEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return defaultValue;
  }
  const parsed = Number(rawValue.trim());
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readAccessModeEnv(name) {
  const value = readTextEnv(name).toLowerCase();
  return ALLOWED_ACCESS_MODES.has(value) ? value : "";
}

module.exports = { readConfig };
