const fetchFn = global.fetch
  ? (...args) => global.fetch(...args)
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const {
  DEFAULT_HUGGINGFACE_MODEL,
  HUGGINGFACE_MODEL_FALLBACKS,
  resolveHuggingFaceModelName
} = require("./constants");

const DEFAULT_MODEL = DEFAULT_HUGGINGFACE_MODEL;

class AIClient {
  constructor({ apiKey, personaName, personaDescription, model }) {
    this.apiKey = apiKey;
    this.personaName = personaName;
    this.personaDescription = personaDescription;
    const requestedModel = typeof model === "string" && model.trim() ? model.trim() : DEFAULT_MODEL;
    const resolvedRequestedModel = resolveHuggingFaceModelName(requestedModel);
    this.modelCandidates = this._dedupeModels([resolvedRequestedModel, ...HUGGINGFACE_MODEL_FALLBACKS]);
    if (!this.modelCandidates.length) {
      throw new Error("No valid Hugging Face models configured. Provide at least one model name.");
    }
    this._setActiveModel(this.modelCandidates[0]);
  }

  async generateReply({ history = [], summary, keywords, mood = "дружелюбное", instructions = "" }) {
    const intro = `${this.personaDescription}. Твоё имя ${this.personaName}. Отвечай на русском языке, поддерживай тёплый и уверенный тон.`;
    const context = summary
      ? `\nПредыдущие отношения с собеседником: ${summary}. Ключевые темы: ${(keywords || []).join(", ") || "нет"}.`
      : "";
    const extraInstructions = instructions ? `\nДополнительные заметки: ${instructions.trim()}` : "";
    const moodLine = `\nТекущее настроение: ${mood}. Будь инициативной и предлагай новые вопросы.`;
    const dialogue = history
      .slice(-20)
      .map((item) => `${item.role === "assistant" ? this.personaName : "Собеседник"}: ${item.text}`)
      .join("\n");

    const prompt = `${intro}${context}${extraInstructions}${moodLine}\n\nИстория диалога:\n${dialogue}\n${this.personaName}:`;
    const output = await this._generateText(prompt, {
      temperature: 0.8,
      top_p: 0.9,
      max_new_tokens: 220,
      stop: ["\nСобеседник:"]
    });
    return output.trim();
  }

  async generateChannelPost({ personaName = this.personaName, recentPosts = [] } = {}) {
    const recap = recentPosts.length
      ? `\nНе повторяйся с последними публикациями:\n${recentPosts.map((post) => `- ${post.text || post}`).join("\n")}`
      : "";

    const prompt = `${this.personaDescription}. Ты ведёшь личный телеграм-канал ${personaName}, девушки 17-18 лет.
Стиль: живой дневник, искренние эмоции, лёгкий юмор и актуальные планы.${recap}
Сфокусируйся на одной теме: учёба, хобби, мечты, дружба, отношения с собой, музыка, планы на выходные или вдохновение.
Сделай 3-5 коротких абзацев, добавь эмодзи и вопросы к подписчикам. Не используй хэштеги и бренды.
Верни только готовый текст поста без пояснений.\n\nТекст:`;

    const output = await this._generateText(prompt, {
      temperature: 0.75,
      top_p: 0.92,
      max_new_tokens: 260
    });
    return output.trim();
  }

  async createSummary({ history = [] }) {
    const dialogue = history
      .slice(-50)
      .map((item) => `${item.role === "assistant" ? this.personaName : "Собеседник"}: ${item.text}`)
      .join("\n");

    const prompt = `Ты аналитический помощник. На основе истории переписки составь краткое описание отношений, интересов и настроения собеседника в 3-4 предложениях. Также перечисли 3-5 ключевых тем (keywords) через запятую.
Верни ответ строго в формате JSON: {\"summary\":\"...\",\"keywords\":[\"...\"]}. Если данных мало, используй пустые значения.
\nИстория:\n${dialogue}\n\nJSON:`;

    const raw = await this._generateText(prompt, {
      temperature: 0.2,
      top_p: 0.7,
      max_new_tokens: 200
    });

    const jsonText = this._extractJson(raw);
    try {
      const parsed = JSON.parse(jsonText);
      return {
        summary: parsed.summary || "",
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : []
      };
    } catch (error) {
      console.warn("Failed to parse summary, fallback to text", error, raw);
      return { summary: raw.trim(), keywords: [] };
    }
  }

