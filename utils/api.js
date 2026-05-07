import { REWRITE_PROMPTS } from "./constants.js";
import { detectLanguage } from "./langDetect.js";

export function buildTranslateMessages(text, targetLang) {
  return [
    {
      role: "system",
      content:
        `You are a professional translator.\n` +
        `Translate the input text into: ${targetLang}\n` +
        `Return only the translated text.`,
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
