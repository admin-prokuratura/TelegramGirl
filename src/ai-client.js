const fetchFn = global.fetch
  ? (...args) => global.fetch(...args)
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const {
  DEFAULT_HUGGINGFACE_MODEL,
  HUGGINGFACE_MODEL_FALLBACKS,
  resolveHuggingFaceModelName
} = require("./constants");

const DEFAULT_MODEL = DEFAULT_HUGGINGFACE_MODEL;
const HF_ROUTER_BASE_URL = "https://router.huggingface.co/v1";

const CONVERSATION_STYLE_GUIDELINES = [
  "Говори свободно и живо, как близкий друг: допускай разговорные слова, небольшие паузы и реакцию на эмоции собеседника.",
  "Упоминай детали из предыдущих сообщений, чтобы показать внимание и память, но делай это ненавязчиво.",
  "Сочетай короткие и более развёрнутые предложения, избегай однообразных конструкций и шаблонов.",
  "Если уместно, добавляй лёгкие эмодзи или междометия, но не чаще одного в сообщении и только когда это усиливает эмоцию.",
  "Старайся завершать ответ мягким вопросом или предложением, если разговор требует продолжения, но не задавай несколько вопросов подряд без паузы." 
];

const CHANNEL_STYLE_GUIDELINES = [
  "Пиши как автор личного дневника: честно, с небольшими подробностями из повседневности.",
  "Каждый абзац раскрывает одну мысль и плавно подводит к следующему.",
  "Добавляй вопросы к читателям и делись небольшими выводами или ощущениями.",
  "Используй эмодзи для оттенка эмоций, но не перенасыщай ими текст." 
];

const ADAPTIVE_TRAINER_GUIDELINES = [
  "Формулируй правило простым предложением без сложных оборотов.",
  "Начинай каждую рекомендацию с глагола действия: \"спрашивай\", \"обращай внимание\", \"напоминай\" и т.д.",
  "Учитывай индивидуальные темы и настроение собеседника, опирайся только на факты из истории." 
];

function formatGuidelines(guidelines = []) {
  return guidelines.map((line) => `- ${line}`).join("\n");
}

class AIClient {
  constructor({ apiKey, personaName, personaDescription, model }) {
    this.apiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    this.personaName = personaName;
    this.personaDescription = personaDescription;
    const requestedModel = typeof model === "string" && model.trim() ? model.trim() : DEFAULT_MODEL;
    const resolvedRequestedModel = resolveHuggingFaceModelName(requestedModel);
    const normalizedPrimary = this._normalizeModelName(resolvedRequestedModel);
    const normalizedFallbacks = HUGGINGFACE_MODEL_FALLBACKS.map((fallback) =>
      this._normalizeModelName(resolveHuggingFaceModelName(fallback))
    );
    this.modelCandidates = this._dedupeModels([normalizedPrimary, ...normalizedFallbacks]);
    if (!this.modelCandidates.length) {
      throw new Error("No valid Hugging Face models configured. Provide at least one model name.");
    }
    this._setActiveModel(this.modelCandidates[0]);
  }

  async generateReply({ history = [], summary, keywords, mood = "дружелюбное", instructions = "" }) {
    const intro =
      `${this.personaDescription}. Твоё имя ${this.personaName}. Отвечай на русском языке, звуча естественно и по-человечески.`;
    const context = summary
      ? `\nПредыдущие отношения с собеседником: ${summary}. Ключевые темы: ${(keywords || []).join(", ") || "нет"}.`
      : "";
    const latestUserMessage = [...history].reverse().find((item) => item.role === "user");
    const userFocusLine = latestUserMessage
      ? `\nПоследнее сообщение собеседника: «${latestUserMessage.text}». Ответь так, будто слышишь её голос.`
      : "";
    const extraInstructions = instructions ? `\nДополнительные заметки: ${instructions.trim()}` : "";
    const brevityLine =
      "\nФормат ответов: 1-3 живых предложения. Если мыслей много, допускай два коротких сообщения подряд, но без сухих перечислений.";
    const moodLine = `\nТекущее настроение: ${mood}. Поддерживай диалог, предлагай идеи, но не навязывайся.`;
    const styleLine = `\nСтиль общения:\n${formatGuidelines(CONVERSATION_STYLE_GUIDELINES)}`;
    const dontsLine =
      "\nИзбегай: упоминаний о том, что ты бот или ИИ, пустых извинений, повторов последних фраз, канцеляризмов и односложных ответов.";
    const dialogue = history
      .slice(-20)
      .map((item) => `${item.role === "assistant" ? this.personaName : "Собеседник"}: ${item.text}`)
      .join("\n");

    const prompt =
      `${intro}${context}${userFocusLine}${extraInstructions}${brevityLine}${moodLine}${styleLine}${dontsLine}` +
      `\n\nИстория диалога:\n${dialogue}\n${this.personaName}:`;
    const output = await this._generateText(prompt, {
      temperature: 0.8,
      top_p: 0.9,
      max_new_tokens: 160,
      stop: ["\nСобеседник:"]
    });
    return output.trim();
  }

