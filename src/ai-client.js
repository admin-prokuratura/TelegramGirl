const fetchFn = global.fetch
  ? (...args) => global.fetch(...args)
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

class AIClient {
  constructor({ apiKey, personaName, personaDescription }) {
    this.apiKey = apiKey;
    this.personaName = personaName;
    this.personaDescription = personaDescription;
    this.model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
  }

  async generateReply({ history = [], summary, keywords, mood = "дружелюбное", instructions = "" }) {
    const messages = [
      {
        role: "system",
        content: `${this.personaDescription}. Твоё имя ${this.personaName}. Отвечай на русском языке. Поддерживай тёплый, уверенный и инициативный тон.`
      }
    ];

    if (summary) {
      messages.push({
        role: "system",
        content: `Предыдущие отношения с собеседником: ${summary}. Ключевые темы: ${(keywords || []).join(", ")}`
      });
    }

    history.slice(-20).forEach((item) => {
      messages.push({ role: item.role === "assistant" ? "assistant" : "user", content: item.text });
    });

    if (instructions) {
      messages.push({ role: "system", content: instructions });
    }

    messages.push({ role: "system", content: `Текущее настроение: ${mood}. Будь инициативной, предлагай темы и вопросы.` });

    return this._createChatCompletion(messages);
  }

  async generateChannelPost({ personaName = this.personaName, recentPosts = [] } = {}) {
    const messages = [
      {
        role: "system",
        content: `${this.personaDescription}. Ты ведёшь личный телеграм-канал ${personaName}, девушки 17-18 лет. Стиль: живой дневник, искренние эмоции, лёгкий юмор, актуальные интересы и планы.`
      },
      {
        role: "system",
        content:
          "Цель — подготовить новый пост для канала. Делай текст на 3-5 коротких абзацев или пунктов. Добавляй эмодзи и вопросы к подписчикам, чтобы вовлекать. Излучай уверенность, любопытство и энергию подростка, но без токсичности."
      }
    ];

    if (recentPosts.length) {
      const recaps = recentPosts.map((post) => `- ${post.text || post}`).join("\n");
      messages.push({
        role: "system",
        content: `Недавние публикации, чтобы не повторяться:\n${recaps}`
      });
    }

    messages.push({
      role: "system",
      content:
        "Сфокусируйся на одной теме: учеба, хобби, мечты, дружба, отношения с собой, музыка, планы на выходные или вдохновение. Не используй хэштеги и упоминания конкретных брендов."
    });

    messages.push({
      role: "system",
      content: "Ответ верни как чистый текст поста без пояснений."
    });

    return this._createChatCompletion(messages);
  }

  async createSummary({ history = [] }) {
    const messages = [
      {
        role: "system",
        content:
          "Ты аналитический помощник. Сформулируй краткое описание отношений, интересов и настроения собеседника в 3-4 предложениях. Также перечисли 3-5 ключевых тем (keywords) через запятую. Ответ верни в формате JSON: {\"summary\":\"...\",\"keywords\":[\"...\"]}."
      }
    ];

    history.slice(-50).forEach((item) => {
      messages.push({ role: item.role === "assistant" ? "assistant" : "user", content: item.text });
    });

    const raw = await this._createChatCompletion(messages);

    try {
      const parsed = JSON.parse(raw);
      return {
        summary: parsed.summary || "",
        keywords: parsed.keywords || []
      };
    } catch (error) {
      console.warn("Failed to parse summary, fallback to text", error);
      return { summary: raw, keywords: [] };
    }
  }

  async _createChatCompletion(messages) {
    const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.8,
        presence_penalty: 0.6,
        frequency_penalty: 0.4
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0]?.message?.content;
    if (!choice) {
      throw new Error("OpenAI response did not contain any content");
    }
    return choice.trim();
  }
}

module.exports = AIClient;
