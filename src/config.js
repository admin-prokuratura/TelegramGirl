const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

const dataDir = path.resolve(process.env.MEMORY_DIR || path.join(__dirname, "..", "data"));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

module.exports = {
  apiId: Number(requireEnv("TELEGRAM_API_ID")),
  apiHash: requireEnv("TELEGRAM_API_HASH"),
  huggingFaceApiKey: requireEnv("HUGGINGFACE_API_KEY"),
  huggingFaceModel: process.env.HUGGINGFACE_MODEL || "mistralai/Mistral-7B-Instruct-v0.2",
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
  selfTrainingIntervalMs: Number(process.env.SELF_TRAINING_INTERVAL_MS || 1000 * 60 * 30),
  selfTrainingMinMessages: Number(process.env.SELF_TRAINING_MIN_MESSAGES || 12)
};
