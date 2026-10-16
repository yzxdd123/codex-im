const crypto = require("crypto");

function createWecomCrypto({ token, aesKey, receiveId }) {
  const normalizedToken = String(token || "").trim();
  const normalizedReceiveId = String(receiveId || "").trim();
  const aesBuffer = Buffer.from(`${String(aesKey || "").trim()}=`, "base64");
  if (aesBuffer.length !== 32) {
    throw new Error("Invalid WECOM_AES_KEY: expected 43-char EncodingAESKey");
  }

  return {
    decrypt(encrypted) {
      const normalizedEncrypted = String(encrypted || "").trim();
      if (!normalizedEncrypted) {
        throw new Error("Missing encrypted payload");
      }

      const encryptedBuffer = Buffer.from(normalizedEncrypted, "base64");
      const decipher = crypto.createDecipheriv("aes-256-cbc", aesBuffer, aesBuffer.subarray(0, 16));
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
      const plainBuffer = pkcs7Unpad(decrypted);
      const content = unpackPayload(plainBuffer, normalizedReceiveId);
      return content;
    },
    verifySignature({ timestamp, nonce, encrypted, signature }) {
      const expected = buildSignature({
        token: normalizedToken,
        timestamp,
        nonce,
        encrypted,
      });
      return expected === String(signature || "").trim();
    },
  };
}

function buildSignature({ token, timestamp, nonce, encrypted }) {
  return crypto
    .createHash("sha1")
    .update([token, String(timestamp || ""), String(nonce || ""), String(encrypted || "")]
      .sort()
      .join(""), "utf8")
    .digest("hex");
}

function pkcs7Unpad(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Invalid encrypted payload");
  }

  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 32) {
    throw new Error("Invalid PKCS7 padding");
  }
  return buffer.subarray(0, buffer.length - pad);
}

function unpackPayload(buffer, expectedReceiveId) {
  if (buffer.length < 20) {
    throw new Error("Invalid decrypted payload");
  }

  const messageLength = buffer.readUInt32BE(16);
  const xmlStart = 20;
  const xmlEnd = xmlStart + messageLength;
  if (xmlEnd > buffer.length) {
    throw new Error("Invalid decrypted payload length");
  }

  const xml = buffer.subarray(xmlStart, xmlEnd).toString("utf8");
  const receiveId = buffer.subarray(xmlEnd).toString("utf8");
  if (expectedReceiveId && receiveId && receiveId !== expectedReceiveId) {
    throw new Error("ReceiveId mismatch in encrypted payload");
  }

  return {
    xml,
    receiveId,
  };
}

module.exports = {
  buildSignature,
  createWecomCrypto,
};
