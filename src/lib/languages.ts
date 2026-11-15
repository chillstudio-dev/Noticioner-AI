import { z } from "zod";

export const languageSchema = z.enum([
  "en",
  "fr",
  "zh",
  "ms",
  "ja",
  "ko",
  "es",
  "ta",
  "da",
]);
export type SpeechLanguage = z.infer<typeof languageSchema>;
export const speechLanguages: { code: SpeechLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French · Français" },
  { code: "zh", label: "Mandarin · 普通话" },
  { code: "ms", label: "Malay · Bahasa Melayu" },
  { code: "ja", label: "Japanese · 日本語" },
  { code: "ko", label: "Korean · 한국어" },
  { code: "es", label: "Spanish · Español" },
  { code: "ta", label: "Tamil · தமிழ்" },
  { code: "da", label: "Danish · Dansk" },
];
