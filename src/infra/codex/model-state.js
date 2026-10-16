const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_CODEX_CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");

function readLocalCodexModel(configPath = DEFAULT_CODEX_CONFIG_PATH) {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const model = extractTomlStringValue(raw, "model");
    const effort = extractTomlStringValue(raw, "model_reasoning_effort");
    return {
      model,
      effort,
      configPath,
    };
  } catch {
    return {
      model: "",
      effort: "",
      configPath,
    };
  }
}

function extractTomlStringValue(source, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']\\s*$`, "mi");
  const match = String(source || "").match(pattern);
  return match ? String(match[1] || "").trim() : "";
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  DEFAULT_CODEX_CONFIG_PATH,
  readLocalCodexModel,
};
