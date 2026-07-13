import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { defaultLocale, isLocale, LOCALE_STORAGE_KEY, type Locale } from "./config";

type MessageCatalog = Record<string, unknown>;

const catalogs: Record<Locale, MessageCatalog> = { zh, en };

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY) ?? undefined;
  return isLocale(stored) ? stored : defaultLocale;
}

function lookup(catalog: MessageCatalog, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = catalog;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as MessageCatalog)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, values?: Record<string, string | number>) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, token: string) => String(values[token] ?? `{${token}}`));
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}

export function useTranslations(namespace: string) {
  const { locale } = useLocale();

  return useCallback(
    (key: string, values?: Record<string, string | number>) => {
      const catalogKey = `${namespace}.${key}`;
      const text = lookup(catalogs[locale], catalogKey);
      if (text === undefined) {
        console.error(`[i18n] Missing ${locale} message: ${catalogKey}`);
      }
      return interpolate(text ?? key, values);
    },
    [locale, namespace]
  );
}
