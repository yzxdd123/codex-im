const fs = require("fs");
const crypto = require("crypto");
const WebSocket = require("ws");

const { readConfig } = require("../infra/config/config");
const { SessionStore } = require("../infra/storage/session-store");
const { CodexRpcClient } = require("../infra/codex/rpc-client");
const { CodexQuotaClient } = require("../infra/codex/quota-client");
const {
  buildApprovalRequestText,
  buildCardResponse,
  buildCardToast,
  buildEffortInfoText,
  buildEffortListText,
  buildEffortValidationErrorText,
  buildHelpCardText,
  buildModelInfoText,
  buildModelListText,
  buildModelValidationErrorText,
  buildQuotaStatusText,
  buildStatusPanelCard,
  buildStatusPanelText,
  buildThreadMessagesSummary,
  buildThreadPickerCard,
  buildThreadPickerText,
  buildWorkspaceBindingsCard,
  buildWorkspaceBindingsText,
  listBoundWorkspaces,
} = require("../presentation/card/builders");
const {
  addPendingReaction,
  clearPendingReactionForBinding,
  clearPendingReactionForThread,
  disposeReplyRunState,
  movePendingReactionToThread,
  patchInteractiveCard,
  sendInfoCardMessage,
  sendInteractiveApprovalCard,
  sendInteractiveCard,
  updateInteractiveCard,
  upsertAssistantReplyCard,
} = require("../presentation/card/card-service");
const runtimeCommands = require("./command-dispatcher");
const approvalRuntime = require("../domain/approval/approval-service");
const runtimeState = require("../domain/session/binding-context");
const threadRuntime = require("../domain/thread/thread-service");
const workspaceRuntime = require("../domain/workspace/workspace-service");
const eventsRuntime = require("./codex-event-service");
const approvalPolicyRuntime = require("../domain/approval/approval-policy");
const appDispatcher = require("./dispatcher");
const { extractModelCatalogFromListResponse } = require("../shared/model-catalog");

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
const SOCKET_REQUEST_TIMEOUT_MS = 30_000;

class WecomBotRuntime {
  constructor(config = readConfig()) {
    this.config = config;
    this.sessionStore = new SessionStore({ filePath: config.sessionsFile });
    this.codex = new CodexRpcClient({
      endpoint: config.codexEndpoint,
      env: process.env,
      codexCommand: config.codexCommand,
    });
    this.quotaClient = new CodexQuotaClient({
      authFilePath: config.quotaAuthFilePath,
      usageUrl: config.quotaUsageUrl,
      timeoutSeconds: config.quotaRequestTimeoutSeconds,
      accessToken: config.quotaAccessToken,
      accountId: config.quotaAccountId,
      env: process.env,
    });
    this.socket = null;
    this.socketReady = false;
    this.isStopping = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pendingSocketRequests = new Map();
    this.latestReqIdByChatId = new Map();
    this.pendingChatContextByThreadId = new Map();
    this.pendingChatContextByBindingKey = new Map();
    this.activeTurnIdByThreadId = new Map();
    this.pendingApprovalByThreadId = new Map();
    this.replyCardByRunKey = new Map();
    this.currentRunKeyByThreadId = new Map();
    this.replyFlushTimersByRunKey = new Map();
    this.assistantItemPhaseByItemId = new Map();
    this.pendingReactionByBindingKey = new Map();
    this.pendingReactionByThreadId = new Map();
    this.bindingKeyByThreadId = new Map();
    this.workspaceRootByThreadId = new Map();
    this.approvalAllowlistByWorkspaceRoot = new Map();
    this.inFlightApprovalRequestKeys = new Set();
    this.resumedThreadIds = new Set();
    this.codex.onMessage((message) => appDispatcher.onCodexMessage(this, message));
  }

  async start() {
    this.validateConfig();
    await this.codex.connect();
    await this.codex.initialize();
    await this.refreshAvailableModelCatalogAtStartup();
    await this.connectSocketUntilReady();
    console.log(`[codex-im] wecom-bot runtime ready via ${this.config.wecom.wsEndpoint}`);
  }

