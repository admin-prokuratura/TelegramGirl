class InitiativeManager {
  constructor({ memory, aiClient, client, inactivityThresholdMs, intervalMs }) {
    this.memory = memory;
    this.aiClient = aiClient;
    this.client = client;
    this.inactivityThresholdMs = inactivityThresholdMs;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this._tick().catch((error) => console.error("Initiative tick failed", error));
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async _tick() {
    const inactive = this.memory.getInactiveChats(this.inactivityThresholdMs);
    for (const { chatId, chat } of inactive) {
      // avoid spamming if the bot recently wrote
      if (chat.lastBotMessageAt && Date.now() - chat.lastBotMessageAt < this.inactivityThresholdMs / 2) {
        continue;
      }

      const history = this.memory.getHistory(chatId, 10);
      const mood = this._estimateMood(history);
      const prompt = await this.aiClient.generateReply({
        history,
        summary: chat.summary,
        keywords: chat.keywords,
        mood,
        instructions:
          "Собеседник давно молчит. Сделай инициативное сообщение: напомни о приятном моменте беседы, предложи тему или вопрос, не будь навязчивой."
      });

      try {
        const entity = BigInt(chatId);
        await this.client.sendMessage(entity, { message: prompt });
        this.memory.recordBotMessage(chatId, prompt, { proactive: true });
      } catch (error) {
        console.error(`Failed to send proactive message to ${chatId}`, error);
      }
    }
  }

  _estimateMood(history) {
    const last = history.slice(-6);
    const sentiments = last.map((item) => this._score(item.text));
    const avg = sentiments.reduce((sum, x) => sum + x, 0) / (sentiments.length || 1);
    if (avg > 0.4) return "воодушевлённое";
    if (avg < -0.4) return "поддерживающее";
    return "дружелюбное";
  }

  _score(text = "") {
    const positive = ["спасибо", "класс", "люблю", "нравится", "хорошо", "отлично", "ура"];
    const negative = ["плохо", "грусть", "не хочу", "ненавижу", "ужас", "плохо", "грустно"];
    const lower = text.toLowerCase();
    let score = 0;
    positive.forEach((word) => {
      if (lower.includes(word)) score += 1;
    });
    negative.forEach((word) => {
      if (lower.includes(word)) score -= 1;
    });
    return Math.max(-1, Math.min(1, score / 3));
  }
}

module.exports = InitiativeManager;
