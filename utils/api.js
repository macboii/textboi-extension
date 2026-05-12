import { REWRITE_PROMPTS } from "./constants.js";
import { detectLanguage } from "./langDetect.js";

export function buildTranslateMessages(text, targetLang) {
  return [
    {
      role: "system",
      content:
        `You are a professional translator.\n\n` +
        `Your task is to accurately detect the original language of the input text and translate it into the specified target language.\n\n` +
        `Target Language: ${targetLang}\n\n` +
        `Guidelines:\n` +
        `Detect the source language based solely on the input content.\n` +
        `Translate the meaning accurately and naturally into the target language.\n` +
        `Use standard grammar, vocabulary, and spelling conventions appropriate for the specified locale.\n\n` +
        `Additional Instructions:\n` +
        `Do not preserve the original language.\n` +
        `Do not include the detected language in your response.\n` +
        `Only return the translated text.`,
    },
    { role: "user", content: text },
  ];
}

export function buildCorrectMessages(text, rewritePromptKey) {
  const promptText = REWRITE_PROMPTS[rewritePromptKey] || rewritePromptKey;
  const detectedLang = detectLanguage(text);
  const langHint = detectedLang !== "unknown" ? ` Use "${detectedLang}" as a language hint when uncertain.` : "";
  return [
    {
      role: "system",
      content:
        `You are a multilingual writing assistant.\n` +
        `Detect the input language automatically. Do not translate; keep the output in the same language as the input.${langHint}\n` +
        `Task: ${promptText}\n` +
        `Return only the final result.`,
    },
    { role: "user", content: text },
  ];
}
