const { TelegramClient } = require("telegram");
const { NewMessage } = require("telegram/events");
const { StringSession } = require("telegram/sessions");
const readline = require("readline");

const config = require("./config");
const MemoryStore = require("./memory");
const AIClient = require("./ai-client");
const InitiativeManager = require("./initiative");
const SelfTrainer = require("./trainer");
const { ChannelManager, ChannelStore } = require("./channel");

const memory = new MemoryStore(config.memoryFile);
const aiClient = new AIClient({
  apiKey: config.huggingFaceApiKey,
  personaName: config.personaName,
  personaDescription: config.personaDescription,
  model: config.huggingFaceModel
});
const trainer = new SelfTrainer({
  memory,
  aiClient,
  intervalMs: config.selfTrainingIntervalMs,
  minMessages: config.selfTrainingMinMessages
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

const MAX_SINGLE_MESSAGE_LENGTH = 220;
const MAX_SEGMENT_LENGTH = 140;

function clampText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeReplyText(text) {
  return text
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function splitReplyIntoMessages(rawReply) {
  if (typeof rawReply !== "string") {
    return [];
  }
  const trimmed = rawReply.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = normalizeReplyText(trimmed);

  const newlineSegments = trimmed
    .split(/\n+/)
    .map((part) => normalizeReplyText(part))
    .filter(Boolean);

  const punctuationCandidates = normalized
    .split(/(?<=[.!?…])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const sentenceCandidates = newlineSegments.length > 1 ? newlineSegments : punctuationCandidates;

  if (sentenceCandidates.length < 2) {
    return [clampText(normalized, MAX_SINGLE_MESSAGE_LENGTH)];
  }

  const shouldSplitIntoTwo = Math.random() < 0.35;

  if (!shouldSplitIntoTwo) {
    const combined = clampText(sentenceCandidates.slice(0, 2).join(" "), MAX_SINGLE_MESSAGE_LENGTH);
    return [combined];
  }

  const first = clampText(sentenceCandidates[0], MAX_SEGMENT_LENGTH);
  const second = clampText(sentenceCandidates[1], MAX_SEGMENT_LENGTH);

  const messages = [first];
  if (second) {
    messages.push(second);
  }

  return messages;
}

async function replyToEvent(event, message, options = {}) {
  if (!message) {
    return;
  }

  if (
    event &&
    event.message &&
    event.message.reply &&
    typeof event.message.reply === "function"
  ) {
    await event.message.reply({ message, ...options });
    return;
  }

  const client = event && event.client;
  const getInputChat = event && event.message && event.message.getInputChat;

  if (!client || typeof getInputChat !== "function") {
    throw new Error("Unable to respond: Telegram client context is missing");
  }

  const entity = await getInputChat.call(event.message);
  await client.sendMessage(entity, { message, ...options });
}

async function bootstrap() {
  const client = new TelegramClient(new StringSession(config.sessionString), config.apiId, config.apiHash, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => config.phoneNumber || (await ask("Введите номер телефона: ")),
    password: async () => config.password || (await ask("Введите пароль (если есть): ")),
    phoneCode: async () => await ask("Введите код подтверждения: "),
    onError: (err) => console.error("Telegram auth error", err)
  });

  console.log("Telegram session string (сохраните его в TELEGRAM_SESSION):", client.session.save());
  rl.close();

  client.addEventHandler(onMessage, new NewMessage({}));

  const initiative = new InitiativeManager({
    memory,
    aiClient,
    client,
    inactivityThresholdMs: config.inactivityThresholdMs,
    intervalMs: config.proactiveIntervalMs,
    trainer
  });
  initiative.start();

  if (config.personalChannelId) {
    const channelStore = new ChannelStore(config.channelMemoryFile);
    const channelManager = new ChannelManager({
      client,
      aiClient,
      channelId: config.personalChannelId,
      intervalMs: config.channelPostIntervalMs,
      personaName: config.personaName,
      store: channelStore
    });
    channelManager.start();
    console.log("Channel manager enabled for", config.personalChannelId);
  } else {
    console.log("Channel manager disabled: PERSONAL_CHANNEL_ID is not set");
  }

  console.log("Bot is up and running as", config.personaName);
}

async function onMessage(event) {
  const message = event.message;
  if (!message || !message.message) return;
  if (!event.isPrivate) return;

  const chatId = String(message.chatId);
  const sender = await message.getSender();
  if (sender && sender.isSelf) {
    memory.recordBotMessage(chatId, message.message, { outgoing: true });
    return;
  }

  const text = message.message.trim();
  if (!text) return;
  memory.recordUserMessage(chatId, text, { messageId: message.id });

  try {
    if (memory.needsSummary(chatId)) {
      const history = memory.getHistory(chatId, 40);
      const { summary, keywords } = await aiClient.createSummary({ history });
      memory.updateSummary(chatId, summary, keywords);
      console.log(`Updated summary for chat ${chatId}`);
    }
  } catch (error) {
    console.error("Failed to update summary", error);
  }

  if (text.startsWith("/")) {
    await handleCommand(text, event, chatId);
    return;
  }

  await respondWithAI(event, chatId);
}

async function handleCommand(text, event, chatId) {
  if (text.startsWith("/summary")) {
    const context = memory.getContext(chatId);
    const reply = context.summary
      ? `Наши отношения: ${context.summary}\nКлючевые темы: ${context.keywords.join(", ")}`
      : "У меня пока нет собранного резюме, давай общаться больше!";
    await replyToEvent(event, reply);
    memory.recordBotMessage(chatId, reply, { command: "summary" });
    return;
  }

  if (text.startsWith("/reset")) {
    memory.resetChat(chatId);
    const reply = "Я обновила нашу историю. Начнём с чистого листа!";
    await replyToEvent(event, reply);
    memory.recordBotMessage(chatId, reply, { command: "reset" });
    return;
  }

  const reply = "Я пока не знаю такую команду, но с радостью продолжу разговор!";
  await replyToEvent(event, reply);
  memory.recordBotMessage(chatId, reply, { command: "unknown" });
}

async function respondWithAI(event, chatId) {
  const context = memory.getContext(chatId);
  const history = memory.getHistory(chatId, 20);
  const adaptiveInstructions = trainer.getInstructions(chatId);
  try {
    const reply = await aiClient.generateReply({
      history,
      summary: context.summary,
      keywords: context.keywords,
      instructions: adaptiveInstructions
    });
    const messages = splitReplyIntoMessages(reply);
    if (!messages.length) {
      return;
    }

    for (let index = 0; index < messages.length; index += 1) {
      const messageText = messages[index];
      await replyToEvent(event, messageText);
      memory.recordBotMessage(chatId, messageText, { via: "auto", segment: index });
    }
  } catch (error) {
    console.error("AI response failed", error);
    if (config.autoApprove) {
      const fallback = "Я немного занята, но обязательно вернусь с ответом позже.";
      await replyToEvent(event, fallback);
      memory.recordBotMessage(chatId, fallback, { via: "fallback" });
    }
  }
}

bootstrap().catch((error) => {
  console.error("Bot failed to start", error);
  process.exit(1);
});
