class WecomApiClient {
  constructor({ corpId, agentId, appSecret, apiBase }) {
    this.corpId = String(corpId || "").trim();
    this.agentId = String(agentId || "").trim();
    this.appSecret = String(appSecret || "").trim();
    this.apiBase = String(apiBase || "https://qyapi.weixin.qq.com").replace(/\/+$/g, "");
    this.cachedAccessToken = "";
    this.accessTokenExpiresAt = 0;
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && this.cachedAccessToken && now < this.accessTokenExpiresAt) {
      return this.cachedAccessToken;
    }

    const url = new URL(`${this.apiBase}/cgi-bin/gettoken`);
    url.searchParams.set("corpid", this.corpId);
    url.searchParams.set("corpsecret", this.appSecret);
    const response = await fetchJson(url.toString());
    assertWecomOk(response, "gettoken");

    this.cachedAccessToken = normalizeString(response.access_token);
    const expiresIn = Number(response.expires_in || 7200);
    this.accessTokenExpiresAt = now + Math.max(60, expiresIn - 120) * 1000;
    return this.cachedAccessToken;
  }

  async sendTextMessage({ toUser, content }) {
    return this.sendMessage({
      touser: normalizeString(toUser),
      msgtype: "text",
      text: {
        content: String(content || ""),
      },
    });
  }

  async uploadFile({ fileName, fileBuffer }) {
    const accessToken = await this.getAccessToken();
    const url = new URL(`${this.apiBase}/cgi-bin/media/upload`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("type", "file");

    const form = new FormData();
    form.append(
      "media",
      new Blob([fileBuffer], { type: "application/octet-stream" }),
      normalizeString(fileName) || "file"
    );

    const response = await fetchJson(url.toString(), {
      method: "POST",
      body: form,
    });
    assertWecomOk(response, "media/upload");
    return normalizeString(response.media_id);
  }

  async sendFileMessage({ toUser, mediaId }) {
    return this.sendMessage({
      touser: normalizeString(toUser),
      msgtype: "file",
      file: {
        media_id: normalizeString(mediaId),
      },
    });
  }

  async sendMessage(payload) {
    const accessToken = await this.getAccessToken();
    const url = new URL(`${this.apiBase}/cgi-bin/message/send`);
    url.searchParams.set("access_token", accessToken);

    const response = await fetchJson(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentid: Number.isFinite(Number(this.agentId)) ? Number(this.agentId) : this.agentId,
        safe: 0,
        enable_duplicate_check: 0,
        ...payload,
      }),
    });
    assertWecomOk(response, "message/send");
    return response;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Invalid JSON response from WeCom API: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`WeCom API HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

function assertWecomOk(response, operation) {
  const errcode = Number(response?.errcode || 0);
  if (errcode === 0) {
    return;
  }
  const errmsg = normalizeString(response?.errmsg) || "unknown error";
  throw new Error(`WeCom ${operation} failed (${errcode}): ${errmsg}`);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  WecomApiClient,
};
