import { encode } from "gpt-tokenizer";

export function countTokens(text) {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    const cjk = (text.match(/[一-鿿぀-ゟ゠-ヿ가-힣]/g) || []).length;
    return cjk + Math.ceil((text.length - cjk) / 4);
  }
}

export function getModelMultiplier(model) {
  switch (model) {
    case "gpt-5-chat-latest": return 18;
    case "gpt-4.1":           return 15;
    case "gpt-4.1-mini":      return 3;
    case "gpt-4o-mini":
    default:                  return 1;
  }
}
