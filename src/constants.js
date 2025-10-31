const DEFAULT_HUGGINGFACE_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";

const HUGGINGFACE_MODEL_ALIASES = new Map([
  ["meta-llama/meta-llama-3-8b-instruct", DEFAULT_HUGGINGFACE_MODEL],
  ["llama-3-8b-instruct", DEFAULT_HUGGINGFACE_MODEL],
  ["llama3-8b-instruct", DEFAULT_HUGGINGFACE_MODEL],
  ["mistralai/Mistral-7B-Instruct-v0.3", DEFAULT_HUGGINGFACE_MODEL],
  ["mistralai/mistral-7b-instruct-v0.3", DEFAULT_HUGGINGFACE_MODEL],
  ["mistralai/Mistral-7B-Instruct-v0.2", DEFAULT_HUGGINGFACE_MODEL],
  ["mistralai/mistral-7b-instruct-v0.2", DEFAULT_HUGGINGFACE_MODEL],
  ["mistralai/Mistral-7B-Instruct", DEFAULT_HUGGINGFACE_MODEL],
  ["mistralai/mistral-7b-instruct", DEFAULT_HUGGINGFACE_MODEL],
  ["mistral-7b-instruct", DEFAULT_HUGGINGFACE_MODEL]
]);

const HUGGINGFACE_MODEL_FALLBACKS = [
  "meta-llama/Meta-Llama-3.1-8B-Instruct",
  "google/gemma-7b-it",
  "Qwen/Qwen2-7B-Instruct"
];

function resolveHuggingFaceModelName(input) {
  if (typeof input !== "string") {
    return DEFAULT_HUGGINGFACE_MODEL;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_HUGGINGFACE_MODEL;
  }

  return HUGGINGFACE_MODEL_ALIASES.get(trimmed) || trimmed;
}

module.exports = {
  DEFAULT_HUGGINGFACE_MODEL,
  HUGGINGFACE_MODEL_ALIASES,
  HUGGINGFACE_MODEL_FALLBACKS,
  resolveHuggingFaceModelName
};
