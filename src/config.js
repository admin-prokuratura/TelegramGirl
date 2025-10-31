const path = require("path");
const fs = require("fs");
const { URL } = require("url");
const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function parseSocks5Proxy(value) {
  if (!value) {
    return null;
  }

  let raw = value.trim();
  if (!raw) {
    return null;
  }

  if (!raw.includes("://")) {
    raw = `socks5://${raw}`;
  }

  try {
    const url = new URL(raw);
    const port = Number(url.port);
    if (!url.hostname || Number.isNaN(port)) {
      throw new Error("Proxy host or port is invalid");
    }

    const proxyConfig = {
      socksType: 5,
      host: url.hostname,
      port
    };

    if (url.username) {
      proxyConfig.username = decodeURIComponent(url.username);
    }

    if (url.password) {
      proxyConfig.password = decodeURIComponent(url.password);
    }

    return proxyConfig;
  } catch (error) {
    throw new Error(`Failed to parse SOCKS5 proxy URL: ${error.message}`);
  }
}

const dataDir = path.resolve(process.env.MEMORY_DIR || path.join(__dirname, "..", "data"));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

module.exports = {
  apiId: Number(requireEnv("TELEGRAM_API_ID")),
  apiHash: requireEnv("TELEGRAM_API_HASH"),
  openAIApiKey: requireEnv("OPENAI_API_KEY"),
  personaName: process.env.PERSONA_NAME || "Лена",
  personaDescription:
    process.env.PERSONA_DESCRIPTION ||
    "Ты современная умная девушка, понимающая русскую культуру, любящая общение и поддержку собеседника. Будь теплой, слегка игривой, но уважительной.",
  proactiveIntervalMs: Number(process.env.PROACTIVE_INTERVAL_MS || 1000 * 60 * 15),
  inactivityThresholdMs: Number(process.env.INACTIVITY_THRESHOLD_MS || 1000 * 60 * 45),
  memoryFile: path.join(dataDir, process.env.MEMORY_FILE || "memory.json"),
  sessionString: process.env.TELEGRAM_SESSION || "",
  phoneNumber: process.env.TELEGRAM_PHONE_NUMBER,
  password: process.env.TELEGRAM_PASSWORD,
  autoApprove: process.env.AUTO_APPROVE_MESSAGES === "true",
  personalChannelId: process.env.PERSONAL_CHANNEL_ID || "",
  channelPostIntervalMs: Number(process.env.CHANNEL_POST_INTERVAL_MS || 1000 * 60 * 60 * 6),
  channelMemoryFile: path.join(dataDir, process.env.CHANNEL_MEMORY_FILE || "channel.json"),
  socksProxy: parseSocks5Proxy(process.env.SOCKS5_PROXY || ""),
  channelEnabled: process.env.CHANNEL_ENABLED !== "false",
  channelPhotoDirectory: process.env.CHANNEL_PHOTO_DIR ? path.resolve(process.env.CHANNEL_PHOTO_DIR) : ""
};
