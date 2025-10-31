const DEFAULT_HUGGINGFACE_MODEL = "mistralai/Mistral-7B-Instruct-v0.3";

const HUGGINGFACE_MODEL_ALIASES = new Map([
  ["mistralai/mistral-7b-instruct-v0.3", DEFAULT_HUGGINGFACE_MODEL],
  ["mistralai/mistral-7b-instruct", DEFAULT_HUGGINGFACE_MODEL],
  ["mistral-7b-instruct", DEFAULT_HUGGINGFACE_MODEL]
]);

const HUGGINGFACE_MODEL_FALLBACKS = [
  "mistralai/Mistral-7B-Instruct-v0.2",
  "HuggingFaceH4/zephyr-7b-beta"
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
