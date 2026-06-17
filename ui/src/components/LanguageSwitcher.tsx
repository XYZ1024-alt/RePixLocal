import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "@/i18n/context";
import { locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const t = useTranslations("language");

  function pick(next: Locale) {
    if (next !== locale) {
      setLocale(next);
    }
  }

  return (
    <div className="flex items-center gap-2 px-1 py-1 text-sm">
      <Languages className="size-4 text-muted-foreground" />
      <div className="flex gap-1">
        {locales.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => pick(value)}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
              value === locale ? "bg-blue-500/15 text-blue-100" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(value)}
          </button>
        ))}
      </div>
    </div>
  );
}