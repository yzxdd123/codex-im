const fs = require("fs/promises");
const https = require("https");
const os = require("os");
const path = require("path");

const DEFAULT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_AUTH_FILE = path.join(os.homedir(), ".codex", "auth.json");

class CodexQuotaClient {
  constructor({
    authFilePath = DEFAULT_AUTH_FILE,
    usageUrl = DEFAULT_USAGE_URL,
    timeoutSeconds = 30,
    accessToken = "",
    accountId = "",
    env = process.env,
  } = {}) {
    this.authFilePath = String(authFilePath || "").trim() || DEFAULT_AUTH_FILE;
    this.usageUrl = String(usageUrl || "").trim() || DEFAULT_USAGE_URL;
    this.timeoutMilliseconds = Math.max(1, Number(timeoutSeconds) || 30) * 1000;
    this.overrideAccessToken = normalizeString(accessToken) || normalizeString(env?.CODEX_IM_QUOTA_ACCESS_TOKEN);
    this.overrideAccountId = normalizeString(accountId) || normalizeString(env?.CODEX_IM_QUOTA_ACCOUNT_ID);
  }

  async fetchUsage() {
    const auth = await this.loadAuth();
    return this.requestJson(this.usageUrl, auth);
  }

  async loadAuth() {
    if (this.overrideAccessToken) {
      return {
        accessToken: this.overrideAccessToken,
        accountId: this.overrideAccountId,
        source: "env",
      };
    }

    const raw = await fs.readFile(this.authFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const accessToken =
      normalizeString(parsed?.tokens?.access_token)
      || normalizeString(parsed?.OPENAI_API_KEY?.access_token)
      || normalizeString(parsed?.access_token);
    const accountId =
      this.overrideAccountId
      || normalizeString(parsed?.tokens?.account_id)
      || normalizeString(parsed?.OPENAI_API_KEY?.account_id)
      || normalizeString(parsed?.account_id);

    if (!accessToken) {
      throw new Error(`Codex auth file does not contain an access token: ${this.authFilePath}`);
    }

    return {
      accessToken,
      accountId,
      source: this.authFilePath,
    };
  }

  requestJson(url, auth) {
    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      "User-Agent": "CodexBar",
      Accept: "application/json",
    };
    if (auth.accountId) {
      headers["ChatGPT-Account-Id"] = auth.accountId;
    }

    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: "GET",
          headers,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let data = {};
            try {
              data = text ? JSON.parse(text) : {};
            } catch (error) {
              reject(new Error(`Invalid JSON response from quota endpoint: ${error.message}`));
              return;
            }

            if (response.statusCode && response.statusCode >= 400) {
              reject(new Error(`Quota endpoint HTTP ${response.statusCode}: ${truncateText(text, 300)}`));
              return;
            }

            const errcode = Number(data?.errcode || 0);
            if (errcode) {
              reject(new Error(data?.errmsg || `Quota endpoint failed (${errcode})`));
              return;
            }

            resolve(data);
          });
        }
      );

      request.on("error", (error) => {
        reject(new Error(`Quota endpoint request failed: ${error.message}`));
      });

      request.setTimeout(this.timeoutMilliseconds, () => {
        request.destroy(new Error(`Quota endpoint timeout after ${Math.round(this.timeoutMilliseconds / 1000)}s`));
      });

      request.end();
    });
  }
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function truncateText(text, maxLength) {
  const input = String(text || "");
  if (!Number.isFinite(maxLength) || maxLength <= 0 || input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}

module.exports = {
  CodexQuotaClient,
  DEFAULT_AUTH_FILE,
  DEFAULT_USAGE_URL,
};
