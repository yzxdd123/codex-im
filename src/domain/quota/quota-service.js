const { formatFailureText } = require("../../shared/error-text");
const { readLocalCodexModel } = require("../../infra/codex/model-state");

async function handleQuotaCommand(runtime, normalized) {
  const snapshot = await resolveQuotaSnapshot(runtime, normalized);
  await runtime.sendInfoCardMessage({
    chatId: normalized.chatId,
    replyToMessageId: normalized.messageId,
    text: runtime.buildQuotaStatusText(snapshot),
  });
}

async function resolveQuotaSnapshot(runtime, normalized) {
  const currentModel = resolveCurrentModel(runtime, normalized);
  try {
    const payload = await runtime.fetchQuotaUsage();
    return buildQuotaSnapshot(payload, currentModel);
  } catch (error) {
    return {
      model: currentModel,
      primaryRemainingPercent: null,
      primaryResetCountdown: "N/A",
      secondaryRemainingPercent: null,
      secondaryResetCountdown: "N/A",
      limitReached: null,
      creditsBalance: "N/A",
      errorText: formatFailureText("额度查询失败", error),
    };
  }
}

function buildQuotaSnapshot(payload, currentModel) {
  const rateLimit = payload && typeof payload === "object" ? payload.rate_limit || {} : {};
  const primaryWindow = rateLimit.primary_window || rateLimit.primaryWindow || {};
  const secondaryWindow = rateLimit.secondary_window || rateLimit.secondaryWindow || {};
  const creditsBalance =
    getStringValue(payload?.credits?.balance)
    || getStringValue(payload?.credits_balance)
    || getStringValue(payload?.credit_balance)
    || "N/A";

  return {
    model: resolveSnapshotModel(payload, currentModel),
    primaryRemainingPercent: toRemainingPercent(primaryWindow.used_percent ?? primaryWindow.usedPercent),
    primaryResetCountdown: formatCountdown(primaryWindow.reset_after_seconds ?? primaryWindow.resetAfterSeconds),
    secondaryRemainingPercent: toRemainingPercent(secondaryWindow.used_percent ?? secondaryWindow.usedPercent),
    secondaryResetCountdown: formatCountdown(secondaryWindow.reset_after_seconds ?? secondaryWindow.resetAfterSeconds),
    limitReached: Boolean(rateLimit.limit_reached ?? payload?.limit_reached ?? false),
    creditsBalance,
    errorText: "",
  };
}

function resolveCurrentModel(runtime, normalized) {
  const binding = runtime.getBindingContext(normalized);
  const workspaceRoot = binding?.workspaceRoot || "";
  if (workspaceRoot) {
    const current = runtime.getCodexParamsForWorkspace(binding.bindingKey, workspaceRoot);
    if (current?.model) {
      return current.model;
    }
  }
  const localModel = readLocalCodexModel(runtime.config.codexConfigPath).model;
  if (localModel) {
    return localModel;
  }
  return runtime.config.defaultCodexModel || "未知";
}

function resolveSnapshotModel(payload, currentModel) {
  const fallback = getStringValue(currentModel) || "未知";
  const fromPayload =
    getStringValue(payload?.model)
    || getStringValue(payload?.plan_type)
    || getStringValue(payload?.planType);
  return fromPayload || fallback;
}

function toRemainingPercent(usedPercent) {
  const used = Number(usedPercent);
  if (!Number.isFinite(used)) {
    return null;
  }
  return Math.max(0, 100 - Math.round(used));
}

function formatCountdown(seconds) {
  const totalSeconds = Number(seconds);
  if (!Number.isFinite(totalSeconds)) {
    return "N/A";
  }
  if (totalSeconds <= 0) {
    return "now";
  }

  let remaining = Math.floor(totalSeconds);
  const days = Math.floor(remaining / 86400);
  remaining -= days * 86400;
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);

  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function getStringValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "";
}

module.exports = {
  buildQuotaSnapshot,
  handleQuotaCommand,
  resolveQuotaSnapshot,
};
