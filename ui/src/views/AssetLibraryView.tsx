import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { listAllAssets, listTasks } from "@/api";
import { AssetSections } from "@/components/AssetSections";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/i18n/context";
import {
  ASSET_FILTERS,
  filterLibraryAssets,
  toLibraryAssets,
  type AssetFilterKey,
  type LibraryAsset
} from "@/lib/library";
import { cn } from "@/lib/utils";

export function AssetLibraryView(props: { onNewTask: () => void }) {
  const t = useTranslations("library");
  const tStatus = useTranslations("status");
  const [activeFilter, setActiveFilter] = useState<AssetFilterKey>("all");
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [rows, tasks] = await Promise.all([listAllAssets(), listTasks()]);
        if (!active) return;
        const taskTitles = Object.fromEntries(tasks.map((task) => [task.id, task.title]));
        setAssets(toLibraryAssets(rows, taskTitles));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const filteredAssets = useMemo(
    () => filterLibraryAssets(assets, activeFilter),
    [assets, activeFilter]
  );

  const filterLabels = useMemo(
    () => Object.fromEntries(ASSET_FILTERS.map((filter) => [filter.key, t(`filters.${filter.key}`)])),
    [t]
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={props.onNewTask} size="sm" type="button">
            <Upload />
            {t("upload")}
          </Button>
        }
      />
      <div className="animate-fade-in flex flex-col gap-5 px-4 pb-6 pt-3 lg:px-6">
        <FilterTabs
          activeFilter={activeFilter}
          labels={filterLabels}
          onSelect={(filter) => setActiveFilter(filter)}
        />
        {loading ? (
          <AssetLibrarySkeleton />
        ) : (
          <AssetSections
            assets={filteredAssets}
            emptyText={t("empty")}
            signingError={null}
            signingErrorLabel={t("signingError")}
            statusLabels={getStatusLabels(tStatus)}
          />
        )}
      </div>
    </>
  );
}

function FilterTabs({
  activeFilter,
  labels,
  onSelect
}: {
  activeFilter: AssetFilterKey;
  labels: Record<string, string>;
  onSelect: (filter: AssetFilterKey) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-2 backdrop-blur-sm">
      {ASSET_FILTERS.map((filter) => (
        <button
          key={filter.key}
          className={cn(
            "rounded-lg px-3.5 py-2 text-xs font-semibold transition-all duration-200",
            activeFilter === filter.key
              ? "bg-cyan-400 text-black shadow-glow"
              : "text-zinc-400 hover:bg-cyan-950/20 hover:text-cyan-300"
          )}
          onClick={() => onSelect(filter.key)}
          type="button"
        >
          {labels[filter.key]}
        </button>
      ))}
    </nav>
  );
}

function AssetLibrarySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/90 p-3"
        >
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function getStatusLabels(t: (key: string) => string) {
  return {
    READY: t("READY"),
    GENERATING: t("GENERATING"),
    FAILED: t("FAILED"),
    PENDING: t("PENDING")
  };
}
