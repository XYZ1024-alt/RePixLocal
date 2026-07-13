import { Languages, MonitorCog, Palette } from "lucide-react";
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLocale, useTranslations } from "@/i18n/context";
import { type Locale } from "@/i18n/config";
import { useTheme, type ThemePreference } from "@/theme/context";

export function AppearanceSettings() {
  const t = useTranslations("settings");
  const { locale, setLocale } = useLocale();
  const { preference, resolvedTheme, setPreference } = useTheme();

  const themeOptions = (["system", "light", "dark"] as const).map((value) => ({
    value,
    label: t(`appearance.themeOptions.${value}`)
  }));
  const localeOptions = (["zh", "en"] as const).map((value) => ({
    value,
    label: t(`appearance.languageOptions.${value}`)
  }));

  return (
    <Panel>
      <PanelHeader>
        <div className="flex items-center gap-3">
          <Palette className="size-4 text-primary" />
          <PanelTitle>{t("appearance.title")}</PanelTitle>
        </div>
        <PanelDescription>{t("appearance.description")}</PanelDescription>
      </PanelHeader>
      <PanelContent className="divide-y divide-border">
        <PreferenceRow
          icon={MonitorCog}
          title={t("appearance.theme")}
          description={t("appearance.resolvedTheme", { theme: t(`appearance.themeOptions.${resolvedTheme}`) })}
        >
          <SegmentedControl<ThemePreference>
            value={preference}
            onValueChange={setPreference}
            options={themeOptions}
            aria-label={t("appearance.theme")}
          />
        </PreferenceRow>
        <PreferenceRow
          icon={Languages}
          title={t("appearance.language")}
          description={t("appearance.languageDescription")}
        >
          <SegmentedControl<Locale>
            value={locale}
            onValueChange={setLocale}
            options={localeOptions}
            aria-label={t("appearance.language")}
          />
        </PreferenceRow>
      </PanelContent>
    </Panel>
  );
}

function PreferenceRow(props: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-medium text-foreground">{props.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</p>
        </div>
      </div>
      <div className="shrink-0">{props.children}</div>
    </div>
  );
}
