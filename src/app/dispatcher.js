const messageNormalizers = require("../presentation/message/normalizers");
const { formatFailureText } = require("../shared/error-text");
const eventsRuntime = require("./codex-event-service");

async function onWecomTextEvent(runtime, event) {
  const normalized = messageNormalizers.normalizeWecomTextMessage(event, runtime.config);
  if (normalized) {
    console.log("[codex-im] wecom normalized message", {
      chatId: normalized.chatId,
      chatType: normalized.chatType,
      command: normalized.command,
      text: normalized.text,
      senderId: normalized.senderId,
      messageId: normalized.messageId,
    });
  }
  await onNormalizedTextEvent(runtime, normalized, {
    missingWorkspaceText: "当前会话还未绑定项目。先发送 `/codex bind /绝对路径`。",
  });
}

async function onNormalizedTextEvent(runtime, normalized, { missingWorkspaceText }) {
  if (!normalized) {
    return;
  }

  if (await runtime.dispatchTextCommand(normalized)) {
    return;
  }

  const workspaceContext = await runtime.resolveWorkspaceContext(normalized, {
    replyToMessageId: normalized.messageId,
    missingWorkspaceText,
  });
  if (!workspaceContext) {
    return;
  }
  const { bindingKey, workspaceRoot } = workspaceContext;
  const { threadId } = await runtime.resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
  });

  runtime.setPendingBindingContext(bindingKey, normalized);
  if (threadId) {
    runtime.setPendingThreadContext(threadId, normalized);
  }

  await runtime.addPendingReaction(bindingKey, normalized.messageId);

  try {
    const resolvedThreadId = await runtime.ensureThreadAndSendMessage({
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
    });
    runtime.movePendingReactionToThread(bindingKey, resolvedThreadId);
  } catch (error) {
    await runtime.clearPendingReactionForBinding(bindingKey);
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: formatFailureText("处理失败", error),
    });
    throw error;
  }
}

function onCodexMessage(runtime, message) {
  eventsRuntime.handleCodexMessage(runtime, message);
}

module.exports = {
  onCodexMessage,
  onWecomTextEvent,
};
