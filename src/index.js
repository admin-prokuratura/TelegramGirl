const { TelegramClient } = require("gramjs");
const { NewMessage } = require("gramjs/events");
const { StringSession } = require("gramjs/sessions");
const readline = require("readline");

const config = require("./config");
const MemoryStore = require("./memory");
const AIClient = require("./ai-client");
const InitiativeManager = require("./initiative");
const { ChannelManager, ChannelStore } = require("./channel");

const memory = new MemoryStore(config.memoryFile);
const aiClient = new AIClient({
  apiKey: config.openAIApiKey,
  personaName: config.personaName,
  personaDescription: config.personaDescription
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
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
    intervalMs: config.proactiveIntervalMs
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
  if (sender?.isSelf) {
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
    await event.respond(reply);
    memory.recordBotMessage(chatId, reply, { command: "summary" });
    return;
  }

  if (text.startsWith("/reset")) {
    memory.resetChat(chatId);
    const reply = "Я обновила нашу историю. Начнём с чистого листа!";
    await event.respond(reply);
    memory.recordBotMessage(chatId, reply, { command: "reset" });
    return;
  }

  const reply = "Я пока не знаю такую команду, но с радостью продолжу разговор!";
  await event.respond(reply);
  memory.recordBotMessage(chatId, reply, { command: "unknown" });
}

async function respondWithAI(event, chatId) {
  const context = memory.getContext(chatId);
  const history = memory.getHistory(chatId, 20);
  try {
    const reply = await aiClient.generateReply({
      history,
      summary: context.summary,
      keywords: context.keywords
    });
    await event.respond(reply);
    memory.recordBotMessage(chatId, reply, { via: "auto" });
  } catch (error) {
    console.error("AI response failed", error);
    if (config.autoApprove) {
      const fallback = "Я немного занята, но обязательно вернусь с ответом позже.";
      await event.respond(fallback);
      memory.recordBotMessage(chatId, fallback, { via: "fallback" });
    }
  }
}

bootstrap().catch((error) => {
  console.error("Bot failed to start", error);
  process.exit(1);
});