  async stop() {
    this.isStopping = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.socketReady = false;

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  async fetchQuotaUsage() {
    return this.quotaClient.fetchUsage();
  }

  validateConfig() {
    const missing = [];
    if (!this.config.wecom.botId) missing.push("WECOM_BOT_ID");
    if (!this.config.wecom.botSecret) missing.push("WECOM_BOT_SECRET");
    if (!String(this.config.defaultCodexModel || "").trim()) missing.push("CODEX_IM_DEFAULT_CODEX_MODEL");
    if (!String(this.config.defaultCodexEffort || "").trim()) missing.push("CODEX_IM_DEFAULT_CODEX_EFFORT");
    if (!String(this.config.defaultCodexAccessMode || "").trim()) {
      missing.push("CODEX_IM_DEFAULT_CODEX_ACCESS_MODE");
    }
    if (missing.length) {
      throw new Error(`Missing required config for wecom-bot: ${missing.join(", ")}`);
    }
  }

  async connectSocket() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady) {
      return;
    }

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.config.wecom.wsEndpoint);
      this.socket = socket;

      const cleanup = () => {
        socket.off("open", handleOpen);
        socket.off("error", handleError);
      };

      const handleOpen = async () => {
        cleanup();
        this.attachSocketEventHandlers(socket);
        try {
          console.log(`[codex-im] WeCom websocket opened: ${this.config.wecom.wsEndpoint}`);
          await this.subscribeSocket();
          this.socketReady = true;
          this.startHeartbeat();
          console.log("[codex-im] WeCom websocket subscribed successfully");
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      const handleError = (error) => {
        cleanup();
        reject(error);
      };

      socket.once("open", handleOpen);
      socket.once("error", handleError);
    });
  }

  async connectSocketUntilReady() {
    while (!this.isStopping) {
      try {
        await this.connectSocket();
        return;
      } catch (error) {
        this.socketReady = false;
        try {
          this.socket?.close();
        } catch {
          // ignore close failures while retrying startup
        }
        this.socket = null;
        console.error(`[codex-im] failed to initialize WeCom websocket, retrying in ${RECONNECT_DELAY_MS}ms: ${error.message}`);
        await delay(RECONNECT_DELAY_MS);
      }
    }
  }

  attachSocketEventHandlers(socket) {
    socket.on("message", (chunk) => {
      this.handleSocketMessage(chunk).catch((error) => {
        console.error(`[codex-im] failed to handle WeCom websocket message: ${error.message}`);
      });
    });

    socket.on("close", () => {
      this.socketReady = false;
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.rejectPendingSocketRequests(new Error("WeCom websocket closed"));
      if (!this.isStopping) {
        this.scheduleReconnect();
      }
    });

    socket.on("error", (error) => {
      console.error(`[codex-im] WeCom websocket error: ${error.message}`);
    });
  }

  async subscribeSocket() {
    await this.sendSocketCommand("aibot_subscribe", {
      bot_id: this.config.wecom.botId,
      secret: this.config.wecom.botSecret,
    });
  }

  startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.sendSocketCommand("ping", {}, { expectReply: false }).catch((error) => {
        console.error(`[codex-im] failed to send WeCom heartbeat: ${error.message}`);
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.isStopping) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket().catch((error) => {
        console.error(`[codex-im] failed to reconnect WeCom websocket: ${error.message}`);
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }

  async handleSocketMessage(chunk) {
    const raw = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    const payload = tryParseJson(raw);
    if (!payload) {
      console.warn(`[codex-im] ignored non-json WeCom websocket frame: ${raw.slice(0, 200)}`);
      return;
    }

    const reqId = normalizeString(payload?.headers?.req_id);
    if (reqId && this.pendingSocketRequests.has(reqId) && payload.errcode != null) {
      const pending = this.pendingSocketRequests.get(reqId);
      this.pendingSocketRequests.delete(reqId);
      clearTimeout(pending.timeout);
      if (Number(payload.errcode || 0) === 0) {
        pending.resolve(payload);
      } else {
        pending.reject(new Error(`WeCom ${payload.cmd || "command"} failed (${payload.errcode}): ${payload.errmsg || "unknown error"}`));
      }
      return;
    }

    const cmd = normalizeString(payload.cmd).toLowerCase();
    if (cmd === "aibot_msg_callback") {
      const chatId = normalizeString(payload?.body?.chatid) || normalizeString(payload?.body?.from?.userid);
      if (chatId && reqId) {
        this.latestReqIdByChatId.set(chatId, reqId);
      }
      await appDispatcher.onWecomTextEvent(this, payload);
      return;
    }

    if (cmd === "aibot_event_callback") {
      await this.handleWecomEventCallback(payload);
      return;
    }
  }

  async handleWecomEventCallback(payload) {
    const eventType = normalizeString(payload?.body?.event?.eventtype).toLowerCase();
    const reqId = normalizeString(payload?.headers?.req_id);
    const chatId = normalizeString(payload?.body?.chatid) || normalizeString(payload?.body?.from?.userid);
    if (chatId && reqId) {
      this.latestReqIdByChatId.set(chatId, reqId);
    }

    if (eventType === "enter_chat") {
      try {
        await this.sendWelcomeMessage({
          reqId,
          text: "已连接到本地 Codex。先发 `/codex bind /绝对路径` 绑定项目，然后就可以直接继续对话。",
        });
      } catch (error) {
        console.error(`[codex-im] failed to send welcome message: ${error.message}`);
      }
      return;
    }

    if (eventType === "disconnected_event" && !this.isStopping) {
      try {
        this.socket?.close();
      } catch {
        // ignore close failures
      }
    }
  }

  async sendSocketCommand(cmd, body = {}, { reqId = "", expectReply = true } = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.ensureSocketReady();
    }
    const resolvedReqId = reqId || createRequestId();
    const payload = {
      cmd,
      headers: {
        req_id: resolvedReqId,
      },
    };
    if (body && Object.keys(body).length > 0) {
      payload.body = body;
    }

    const raw = JSON.stringify(payload);
    if (!expectReply) {
      this.socket.send(raw);
      return null;
    }

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSocketRequests.delete(resolvedReqId);
        reject(new Error(`WeCom ${cmd} timed out after ${SOCKET_REQUEST_TIMEOUT_MS}ms`));
      }, SOCKET_REQUEST_TIMEOUT_MS);
      this.pendingSocketRequests.set(resolvedReqId, { resolve, reject, timeout });
    });

    this.socket.send(raw);
    return responsePromise;
  }

  async ensureSocketReady() {
    if (!this.socketReady || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.connectSocket();
    }
  }

  rejectPendingSocketRequests(error) {
    for (const [reqId, pending] of this.pendingSocketRequests.entries()) {
      this.pendingSocketRequests.delete(reqId);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  async refreshAvailableModelCatalogAtStartup() {
    const response = await this.codex.listModels();
    const models = extractModelCatalogFromListResponse(response);
    if (!models.length) {
      throw new Error("model/list returned no models at startup");
    }
    this.sessionStore.setAvailableModelCatalog(models);
    const validatedDefaults = workspaceRuntime.validateDefaultCodexParamsConfig(this, models);
    if (!validatedDefaults.model) {
      throw new Error(`Invalid CODEX_IM_DEFAULT_CODEX_MODEL: ${this.config.defaultCodexModel}`);
    }
    if (!validatedDefaults.effort) {
      throw new Error(
        `Invalid CODEX_IM_DEFAULT_CODEX_EFFORT: ${this.config.defaultCodexEffort} for model ${validatedDefaults.model}`
      );
    }
    console.log(`[codex-im] model catalog refreshed at startup: ${models.length} entries`);
  }

  resolveReplyToMessageId(normalized, replyToMessageId = "") {
    return replyToMessageId || normalized?.reqId || normalized?.messageId || "";
  }

  getBindingContext(normalized) {
    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    const workspaceRoot = this.resolveWorkspaceRootForBinding(bindingKey);
    return { bindingKey, workspaceRoot };
  }

  getCurrentThreadContext(normalized) {
    const { bindingKey, workspaceRoot } = this.getBindingContext(normalized);
    const threadId = workspaceRoot ? this.resolveThreadIdForBinding(bindingKey, workspaceRoot) : "";
    return { bindingKey, workspaceRoot, threadId };
  }

  supportsInteractiveCards() {
    return false;
  }

  requireMessagingAdapter() {
    if (!this.messagingAdapter) {
      this.messagingAdapter = {
        sendInteractiveCard: async ({ chatId, card, replyToMessageId = "" }) => this.sendTextMessage({
          chatId,
          text: extractPlainTextFromCard(card),
          replyToMessageId,
        }),
        patchInteractiveCard: async ({ messageId, card }) => this.sendTextMessage({
          chatId: "",
          text: extractPlainTextFromCard(card),
          replyToMessageId: messageId,
        }),
        sendFileMessage: async () => {
          throw new Error("WeCom long connection file reply is not implemented yet");
        },
        createReaction: async () => ({
          data: {
            reaction_id: "wecom-noop-reaction",
          },
        }),
        deleteReaction: async () => null,
      };
    }
    return this.messagingAdapter;
  }

  shouldStreamReplies() {
    return !!this.config.wecom.streamingOutput;
  }

  getPlatformLabel() {
    return "企业微信";
  }

  getMaxUploadFileBytes() {
    return this.config.wecom.maxFileSizeBytes;
  }

  async sendTextMessage({ chatId, text, replyToMessageId = "" }) {
    if (!chatId || !text) {
      return null;
    }

    const reqId = normalizeString(replyToMessageId) || this.latestReqIdByChatId.get(chatId) || "";
    if (!reqId) {
      throw new Error("WeCom long connection reply requires req_id");
    }

    return this.sendSocketCommand("aibot_respond_msg", {
      msgtype: "stream",
      stream: {
        id: createStreamId(),
        finish: true,
        content: String(text),
      },
    }, { reqId });
  }

  async sendWelcomeMessage({ reqId, text }) {
    const resolvedReqId = normalizeString(reqId);
    if (!resolvedReqId || !text) {
      return null;
    }
    return this.sendSocketCommand("aibot_respond_welcome_msg", {
      msgtype: "text",
      text: {
        content: String(text),
      },
    }, { reqId: resolvedReqId });
  }

  async sendFileMessage() {
    throw new Error("WeCom long connection file reply is not implemented yet");
  }

  async resolveWorkspaceStats(workspaceRoot) {
    try {
      const stats = await fs.promises.stat(workspaceRoot);
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return { exists: false, isDirectory: false };
      }
      throw error;
    }
  }
}

