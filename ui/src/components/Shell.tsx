import { AlertTriangle, CheckCircle2, Menu, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { AppRoute, ReadinessState } from "@/types";

export function Shell({
  activeRoute,
  children,
  collapsed,
  readiness,
  onNavigate,
  onNewTask,
  onToggleSidebar
}: {
  activeRoute: AppRoute;
  children: ReactNode;
  collapsed: boolean;
  readiness: ReadinessState;
  onNavigate: (route: AppRoute) => void;
  onNewTask: () => void;
  onToggleSidebar: () => void;
}) {
  const t = useTranslations("shell");
  const ready = readiness.status === "ready";

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <Sidebar activeRoute={activeRoute} collapsed={collapsed} onNavigate={onNavigate} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur-xl sm:px-5">
          <IconButton
            type="button"
            variant="ghost"
            tooltip={t("toggleSidebar")}
            onClick={onToggleSidebar}
          >
            <Menu aria-hidden="true" />
          </IconButton>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate("settings")}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors duration-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ready
                  ? "border-success/25 bg-success/10 text-success"
                  : "border-warning/30 bg-warning/10 text-warning"
              )}
              aria-label={
                readiness.status === "checking"
                  ? t("checking")
                  : ready
                    ? t("ready")
                    : t("attentionRequired")
              }
              aria-live="polite"
            >
              {ready ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              <span className="hidden sm:inline">
                {readiness.status === "checking"
                  ? t("checking")
                  : ready
                    ? t("ready")
                    : t("attentionRequired")}
              </span>
            </button>
            <Button aria-label={t("newTask")} size="sm" onClick={onNewTask} data-testid="global-new-task">
              <Plus aria-hidden="true" />
              <span className="hidden sm:inline">{t("newTask")}</span>
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