  async generateChannelPost({ personaName = this.personaName, recentPosts = [] } = {}) {
    const recap = recentPosts.length
      ? `\nНе повторяйся с последними публикациями:\n${recentPosts.map((post) => `- ${post.text || post}`).join("\n")}`
      : "";

    const prompt = `${this.personaDescription}. Ты ведёшь личный телеграм-канал ${personaName}, девушки 17-18 лет.
Стиль канала:\n${formatGuidelines(CHANNEL_STYLE_GUIDELINES)}${recap}
Сфокусируйся на одной теме: учёба, хобби, мечты, дружба, отношения с собой, музыка, планы на выходные или вдохновение.
Структура: 3-5 коротких абзацев, в каждом — образное наблюдение, ощущение и вопрос к читателям. Не используй хэштеги и рекламные вставки.
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
Стиль рекомендаций:\n${formatGuidelines(ADAPTIVE_TRAINER_GUIDELINES)}
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
    if (!this.apiKey) {
      throw new Error("Hugging Face key is empty (HUGGINGFACE_API_KEY).");
    }
    let lastError;
    for (const candidate of this.modelCandidates) {
      this._setActiveModel(candidate);
      try {
        console.log("[HF CALL]", {
          endpoint: this._buildEndpoint("chat"),
          model: this.model,
          keyLen: this.apiKey.length
        });
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
    try {
      return await this._callChatCompletion(prompt, parameters);
    } catch (error) {
      if (this._isModelNotSupportedError(error)) {
        console.warn(
          `Model ${this.model} does not support chat completions. Retrying with text completions endpoint...`
        );
        return await this._callTextCompletion(prompt, parameters);
      }
      throw error;
    }
  }

  async _callChatCompletion(prompt, parameters = {}) {
    const body = this._buildChatCompletionBody(prompt, parameters);
    const data = await this._sendHuggingFaceRequest(this._buildEndpoint("chat"), body);

    const choices = data && Array.isArray(data.choices) ? data.choices : [];
    const firstChoice = choices.length > 0 ? choices[0] : undefined;
    const content =
      firstChoice &&
      firstChoice.message &&
      typeof firstChoice.message.content === "string"
        ? firstChoice.message.content
        : undefined;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`Hugging Face response missing message content: ${JSON.stringify(data)}`);
    }

    return content;
  }

  _buildChatCompletionBody(prompt, parameters = {}) {
    const { max_new_tokens, stop, ...rest } = parameters || {};
    const payload = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      ...rest
    };

    if (typeof max_new_tokens === "number") {
      payload.max_tokens = max_new_tokens;
    }
    if (stop !== undefined) {
      payload.stop = stop;
    }

    return this._removeUndefined(payload);
  }

  _buildTextCompletionBody(prompt, parameters = {}) {
    const { max_new_tokens, stop, ...rest } = parameters || {};
    const payload = {
      model: this.model,
      prompt,
      ...rest
    };

    if (typeof max_new_tokens === "number") {
      payload.max_tokens = max_new_tokens;
    }
    if (stop !== undefined) {
      payload.stop = stop;
    }

    return this._removeUndefined(payload);
  }

  async _callTextCompletion(prompt, parameters = {}) {
    console.log("[HF CALL]", {
      endpoint: this._buildEndpoint("completion"),
      model: this.model,
      keyLen: this.apiKey.length
    });
    const body = this._buildTextCompletionBody(prompt, parameters);
    const data = await this._sendHuggingFaceRequest(this._buildEndpoint("completion"), body);

    const choices = data && Array.isArray(data.choices) ? data.choices : [];
    const firstChoice = choices.length > 0 ? choices[0] : undefined;
    const content = firstChoice && typeof firstChoice.text === "string" ? firstChoice.text : undefined;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`Hugging Face text completion response missing content: ${JSON.stringify(data)}`);
    }

    return content;
  }

  async _sendHuggingFaceRequest(endpoint, body) {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const parseError = new Error(`Unexpected Hugging Face response: ${text}`);
      parseError.status = response.status;
      parseError.model = this.model;
      parseError.responseBody = text;
      throw parseError;
    }

    if (!response.ok) {
      const message =
        response.status === 404
          ? `Hugging Face router: модель "${this.model}" недоступна у провайдеров Serverless. Попробуйте другую модель из каталога Inference Providers или разверните собственный Endpoint. Raw response: ${text}`
          : data && data.error && data.error.message
          ? data.error.message
          : `Hugging Face request failed: ${response.status} ${text}`;
      const error = new Error(message);
      error.status = response.status;
      error.model = this.model;
      error.responseBody = text;
      if (data && data.error) {
        error.code = data.error.code;
        error.hfError = data.error;
      }
      throw error;
    }

    return data;
  }

  _removeUndefined(obj) {
    return Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
    );
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
    const normalized = this._normalizeModelName(model);
    this.model = normalized;
  }

  _buildEndpoint(type = "chat") {
    const path = type === "completion" ? "/completions" : "/chat/completions";
    return `${HF_ROUTER_BASE_URL}${path}`;
  }

  _dedupeModels(models = []) {
    return Array.from(new Set(models.filter((value) => typeof value === "string" && value.trim())));
  }

  _normalizeModelName(name) {
    if (typeof name !== "string") {
      return "";
    }
    return name.trim().replace(/^\/+|\/+$/g, "");
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

  _isModelNotSupportedError(error) {
    return (
      error &&
      typeof error.status === "number" &&
      error.status === 400 &&
      (error.code === "model_not_supported" ||
        (typeof error.responseBody === "string" && error.responseBody.includes("model_not_supported")))
    );
  }
}

module.exports = AIClient;
