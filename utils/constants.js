export const OPENAI_PROXY_URL =
  "https://azgplnfczforimmtpznx.supabase.co/functions/v1/openai-proxy";

export const SUPABASE_URL =
  "https://azgplnfczforimmtpznx.supabase.co";

export const SUPABASE_REST_API_URL =
  "https://supabase-rest-api.bangcoderpro.workers.dev";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6Z3BsbmZjemZvcmltbXRwem54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1MDY1NTEsImV4cCI6MjA3MTA4MjU1MX0.M9MF6xmAUjSE1VKTF_Q027luPrMjwRa8_m1iSVyF5TM";


export const DOUBLE_COPY_THRESHOLD_MS = 500;

export const DEFAULT_SETTINGS = {
  mode: "translate",
  targetLang: "ko",
  model: "gpt-4o-mini",
  rewritePrompt: "proofread",
};

export const MODELS = [
  { id: "gpt-4o-mini",       label: "⚡️ Economic - ChatGPT 4o-mini" },
  { id: "gpt-4.1-mini",      label: "🟢 Standard - ChatGPT 4.1-mini" },
  { id: "gpt-4.1",           label: "🧠 Professional - ChatGPT 4.1" },
  { id: "gpt-5-chat-latest", label: "🚀 Advanced - ChatGPT 5" },
];

export const REWRITE_PROMPTS = {
  proofread: "Fix grammar and spelling errors while preserving meaning.",
  formal:    "Rewrite in a formal, professional tone.",
  casual:    "Rewrite in a casual, friendly tone.",
  concise:   "Make it concise and to the point.",
  expand:    "Expand with more details and examples.",
};

export const REWRITE_TYPES = [
  {
    id: "proofread",
    label: "⚙️ 교정",
    description: "문법과 맞춤법을 교정합니다.",
    prompt: "Please proofread the following text. Correct grammar, spelling, and punctuation errors.",
  },
  {
    id: "improve",
    label: "🔧 개선",
    description: "자연스럽게 문장을 다듬습니다.",
    prompt: "Improve the fluency and clarity of the following sentence. Make it sound more natural while preserving its meaning.",
  },
  {
    id: "elaborate",
    label: "📚 상세화",
    description: "내용을 더 자세히 설명합니다.",
    prompt: "Elaborate on the following sentence by adding relevant details or context. Expand the content without deviating from the original intent.",
  },
  {
    id: "clarify",
    label: "💡 명확화",
    description: "의미가 더 명확하게 전달되도록 합니다.",
    prompt: "Clarify the following sentence. Rewrite it to remove ambiguity and ensure the meaning is easy to understand.",
  },
  {
    id: "paraphrase",
    label: "✏️ 바꾸어쓰기",
    description: "같은 의미를 다른 단어와 문장 구조로 바꿉니다.",
    prompt: "Paraphrase the following sentence. Express the same meaning using different wording and structure.",
  },
  {
    id: "summarize",
    label: "📄 요약",
    description: "핵심 내용을 간단히 요약합니다.",
    prompt: "Summarize the following text by extracting and presenting only its main idea in a brief form.",
  },
];

export const LANGUAGES = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "vi", label: "Tiếng Việt" },
];
