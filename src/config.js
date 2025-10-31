const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null) {
    throw new Error(`Environment variable ${name} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Environment variable ${name} cannot be empty`);
  }
  return trimmed;
}

function optionalEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

const dataDir = path.resolve(process.env.MEMORY_DIR || path.join(__dirname, "..", "data"));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

module.exports = {
  apiId: Number(requireEnv("TELEGRAM_API_ID")),
  apiHash: requireEnv("TELEGRAM_API_HASH"),
  huggingFaceApiKey: requireEnv("HUGGINGFACE_API_KEY"),
  huggingFaceModel: optionalEnv("HUGGINGFACE_MODEL") || "mistralai/Mistral-7B-Instruct-v0.2",
  personaName: optionalEnv("PERSONA_NAME") || "Лена",
  personaDescription:
    optionalEnv("PERSONA_DESCRIPTION") ||
    "Ты современная умная девушка, понимающая русскую культуру, любящая общение и поддержку собеседника. Будь теплой, слегка игривой, но уважительной.",
  proactiveIntervalMs: Number(optionalEnv("PROACTIVE_INTERVAL_MS") || 1000 * 60 * 15),
  inactivityThresholdMs: Number(optionalEnv("INACTIVITY_THRESHOLD_MS") || 1000 * 60 * 45),
  memoryFile: path.join(dataDir, optionalEnv("MEMORY_FILE") || "memory.json"),
  sessionString: optionalEnv("TELEGRAM_SESSION") || "",
  phoneNumber: optionalEnv("TELEGRAM_PHONE_NUMBER"),
  password: optionalEnv("TELEGRAM_PASSWORD"),
  autoApprove: process.env.AUTO_APPROVE_MESSAGES === "true",
  personalChannelId: process.env.PERSONAL_CHANNEL_ID || "",
  channelPostIntervalMs: Number(optionalEnv("CHANNEL_POST_INTERVAL_MS") || 1000 * 60 * 60 * 6),
  channelMemoryFile: path.join(dataDir, optionalEnv("CHANNEL_MEMORY_FILE") || "channel.json"),
  selfTrainingIntervalMs: Number(optionalEnv("SELF_TRAINING_INTERVAL_MS") || 1000 * 60 * 30),
  selfTrainingMinMessages: Number(optionalEnv("SELF_TRAINING_MIN_MESSAGES") || 12)
};
