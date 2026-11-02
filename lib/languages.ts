export type LanguageCode =
  | "auto"
  | "en-IN"
  | "hi-IN"
  | "te-IN"
  | "ta-IN"
  | "kn-IN"
  | "ml-IN"
  | "bn-IN"
  | "mr-IN"
  | "gu-IN"
  | "pa-IN"
  | "es-ES"
  | "fr-FR"
  | "ja-JP";

export type ProviderType = "gnani" | "gemini";

export interface LanguageMeta {
  code: LanguageCode;
  nativeName: string;
  englishName: string;
  category: "auto" | "indian" | "international";
  script: string;
  sttProvider: ProviderType;
  ttsProvider: ProviderType;
  ttsVoice?: string;
  gnaniCode?: string;
}

export const LANGUAGES: Record<LanguageCode, LanguageMeta> = {
  auto: {
    code: "auto",
    nativeName: "Auto-detect",
    englishName: "Auto-detect",
    category: "auto",
    script: "Auto",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "indic-auto",
  },
  // Indian Languages (Gnani Prisma STT + Gnani Timbre TTS)
  "en-IN": {
    code: "en-IN",
    nativeName: "English",
    englishName: "English (India)",
    category: "indian",
    script: "Latin",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "en-IN",
  },
  "hi-IN": {
    code: "hi-IN",
    nativeName: "हिन्दी",
    englishName: "Hindi",
    category: "indian",
    script: "Devanagari",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "hi-IN",
  },
  "te-IN": {
    code: "te-IN",
    nativeName: "తెలుగు",
    englishName: "Telugu",
    category: "indian",
    script: "Telugu",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "te-IN",
  },
  "ta-IN": {
    code: "ta-IN",
    nativeName: "தமிழ்",
    englishName: "Tamil",
    category: "indian",
    script: "Tamil",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "ta-IN",
  },
  "kn-IN": {
    code: "kn-IN",
    nativeName: "ಕನ್ನಡ",
    englishName: "Kannada",
    category: "indian",
    script: "Kannada",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "kn-IN",
  },
  "ml-IN": {
    code: "ml-IN",
    nativeName: "മലയാളം",
    englishName: "Malayalam",
    category: "indian",
    script: "Malayalam",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "ml-IN",
  },
  "bn-IN": {
    code: "bn-IN",
    nativeName: "বাংলা",
    englishName: "Bengali",
    category: "indian",
    script: "Bengali",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "bn-IN",
  },
  "mr-IN": {
    code: "mr-IN",
    nativeName: "मराठी",
    englishName: "Marathi",
    category: "indian",
    script: "Devanagari",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "mr-IN",
  },
  "gu-IN": {
    code: "gu-IN",
    nativeName: "ગુજરાતી",
    englishName: "Gujarati",
    category: "indian",
    script: "Gujarati",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "gu-IN",
  },
  "pa-IN": {
    code: "pa-IN",
    nativeName: "ਪੰਜਾਬੀ",
    englishName: "Punjabi",
    category: "indian",
    script: "Gurmukhi",
    sttProvider: "gnani",
    ttsProvider: "gnani",
    gnaniCode: "pa-IN",
  },
  // International Languages (Gemini Transcribe STT + Gemini 3.8 Flash TTS)
  "es-ES": {
    code: "es-ES",
    nativeName: "Español",
    englishName: "Spanish",
    category: "international",
    script: "Latin",
    sttProvider: "gemini",
    ttsProvider: "gemini",
    ttsVoice: "Kore",
  },
  "fr-FR": {
    code: "fr-FR",
    nativeName: "Français",
    englishName: "French",
    category: "international",
    script: "Latin",
    sttProvider: "gemini",
    ttsProvider: "gemini",
    ttsVoice: "Kore",
  },
  "ja-JP": {
    code: "ja-JP",
    nativeName: "日本語",
    englishName: "Japanese",
    category: "international",
    script: "Japanese",
    sttProvider: "gemini",
    ttsProvider: "gemini",
    ttsVoice: "Kore",
  },
};

export const INDIAN_LANGUAGES = Object.values(LANGUAGES).filter(
  (lang) => lang.category === "indian"
);

export const INTERNATIONAL_LANGUAGES = Object.values(LANGUAGES).filter(
  (lang) => lang.category === "international"
);

export function isInternationalLanguage(code: string): boolean {
  return code === "es-ES" || code === "fr-FR" || code === "ja-JP";
}

export function getLanguageMeta(code: string): LanguageMeta {
  if (code in LANGUAGES) {
    return LANGUAGES[code as LanguageCode];
  }
  return LANGUAGES["auto"];
}

