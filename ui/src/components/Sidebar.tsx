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
    <aside className="flex w-16 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 lg:w-60">
      <div className="flex h-16 items-center justify-center gap-3 border-b border-zinc-800 px-3 lg:justify-start lg:px-6">
        <span className="flex size-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-zinc-900 text-cyan-300 shadow-glow">
          <Clapperboard className="size-4" />
        </span>
        <span className="hidden text-sm font-bold tracking-tight text-white lg:inline">{t("brand")}</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-5 lg:px-3">
        {primaryNav.map(({ key, icon: Icon }) => {
          const active = activeView === key || (key === "console" && activeView === "console-detail");
          return (
            <button
              key={key}
              type="button"
              title={t(navLabelKeys[key])}
              onClick={() => onNavigate(key)}
              className={cn(
                "group relative flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-sm font-semibold transition-all duration-200 lg:justify-start",
                active
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-cyan-400 shadow-glow" />
              )}
              <Icon className={cn("size-4 transition-colors", active ? "text-cyan-300" : "group-hover:text-cyan-300")} />
              <span className="hidden lg:inline">{t(navLabelKeys[key])}</span>
            </button>
          );
        })}

        <div className="mt-4 hidden flex-col gap-1 lg:flex">
          {secondaryNav.map(({ key, icon: Icon }) => (
            <span
              key={key}
              className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-zinc-600"
            >
              <Icon className="size-4" />
              {t(key)}
            </span>
          ))}
        </div>
      </nav>

      <div className="border-t border-zinc-800 p-2 lg:p-4">
        <div className="hidden lg:block">
          <LanguageSwitcher />
        </div>
        <div className="mt-3 flex items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-2.5 text-sm transition-colors hover:border-zinc-700 lg:justify-start lg:px-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-white">
            LU
          </div>
          <div className="hidden min-w-0 flex-1 flex-col lg:flex">
            <span className="truncate text-xs font-semibold text-white">{t("localUser")}</span>
            <span className="truncate text-[10px] text-zinc-500">{t("localEmail")}</span>
          </div>
          <ChevronDown className="hidden size-3.5 text-zinc-500 lg:block" />
        </div>
      </div>
    </aside>
  );
}
