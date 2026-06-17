import {
  BarChart3,
  ChevronDown,
  Clapperboard,
  FileText,
  LayoutDashboard,
  Library,
  Settings,
  TerminalSquare,
  Wand2,
  type LucideIcon
} from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { ViewKey } from "@/types";

const primaryNav: { key: ViewKey; icon: LucideIcon }[] = [
  { key: "dashboard", icon: LayoutDashboard },
  { key: "wizard", icon: Wand2 },
  { key: "console", icon: TerminalSquare },
  { key: "library", icon: Library },
  { key: "settings", icon: Settings }
];

const secondaryNav = [
  { key: "apiUsage", icon: BarChart3 },
  { key: "docs", icon: FileText }
] as const;

const navLabelKeys: Record<ViewKey, string> = {
  dashboard: "dashboard",
  wizard: "newTask",
  console: "console",
  "console-detail": "console",
  library: "library",
  settings: "settings"
};

export function Sidebar({
  activeView,
  onNavigate
}: {
  activeView: ViewKey;
  onNavigate: (view: ViewKey) => void;
}) {
  const t = useTranslations("nav");

  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-blue-500/15 bg-[#07111f]/90 lg:w-60">
      <div className="flex h-16 items-center justify-center gap-3 border-b border-blue-500/[0.12] px-3 lg:justify-start lg:px-6">
        <span className="flex size-8 items-center justify-center rounded-md bg-blue-500/[0.12] ring-1 ring-blue-400/30">
          <Clapperboard className="size-4 text-cyan-300" />
        </span>
        <span className="hidden text-sm font-semibold lg:inline">{t("brand")}</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-6 lg:px-4">
        {primaryNav.map(({ key, icon: Icon }) => {
          const active = activeView === key || (key === "console" && activeView === "console-detail");
          return (
            <button
              key={key}
              type="button"
              title={t(navLabelKeys[key])}
              onClick={() => onNavigate(key)}
              className={cn(
                "flex h-11 items-center justify-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors lg:justify-start",
                active
                  ? "bg-blue-500/[0.13] text-blue-100 ring-1 ring-blue-400/10"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
              )}
            >
              <Icon className={cn("size-4", active && "text-cyan-300")} />
              <span className="hidden lg:inline">{t(navLabelKeys[key])}</span>
            </button>
          );
        })}

        <div className="mt-4 hidden flex-col gap-1 lg:flex">
          {secondaryNav.map(({ key, icon: Icon }) => (
            <span
              key={key}
              className="flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-slate-500"
            >
              <Icon className="size-4" />
              {t(key)}
            </span>
          ))}
        </div>
      </nav>

      <div className="border-t border-blue-500/[0.12] p-2 lg:p-4">
        <div className="hidden lg:block">
          <LanguageSwitcher />
        </div>
        <div className="mt-2 flex items-center justify-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-3 text-sm lg:justify-start lg:px-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-500/25 text-xs font-semibold text-blue-100 ring-1 ring-blue-300/35">
            LU
          </div>
          <div className="hidden min-w-0 flex-1 flex-col lg:flex">
            <span className="truncate text-xs font-medium">{t("localUser")}</span>
            <span className="truncate text-xs text-muted-foreground">{t("localEmail")}</span>
          </div>
          <ChevronDown className="hidden size-3.5 text-muted-foreground lg:block" />
        </div>
      </div>
    </aside>
  );
}