  async generateAdaptiveInstruction({ history = [], summary = "", keywords = [] }) {
    if (!history.length) return "";
    const dialogue = history
      .slice(-30)
      .map((item) => `${item.role === "assistant" ? this.personaName : "Собеседник"}: ${item.text}`)
      .join("\n");

    const prompt = `Ты наставник для чат-бота-девушки по имени ${this.personaName}. На основе истории общения и имеющегося описания сформулируй 3-5 коротких правил (каждое с новой строки), которые помогут ей лучше поддерживать разговор именно с этим человеком.
Используй конкретные наблюдения, но не раскрывай личные данные. Примеры правил: \"чаще говори о путешествиях\", \"замечай, когда собеседник устал\".
Если информации мало, верни пустую строку.
\nКраткое резюме: ${summary || "нет"}.
Ключевые темы: ${(keywords || []).join(", ") || "нет"}.
История:\n${dialogue}\n\nПравила:`;

    const output = await this._generateText(prompt, {
      temperature: 0.45,
      top_p: 0.85,
      max_new_tokens: 180
    });
    return output.trim();
  }

  async _generateText(prompt, parameters = {}) {
    let lastError;
    for (const candidate of this.modelCandidates) {
      this._setActiveModel(candidate);
      try {
        return await this._callHuggingFace(prompt, parameters);
      } catch (error) {
        lastError = error;
        if (!this._shouldRetryWithFallback(error, candidate)) {
          throw error;
        }
        console.warn(
          `Model ${candidate} failed with status ${error.status || "unknown"}. Trying next fallback model...`
        );
      }
    }

    throw lastError;
  }

  async _callHuggingFace(prompt, parameters = {}) {
    const response = await fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters,
        options: { wait_for_model: true }
      })
    });

    const text = await response.text();
    if (!response.ok) {
      const error = new Error(
        response.status === 404
          ? `Hugging Face model "${this.model}" not found or unavailable. Verify HUGGINGFACE_MODEL and access permissions. Raw response: ${text}`
          : `Hugging Face request failed: ${response.status} ${text}`
      );
      error.status = response.status;
      error.model = this.model;
      error.responseBody = text;
      throw error;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`Unexpected Hugging Face response: ${text}`);
    }

    const outputs = Array.isArray(data) ? data : data && data.generated_text ? [data] : [];
    if (!outputs.length || !outputs[0].generated_text) {
      throw new Error(`Hugging Face response missing generated_text: ${text}`);
    }

    const generated = outputs[0].generated_text;
    const stripped = generated.startsWith(prompt) ? generated.slice(prompt.length) : generated;
    return stripped;
  }

  _extractJson(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return text.slice(start, end + 1);
    }
    return text;
  }

  _setActiveModel(model) {
    this.model = model;
    this.endpoint = this._buildEndpoint(model);
  }

  _buildEndpoint(model) {
    const encodedModel = model
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `https://api-inference.huggingface.co/models/${encodedModel}`;
  }

  _dedupeModels(models = []) {
    return Array.from(new Set(models.filter((value) => typeof value === "string" && value.trim())));
  }

  _shouldRetryWithFallback(error, currentModel) {
    if (!error || typeof error.status !== "number") {
      return false;
    }

    const retryableStatuses = new Set([401, 403, 404, 408, 422, 429, 500, 502, 503, 504]);
    if (!retryableStatuses.has(error.status)) {
      return false;
    }

    const currentIndex = this.modelCandidates.indexOf(currentModel);
    return currentIndex !== -1 && currentIndex < this.modelCandidates.length - 1;
  }
}

module.exports = AIClient;
