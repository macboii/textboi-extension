export const OPENAI_PROXY_URL =
  "https://azgplnfczforimmtpznx.supabase.co/functions/v1/openai-proxy";

export const SUPABASE_URL =
  "https://azgplnfczforimmtpznx.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6Z3BsbmZjemZvcmltbXRwem54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1MDY1NTEsImV4cCI6MjA3MTA4MjU1MX0.M9MF6xmAUjSE1VKTF_Q027luPrMjwRa8_m1iSVyF5TM";

export const SUPABASE_REST_API_URL =
  "https://supabase-rest-api.bangcoderpro.workers.dev";

export const DOUBLE_COPY_THRESHOLD_MS = 500;

export const DEFAULT_SETTINGS = {
  mode: "translate",
  targetLang: "ko",
  model: "gpt-4o-mini",
  rewritePrompt: "proofread",
};

export const MODELS = [
  { id: "gpt-4o-mini", label: "Fast" },
  { id: "gpt-4o",      label: "Smart" },
  { id: "gpt-4.1",     label: "Advanced" },
];

export const REWRITE_PROMPTS = {
  proofread: "Fix grammar and spelling errors while preserving meaning.",
  formal:    "Rewrite in a formal, professional tone.",
  casual:    "Rewrite in a casual, friendly tone.",
  concise:   "Make it concise and to the point.",
  expand:    "Expand with more details and examples.",
};

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
