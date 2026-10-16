function extractErrorMessage(error, fallback = "unknown error") {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function formatFailureText(prefix, error, fallback = "unknown error") {
  return `${prefix}: ${extractErrorMessage(error, fallback)}`;
}

module.exports = {
  extractErrorMessage,
  formatFailureText,
};
