import { Bell, Circle, Maximize2, Menu } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useTranslations } from "@/i18n/context";
import type { ViewKey } from "@/types";

export function Shell(props: {
  activeView: ViewKey;
  children: ReactNode;
  hasError: boolean;
  onNavigate: (view: ViewKey) => void;
}) {
  const t = useTranslations("shell");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeView={props.activeView} onNavigate={props.onNavigate} />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[#081321]/[0.72]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-blue-500/15 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-muted-foreground lg:hidden">
              <Menu className="size-4" />
            </span>
            <span className="hidden size-9 items-center justify-center rounded-md text-muted-foreground lg:flex">
              <Menu className="size-4" />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={
                props.hasError
                  ? "hidden items-center gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 sm:flex"
                  : "hidden items-center gap-2 rounded-md border border-white/[0.08] bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 sm:flex"
              }
            >
              <Circle className={props.hasError ? "size-2 fill-amber-400 text-amber-400" : "size-2 fill-emerald-400 text-emerald-400"} />
              {props.hasError ? "Attention Required" : t("allSystemsOperational")}
            </div>
            <span className="flex size-9 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-muted-foreground">
              <Bell className="size-4" />
            </span>
            <span className="flex size-9 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-muted-foreground">
              <Maximize2 className="size-4" />
            </span>
          </div>
        </header>
        {props.children}
      </main>
    </div>
  );
}