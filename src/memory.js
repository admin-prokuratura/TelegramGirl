const fs = require("fs");
const { EventEmitter } = require("events");

class MemoryStore extends EventEmitter {
  constructor(filePath, options = {}) {
    super();
    this.filePath = filePath;
    this.maxHistory = options.maxHistory || 40;
    this.summaryIntervalMs = options.summaryIntervalMs || 1000 * 60 * 30;
    this.state = { chats: {} };
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) {
      this._save();
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.state = JSON.parse(raw);
    } catch (error) {
      console.error("Failed to load memory file, starting fresh", error);
      this.state = { chats: {} };
    }
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  _getChat(chatId) {
    if (!this.state.chats[chatId]) {
      this.state.chats[chatId] = {
        history: [],
        summary: "",
        keywords: [],
        lastSummaryAt: 0,
        lastUserMessageAt: 0,
        lastBotMessageAt: 0
      };
    }
    return this.state.chats[chatId];
  }

  recordUserMessage(chatId, text, meta = {}) {
    const chat = this._getChat(chatId);
    const now = Date.now();
    chat.history.push({ role: "user", text, at: now, meta });
    chat.lastUserMessageAt = now;
    this._truncate(chat.history);
    this._save();
    this.emit("update", chatId, chat);
  }

  recordBotMessage(chatId, text, meta = {}) {
    const chat = this._getChat(chatId);
    const now = Date.now();
    chat.history.push({ role: "assistant", text, at: now, meta });
    chat.lastBotMessageAt = now;
    this._truncate(chat.history);
    this._save();
    this.emit("update", chatId, chat);
  }

  _truncate(history) {
    if (history.length > this.maxHistory) {
      history.splice(0, history.length - this.maxHistory);
    }
  }

  getHistory(chatId, limit = this.maxHistory) {
    const chat = this._getChat(chatId);
    return chat.history.slice(-limit);
  }

  getContext(chatId) {
    const chat = this._getChat(chatId);
    return {
      summary: chat.summary,
      keywords: chat.keywords,
      history: chat.history,
      lastUserMessageAt: chat.lastUserMessageAt,
      lastBotMessageAt: chat.lastBotMessageAt
    };
  }

  needsSummary(chatId) {
    const chat = this._getChat(chatId);
    if (!chat.history.length) return false;
    const now = Date.now();
    return now - chat.lastSummaryAt > this.summaryIntervalMs;
  }

  updateSummary(chatId, summary, keywords = []) {
    const chat = this._getChat(chatId);
    chat.summary = summary;
    chat.keywords = keywords;
    chat.lastSummaryAt = Date.now();
    this._save();
    this.emit("summary", chatId, chat);
  }

  resetChat(chatId) {
    delete this.state.chats[chatId];
    this._save();
    this.emit("reset", chatId);
  }

  getInactiveChats(thresholdMs) {
    const now = Date.now();
    return Object.entries(this.state.chats)
      .map(([chatId, chat]) => ({ chatId, chat }))
      .filter(({ chat }) => chat.lastUserMessageAt && now - chat.lastUserMessageAt > thresholdMs);
  }
}

module.exports = MemoryStore;
