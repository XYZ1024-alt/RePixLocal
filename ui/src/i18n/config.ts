export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh";
export const LOCALE_STORAGE_KEY = "LOCALE";

export function isLocale(value: string | undefined): value is Locale {
  return value === "zh" || value === "en";
}