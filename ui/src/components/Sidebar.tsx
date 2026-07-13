import { Clapperboard, FolderOpen, Home, ListVideo, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { AppRoute } from "@/types";

const navigation: Array<{ key: AppRoute; icon: LucideIcon }> = [
  { key: "home", icon: Home },
  { key: "tasks", icon: ListVideo },
  { key: "assets", icon: FolderOpen },
  { key: "settings", icon: Settings }
];

function isActive(active: AppRoute, key: AppRoute) {
  if (key === "tasks") return active === "tasks" || active === "task-detail";
  return active === key;
}

export function Sidebar({
  activeRoute,
  collapsed,
  onNavigate
}: {
  activeRoute: AppRoute;
  collapsed: boolean;
  onNavigate: (route: AppRoute) => void;
}) {
  const t = useTranslations("nav");

  return (
    <aside
      className={cn(
        "relative z-20 flex shrink-0 flex-col border-r border-border bg-surface/90 backdrop-blur-xl",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className={cn("flex h-14 items-center border-b border-border px-3", collapsed ? "justify-center" : "gap-3")}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-elevated text-brand">
          <Clapperboard className="size-4" aria-hidden="true" />
        </span>
        {!collapsed ? <span className="text-sm font-semibold text-foreground">{t("brand")}</span> : null}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label={t("primaryNavigation")}>
        {navigation.map(({ key, icon: Icon }) => {
          const active = isActive(activeRoute, key);
          const button = (
            <button
              key={key}
              type="button"
              aria-current={active ? "page" : undefined}
              aria-label={t(key)}
              onClick={() => onNavigate(key)}
              className={cn(
                "relative flex h-10 items-center rounded-md px-3 text-sm font-medium transition-[background-color,color] duration-control ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed ? "justify-center" : "gap-3",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
              )}
            >
              {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-brand" /> : null}
              <Icon className={cn("size-4 shrink-0", active && "text-brand")} aria-hidden="true" />
              {!collapsed ? <span>{t(key)}</span> : null}
            </button>
          );
          return collapsed ? (
            <Tooltip key={key} content={t(key)} side="right">
              {button}
            </Tooltip>
          ) : button;
        })}
      </nav>
    </aside>
  );
}
