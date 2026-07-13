import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/context";
import type { ReadinessState } from "@/types";

export function ReadinessNotice({
  readiness,
  onOpenSettings
}: {
  readiness: ReadinessState;
  onOpenSettings?: () => void;
}) {
  const t = useTranslations("wizard");
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
      role="status"
    >
      <div className="min-w-0 flex-1">
        <strong>{t("readinessAttention")}</strong>
        <span className="ml-2 text-muted-foreground">
          {t("readinessIssues", { count: readiness.issues.length })}
        </span>
      </div>
      {onOpenSettings ? (
        <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
          {t("openSettings")}
        </Button>
      ) : null}
    </div>
  );
}