function attachRuntimeForwarders() {
  const proto = WecomBotRuntime.prototype;

  const plainForwarders = {
    buildApprovalRequestText,
    buildCardResponse,
    buildCardToast,
    buildEffortInfoText,
    buildEffortListText,
    buildEffortValidationErrorText,
    buildHelpCardText,
    buildModelInfoText,
    buildModelListText,
    buildModelValidationErrorText,
    buildQuotaStatusText,
    buildStatusPanelCard,
    buildStatusPanelText,
    buildThreadMessagesSummary,
    buildThreadPickerCard,
    buildThreadPickerText,
    buildWorkspaceBindingsCard,
    buildWorkspaceBindingsText,
    listBoundWorkspaces,
  };

  for (const [methodName, fn] of Object.entries(plainForwarders)) {
    proto[methodName] = function forwardedPlain(...args) {
      return fn(...args);
    };
  }

  const runtimeFirstForwarders = {
    dispatchTextCommand: runtimeCommands.dispatchTextCommand,
    resolveWorkspaceContext: workspaceRuntime.resolveWorkspaceContext,
    resolveWorkspaceThreadState: threadRuntime.resolveWorkspaceThreadState,
    ensureThreadAndSendMessage: threadRuntime.ensureThreadAndSendMessage,
    ensureThreadResumed: threadRuntime.ensureThreadResumed,
    resolveWorkspaceRootForBinding: runtimeState.resolveWorkspaceRootForBinding,
    resolveThreadIdForBinding: runtimeState.resolveThreadIdForBinding,
    setThreadBindingKey: runtimeState.setThreadBindingKey,
    setThreadWorkspaceRoot: runtimeState.setThreadWorkspaceRoot,
    setPendingBindingContext: runtimeState.setPendingBindingContext,
    setPendingThreadContext: runtimeState.setPendingThreadContext,
    setReplyCardEntry: runtimeState.setReplyCardEntry,
    setCurrentRunKeyForThread: runtimeState.setCurrentRunKeyForThread,
    resolveWorkspaceRootForThread: runtimeState.resolveWorkspaceRootForThread,
    rememberApprovalPrefixForWorkspace: approvalPolicyRuntime.rememberApprovalPrefixForWorkspace,
    shouldAutoApproveRequest: approvalPolicyRuntime.shouldAutoApproveRequest,
    tryAutoApproveRequest: approvalPolicyRuntime.tryAutoApproveRequest,
    applyApprovalDecision: approvalRuntime.applyApprovalDecision,
    handleBindCommand: workspaceRuntime.handleBindCommand,
    handleWhereCommand: workspaceRuntime.handleWhereCommand,
    showStatusPanel: workspaceRuntime.showStatusPanel,
    handleMessageCommand: workspaceRuntime.handleMessageCommand,
    handleHelpCommand: workspaceRuntime.handleHelpCommand,
    handleQuotaCommand: workspaceRuntime.handleQuotaCommand,
    handleUnknownCommand: workspaceRuntime.handleUnknownCommand,
    handleWorkspacesCommand: workspaceRuntime.handleWorkspacesCommand,
    showThreadPicker: workspaceRuntime.showThreadPicker,
    handleNewCommand: threadRuntime.handleNewCommand,
    handleSwitchCommand: threadRuntime.handleSwitchCommand,
    handleRemoveCommand: workspaceRuntime.handleRemoveCommand,
    handleSendCommand: workspaceRuntime.handleSendCommand,
    handleModelCommand: workspaceRuntime.handleModelCommand,
    handleEffortCommand: workspaceRuntime.handleEffortCommand,
    refreshWorkspaceThreads: threadRuntime.refreshWorkspaceThreads,
    describeWorkspaceStatus: threadRuntime.describeWorkspaceStatus,
    switchThreadById: threadRuntime.switchThreadById,
    handleStopCommand: eventsRuntime.handleStopCommand,
    handleApprovalCommand: approvalRuntime.handleApprovalCommand,
    deliverProviderEvent: eventsRuntime.deliverProviderEvent,
    sendInfoCardMessage,
    sendInteractiveApprovalCard,
    sendInteractiveCard,
    updateInteractiveCard,
    patchInteractiveCard,
    switchWorkspaceByPath: workspaceRuntime.switchWorkspaceByPath,
    removeWorkspaceByPath: workspaceRuntime.removeWorkspaceByPath,
    upsertAssistantReplyCard,
    addPendingReaction,
    movePendingReactionToThread,
    clearPendingReactionForBinding,
    clearPendingReactionForThread,
    disposeReplyRunState,
    cleanupThreadRuntimeState: runtimeState.cleanupThreadRuntimeState,
    pruneRuntimeMapSizes: runtimeState.pruneRuntimeMapSizes,
  };

  for (const [methodName, fn] of Object.entries(runtimeFirstForwarders)) {
    proto[methodName] = function forwardedRuntimeFirst(...args) {
      return fn(this, ...args);
    };
  }

  proto.getCodexParamsForWorkspace = function getCodexParamsForWorkspace(bindingKey, workspaceRoot) {
    return this.sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  };
}

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStreamId() {
  return createRequestId();
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPlainTextFromCard(card) {
  const lines = [];
  const elements = card?.body?.elements || [];
  for (const element of elements) {
    if (typeof element?.content === "string" && element.content.trim()) {
      lines.push(stripMarkdownFormatting(element.content));
    }
  }
  return lines.filter(Boolean).join("\n\n").trim() || "提示";
}

function stripMarkdownFormatting(text) {
  return String(text || "")
    .replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

attachRuntimeForwarders();

module.exports = { WecomBotRuntime };

