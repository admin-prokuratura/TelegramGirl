class SelfTrainer {
  constructor({ memory, aiClient, intervalMs, minMessages }) {
    this.memory = memory;
    this.aiClient = aiClient;
    this.intervalMs = intervalMs;
    this.minMessages = minMessages;
    this.instructions = new Map();
    this.timers = new Map();

    this.memory.on("update", (chatId) => this._schedule(chatId));
    this.memory.on("summary", (chatId) => this._schedule(chatId, true));
    this.memory.on("reset", (chatId) => this._clear(chatId));
  }

  getInstructions(chatId) {
    const data = this.instructions.get(chatId);
    return data ? data.text : "";
  }

  _clear(chatId) {
    if (this.timers.has(chatId)) {
      clearTimeout(this.timers.get(chatId));
      this.timers.delete(chatId);
    }
    this.instructions.delete(chatId);
  }

  _schedule(chatId, immediate = false) {
    const history = this.memory.getHistory(chatId, this.minMessages * 2);
    if (history.length < this.minMessages) {
      return;
    }

    this._clearTimer(chatId);
    const delay = immediate ? 0 : this.intervalMs;
    const timer = setTimeout(() => {
      this._train(chatId).catch((error) => console.error(`Self-training failed for ${chatId}`, error));
    }, delay);
    this.timers.set(chatId, timer);
  }

  _clearTimer(chatId) {
    const timer = this.timers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(chatId);
    }
  }

  async _train(chatId) {
    this._clearTimer(chatId);
    const context = this.memory.getContext(chatId);
    const history = this.memory.getHistory(chatId, 40);

    try {
      const text = await this.aiClient.generateAdaptiveInstruction({
        history,
        summary: context.summary,
        keywords: context.keywords
      });

      if (text) {
        this.instructions.set(chatId, {
          text,
          updatedAt: Date.now()
        });
      }
    } catch (error) {
      console.error(`Self-training generation failed for ${chatId}`, error);
    }
  }
}

module.exports = SelfTrainer;
