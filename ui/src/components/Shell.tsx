import { Bell, Circle, Maximize2, Menu } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
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
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-black">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-800 bg-black/80 px-4 backdrop-blur-xl lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950/20 hover:text-cyan-300"
            >
              <Menu className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur sm:flex",
                props.hasError
                  ? "border-red-900/50 bg-red-950/40 text-red-200"
                  : "border-cyan-500/20 bg-cyan-950/20 text-cyan-100"
              )}
            >
              <Circle
                className={cn(
                  "size-2 fill-current",
                  props.hasError
                    ? "text-red-500"
                    : "animate-pulse-glow text-cyan-400 shadow-glow"
                )}
              />
              {props.hasError ? t("attentionRequired") : t("allSystemsOperational")}
            </div>
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950/20 hover:text-cyan-300"
            >
              <Bell className="size-4" />
            </button>
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950/20 hover:text-cyan-300"
            >
              <Maximize2 className="size-4" />
            </button>
          </div>
        </header>
        <div className="animate-fade-in">{props.children}</div>
      </main>
    </div>
  );
}
