import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { listAllAssets, listTasks } from "@/api";
import { AssetSections } from "@/components/AssetSections";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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
      <div className="flex flex-col gap-5 px-4 pb-6 pt-3 lg:px-6">
        <FilterTabs
          activeFilter={activeFilter}
          labels={filterLabels}
          onSelect={(filter) => setActiveFilter(filter)}
        />
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
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
    <nav className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-card/[0.72] p-2">
      {ASSET_FILTERS.map((filter) => (
        <button
          key={filter.key}
          className={cn(
            "rounded-md px-3 py-2 text-xs font-semibold transition-colors",
            activeFilter === filter.key
              ? "bg-blue-500/[0.15] text-blue-100"
              : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
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

function getStatusLabels(t: (key: string) => string) {
  return {
    READY: t("READY"),
    GENERATING: t("GENERATING"),
    FAILED: t("FAILED"),
    PENDING: t("PENDING")
  };
}

