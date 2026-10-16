function extractBindPath(text) {
  return extractCommandArgument(text, "/codex bind ");
}

function extractSwitchThreadId(text) {
  return extractCommandArgument(text, "/codex switch ");
}

function extractRemoveWorkspacePath(text) {
  return extractCommandArgument(text, "/codex remove ");
}

function extractSendPath(text) {
  return extractCommandArgument(text, "/codex send ");
}

function extractModelValue(text) {
  return extractCommandArgument(text, "/codex model ");
}

function extractEffortValue(text) {
  return extractCommandArgument(text, "/codex effort ");
}

function extractCommandArgument(text, prefix) {
  const trimmed = normalizeCommandText(text);
  const normalizedPrefix = String(prefix || "").toLowerCase();
  if (trimmed.toLowerCase().startsWith(normalizedPrefix)) {
    return trimmed.slice(normalizedPrefix.length).trim();
  }
  return "";
}

function normalizeCommandText(text) {
  const original = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  if (!original) {
    return "";
  }

  const mentionStripped = stripLeadingMentionPrefix(original);
  if (mentionStripped !== original) {
    return mentionStripped.trim();
  }

  const codexIndex = original.toLowerCase().indexOf("/codex");
  if (codexIndex > 0) {
    const prefix = original.slice(0, codexIndex);
    if (looksLikeMentionLabel(prefix) || looksLikeMentionPrefix(prefix)) {
      return original.slice(codexIndex).trim();
    }
  }

  return original.trim();
}

function stripLeadingMentionPrefix(text) {
  const source = String(text || "").trim();
  if (!source) {
    return "";
  }

  const tagStripped = source.replace(/^(?:<at[^>]*>[\s\S]*?<\/at>\s*)+/gi, "").trim();
  if (tagStripped !== source) {
    return tagStripped;
  }

  const plainMentionStripped = source.replace(/^(?:[@\uFF20][^\s/]{1,64}\s*)+/gu, "").trim();
  if (plainMentionStripped !== source) {
    return plainMentionStripped;
  }

  return source;
}

function looksLikeMentionLabel(value) {
  const normalized = String(value || "")
    .replace(/[\s\u00A0\u3000]+/g, "")
    .trim();
  if (!normalized || normalized.length > 32) {
    return false;
  }

  return /^[\p{L}\p{N}_-]+$/u.test(normalized);
}

function looksLikeMentionPrefix(value) {
  const normalized = String(value || "")
    .replace(/[\s\u00A0\u3000]+/g, "")
    .trim();
  if (!normalized || normalized.length > 48) {
    return false;
  }

  return normalized.startsWith("@") || normalized.startsWith("\uFF20") || normalized.includes("<at");
}

module.exports = {
  extractBindPath,
  extractEffortValue,
  extractModelValue,
  extractRemoveWorkspacePath,
  extractSendPath,
  extractSwitchThreadId,
  normalizeCommandText,
};
