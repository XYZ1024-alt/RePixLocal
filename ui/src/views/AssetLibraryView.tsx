import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { AssetSections } from "@/components/AssetSections";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslations } from "@/i18n/context";
import {
  ASSET_FILTERS,
  filterLibraryAssets,
  toLibraryAssets,
  type AssetFilterKey,
  type LibraryAsset
} from "@/lib/library";
import { cn } from "@/lib/utils";
import { useServices } from "@/services/context";

export function AssetLibraryView() {
  const t = useTranslations("library");
  const tStatus = useTranslations("status");
  const { listAllAssets, listTasks, revealAsset } = useServices();
  const [activeFilter, setActiveFilter] = useState<AssetFilterKey>("all");
  const [query, setQuery] = useState("");
  const [taskId, setTaskId] = useState("all");
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const [rows, tasks] = await Promise.all([listAllAssets(), listTasks()]);
        if (!active) return;
        const taskTitles = Object.fromEntries(tasks.map((task) => [task.id, task.title]));
        setAssets(toLibraryAssets(rows, taskTitles));
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [listAllAssets, listTasks, retryVersion]);

  const taskOptions = useMemo(
    () => Array.from(new Map(assets.map((asset) => [asset.taskId, asset.taskTitle])).entries()),
    [assets]
  );

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return filterLibraryAssets(assets, activeFilter).filter((asset) => {
      if (taskId !== "all" && asset.taskId !== taskId) return false;
      if (!normalizedQuery) return true;
      return `${asset.taskTitle} ${asset.storageKey}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [activeFilter, assets, query, taskId]);

  const filterCounts = useMemo(
    () => Object.fromEntries(ASSET_FILTERS.map((filter) => [filter.key, filterLibraryAssets(assets, filter.key).length])),
    [assets]
  );

  const filterLabels = useMemo(
    () => Object.fromEntries(ASSET_FILTERS.map((filter) => [filter.key, t(`filters.${filter.key}`)])),
    [t]
  );

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-5 px-4 pb-6 pt-3 lg:px-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_240px]">
          <label className="relative">
            <span className="sr-only">{t("search")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} />
          </label>
          <Select value={taskId} onValueChange={setTaskId}>
            <SelectTrigger aria-label={t("taskFilter")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTasks")}</SelectItem>
              {taskOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <FilterTabs
          activeFilter={activeFilter}
          counts={filterCounts}
          labels={filterLabels}
          onSelect={(filter) => setActiveFilter(filter)}
        />
        {loading ? (
          <AssetLibrarySkeleton />
        ) : error ? (
          <Card>
            <EmptyState
              icon={AlertTriangle}
              title={t("loadError")}
              description={error}
              action={
                <Button
                  onClick={() => setRetryVersion((current) => current + 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw />
                  {t("retry")}
                </Button>
              }
            />
          </Card>
        ) : (
          <AssetSections
            assets={filteredAssets}
            emptyText={t("empty")}
            signingError={null}
            signingErrorLabel={t("signingError")}
            statusLabels={getStatusLabels(tStatus)}
            onRevealAsset={(path) => void revealAsset(path).catch((reason) => setError(errorMessage(reason)))}
          />
        )}
      </div>
    </>
  );
}

function FilterTabs({
  activeFilter,
  labels,
  counts,
  onSelect
}: {
  activeFilter: AssetFilterKey;
  labels: Record<string, string>;
  counts: Record<string, number>;
  onSelect: (filter: AssetFilterKey) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1" aria-label={labels.all}>
      {ASSET_FILTERS.map((filter) => (
        <button
          key={filter.key}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-control",
            activeFilter === filter.key
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
          onClick={() => onSelect(filter.key)}
          type="button"
        >
          {labels[filter.key]} <span className="tabular-nums opacity-70">{counts[filter.key] ?? 0}</span>
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
          className="flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card p-3"
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
