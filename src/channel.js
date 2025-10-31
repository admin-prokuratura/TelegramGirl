const fs = require("fs");
const path = require("path");

const ALLOWED_PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

class ChannelStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { posts: [] };
    this._load();
  }

  _load() {
    if (!this.filePath) {
      return;
    }

    if (!fs.existsSync(this.filePath)) {
      this._save();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.state = JSON.parse(raw);
      if (!Array.isArray(this.state.posts)) {
        this.state.posts = [];
      }
    } catch (error) {
      console.error("Failed to load channel memory file", error);
      this.state = { posts: [] };
    }
  }

  _save() {
    if (!this.filePath) return;
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  recordPost(text, meta = {}) {
    const now = Date.now();
    this.state.posts.push({ text, at: now, meta });
    if (this.state.posts.length > 50) {
      this.state.posts.splice(0, this.state.posts.length - 50);
    }
    this._save();
  }

  getRecent(limit = 5) {
    return this.state.posts.slice(-limit);
  }
}

class ChannelManager {
  constructor({ client, aiClient, channelId, intervalMs, personaName, store, photoDirectory }) {
    this.client = client;
    this.aiClient = aiClient;
    this.channelId = channelId;
    this.intervalMs = intervalMs;
    this.personaName = personaName;
    this.store = store;
    this.photoDirectory = photoDirectory;
    this.timer = null;
    this.channelEntityPromise = null;
  }

  start() {
    if (!this.channelId || this.timer) {
      return;
    }
    this._tick().catch((error) => console.error("Channel tick failed", error));
    this.timer = setInterval(() => {
      this._tick().catch((error) => console.error("Channel tick failed", error));
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async _tick() {
    if (!this.channelId) return;

    const recentPosts = this.store ? this.store.getRecent(6) : [];
    const draft = await this.aiClient.generateChannelPost({
      personaName: this.personaName,
      recentPosts
    });

    const message = draft.trim();
    if (!message) return;

    try {
      const entity = await this._getChannelEntity();
      const photoPath = this._pickPhoto();
      await this.client.sendMessage(entity, photoPath ? { message, file: photoPath } : { message });
      if (this.store) {
        const meta = {};
        if (photoPath) {
          meta.photo = path.basename(photoPath);
        }
        this.store.recordPost(message, meta);
      }
      if (photoPath) {
        console.log(
          `Channel post with photo published: ${message.slice(0, 40)}... (${path.basename(photoPath)})`
        );
      } else {
        console.log(`Channel post published: ${message.slice(0, 40)}...`);
      }
    } catch (error) {
      console.error("Failed to post to channel", error);
    }
  }

  async _getChannelEntity() {
    if (!this.channelEntityPromise) {
      this.channelEntityPromise = this.client.getEntity(this.channelId);
    }
    return this.channelEntityPromise;
  }

  _pickPhoto() {
    if (!this.photoDirectory) {
      return null;
    }

    try {
      const entries = fs.readdirSync(this.photoDirectory, { withFileTypes: true });
      const images = entries
        .filter((entry) => entry.isFile() && ALLOWED_PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => entry.name);

      if (!images.length) {
        return null;
      }

      const randomIndex = Math.floor(Math.random() * images.length);
      return path.join(this.photoDirectory, images[randomIndex]);
    } catch (error) {
      console.error("Failed to read channel photo directory", error);
      return null;
    }
  }
}

module.exports = { ChannelManager, ChannelStore };
