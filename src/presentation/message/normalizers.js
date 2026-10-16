const codexMessageUtils = require("../../infra/codex/message-utils");
const { normalizeCommandText } = require("../../shared/command-parsing");

function normalizeWecomTextMessage(message, config) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const body = message.body && typeof message.body === "object" ? message.body : message;
  const cmd = normalizeIdentifier(message.cmd).toLowerCase();
  const msgType = normalizeIdentifier(body.msgtype || message.MsgType).toLowerCase();
  if (cmd && cmd !== "aibot_msg_callback") {
    return null;
  }
  if (msgType !== "text") {
    return null;
  }

  const text = normalizeWecomTextContent(body);
  if (!text) {
    return null;
  }

  const senderId = normalizeIdentifier(body?.from?.userid || body.FromUserName);
  const chatId = normalizeIdentifier(body.chatid || body.ChatId) || senderId;
  const threadKey = normalizeIdentifier(body.chatid || body.ChatId)
    || normalizeIdentifier(body.conversation_id || body.ConversationId)
    || normalizeIdentifier(body.ExternalUserID)
    || "";
  const messageId = normalizeIdentifier(message?.headers?.req_id)
    || normalizeIdentifier(body.msgid || message.MsgId)
    || `${normalizeIdentifier(body.create_time || message.CreateTime) || Date.now()}:${senderId}`;

  return {
    provider: "wecom",
    workspaceId: config.defaultWorkspaceId,
    chatId,
    threadKey,
    senderId,
    messageId,
    text,
    command: parseCommand(text),
    receivedAt: new Date().toISOString(),
    reqId: normalizeIdentifier(message?.headers?.req_id),
    sourceMessageId: normalizeIdentifier(body.msgid || message.MsgId),
    chatType: normalizeIdentifier(body.chattype || ""),
    raw: message,
  };
}

function mapCodexMessageToImEvent(message) {
  return codexMessageUtils.mapCodexMessageToImEvent(message);
}

function parseCommand(text) {
  const normalized = text.trim().toLowerCase();
  const prefixes = ["/codex "];
  const exactPrefixes = ["/codex"];

  const exactCommands = {
    stop: ["stop"],
    where: ["where"],
    inspect_message: ["message"],
    help: ["help"],
    workspace: ["workspace"],
    remove: ["remove"],
    send: ["send"],
    new: ["new"],
    model: ["model"],
    quota: ["quota", "status"],
    effort: ["effort"],
    approve: ["approve", "approve workspace"],
    reject: ["reject"],
  };

  for (const [command, suffixes] of Object.entries(exactCommands)) {
    if (matchesExactCommand(normalized, suffixes)) {
      return command;
    }
  }

  if (matchesPrefixCommand(normalized, "switch")) {
    return "switch";
  }
  if (matchesPrefixCommand(normalized, "remove")) {
    return "remove";
  }
  if (matchesPrefixCommand(normalized, "send")) {
    return "send";
  }
  if (matchesPrefixCommand(normalized, "bind")) {
    return "bind";
  }
  if (matchesPrefixCommand(normalized, "model")) {
    return "model";
  }
  if (matchesQuotaQuery(normalized)) {
    return "quota";
  }
  if (matchesPrefixCommand(normalized, "effort")) {
    return "effort";
  }
  if (prefixes.some((prefix) => normalized.startsWith(prefix))) {
    return "unknown_command";
  }
  if (exactPrefixes.includes(normalized)) {
    return "unknown_command";
  }
  if (text.trim()) {
    return "message";
  }

  return "";
}

function matchesExactCommand(text, suffixes) {
  return suffixes.some((suffix) => text === `/codex ${suffix}`);
}

function matchesPrefixCommand(text, command) {
  return text.startsWith(`/codex ${command} `);
}

function matchesQuotaQuery(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const compact = normalized.replace(/\s+/g, "");
  if (compact.includes("quota")) {
    return true;
  }

  const hasModelKeyword = /(模型|model)/i.test(normalized);
  const modelQuestion = /(你|当前|目前|现在|此刻).*(什么|哪个|哪一个).*(模型|model)|(?:模型|model).*(你|当前|目前|现在|此刻)/i.test(normalized);
  const englishModelQuestion = /\b(what|which|current|now|your)\b.*\b(model|model id)\b|\b(model|model id)\b.*\b(what|current|now|your)\b/i.test(normalized);
  if (hasModelKeyword && (modelQuestion || englishModelQuestion)) {
    return true;
  }

  const quotaKeyword = /(额度|用量|剩余|周|5h|limit|配额|触顶|快没|没了|用完|余量|次数)/i.test(normalized);
  const quotaQuestion = /(多少|还剩|剩余|快没|没了|触顶|用完|多久|什么时候|reset|多久会恢复)/i.test(normalized);
  const englishQuotaQuestion = /\b(how much|how many|remaining|left|quota|usage|credits|balance|limit|reset|time left)\b/i.test(normalized);
  return (quotaKeyword && quotaQuestion) || englishQuotaQuestion;
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeWecomTextContent(messageBody) {
  const direct = normalizeIdentifier(messageBody.Content);
  if (direct) {
    return normalizeWecomContentText(direct);
  }
  const nested = normalizeIdentifier(messageBody?.text?.content);
  if (!nested) {
    return "";
  }
  return normalizeWecomContentText(nested);
}

function normalizeWecomContentText(text) {
  return normalizeCommandText(String(text || "").replace(/\u00A0/g, " "));
}

module.exports = {
  mapCodexMessageToImEvent,
  matchesQuotaQuery,
  normalizeWecomTextMessage,
};
