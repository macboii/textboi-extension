export function applyTextCleanup(text) {
  let cleaned = text.trim();

  // 기본 문장부호 중복 제거 ("!!", "??" → "!", "?")
  cleaned = cleaned.replace(/([.!?])\1+/g, "$1");

  // 과도한 공백 정리 (2칸 이상 → 1칸)
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

  // 마지막 단어 반복 제거 (한글 포함 다국어 lookahead 방식)
  cleaned = cleaned.replace(
    /([\w가-힣ぁ-んァ-ン一-龥ー々〆çéèêáàâíìîóòôúùûüñ]+)\s+\1(?![가-힣\wぁ-んァ-ン一-龥ー々〆çéèêáàâíìîóòôúùûüñ])/g,
    "$1"
  );

  // 끝단 중복 종결어미 제거 — 완전 일치만 제거 (정상 문장 손상 방지)
  cleaned = cleaned.replace(
    /([가-힣\w]+[.!?。])\s+([가-힣]+[.!?。])$/,
    (_, a, b) => (a === b ? a : _)
  );
  cleaned = cleaned.replace(
    /([가-힣]+)([.!?])([가-힣]+)\2$/,
    (_, a, p, b) => (a.endsWith(b) ? a + p : _)
  );

  // 언어 공통 문장부호 중복 정리
  cleaned = cleaned
    .replace(/。+/g, "。")
    .replace(/，+/g, "，")
    .replace(/！+/g, "！")
    .replace(/？+/g, "？")
    .replace(/([!?])\1+/g, "$1");

  // 언어 혼합 종결 반복 방지
  cleaned = cleaned.replace(/([가-힣ぁ-んァ-ン一-龥]+[。.!?])\s*\1+/g, "$1");

  // 마침표 앞 공백 정리 ("안녕 ." → "안녕.")
  cleaned = cleaned.replace(/\s+([.!?])/g, "$1").trim();

  // 영어 문장 시작 대문자 보정
  cleaned = cleaned.replace(/(^|\.\s+)([a-z])/, (_, a, b) => a + b.toUpperCase());

  return cleaned;
}
