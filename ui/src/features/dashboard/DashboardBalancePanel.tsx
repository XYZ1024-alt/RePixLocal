import { useMemo } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { numericBalance } from "./dashboard-balance";
import { DashboardBalanceMeter } from "./DashboardBalanceMeter";
import { DashboardEmptyRow } from "./DashboardEmptyRow";
import type { DashboardBalanceState } from "./use-dashboard";

type BalanceRow = {
  balance: NonNullable<DashboardBalanceState["data"]>[number];
  value: number;
};

export function DashboardBalancePanel({
  state,
  onRefresh
}: {
  state: DashboardBalanceState;
  onRefresh: () => void;
}) {
  const rows = useMemo(() => {
    if (!state.data) return [];
    const values = state.data.map((balance) => numericBalance(balance.accounts)).filter((v) => v > 0);
    const max = Math.max(1, ...values);
    return state.data.map((balance) => ({
      balance,
      value: (numericBalance(balance.accounts) / max) * 100
    }));
  }, [state.data]);

  return (
    <Card className="overflow-hidden">
      <BalancePanelHeader loading={state.loading} onRefresh={onRefresh} />
      <BalancePanelContent state={state} rows={rows} />
    </Card>
  );
}

function BalancePanelHeader({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  const t = useTranslations("dashboard");
  return (
    <CardHeader className="flex-row items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-md bg-info/10 ring-1 ring-inset ring-info/20">
          <Wallet className="size-4 text-info" />
        </span>
        <CardTitle>{t("balanceTitle")}</CardTitle>
      </div>
      <IconButton
        disabled={loading}
        onClick={onRefresh}
        tooltip={t("refreshBalance")}
        type="button"
        variant="outline"
      >
        <RefreshCw className={cn("transition-transform", loading && "animate-spin")} />
      </IconButton>
    </CardHeader>
  );
}

function BalancePanelContent({
  state,
  rows
}: {
  state: DashboardBalanceState;
  rows: BalanceRow[];
}) {
  const t = useTranslations("dashboard");
  return (
    <CardContent className="flex flex-col gap-4">
      {state.loading && !state.data ? <BalanceSkeleton /> : null}
      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3">
          <p className="break-words text-xs leading-relaxed text-danger">
            {t("balanceError", { message: state.error })}
          </p>
        </div>
      ) : null}
      {state.data ? (
        <div className="flex flex-col gap-4">
          {rows.length > 0 ? (
            rows.map(({ balance, value }) => (
              <DashboardBalanceMeter
                key={balance.provider}
                balance={balance}
                relativeValue={value}
              />
            ))
          ) : (
            <DashboardEmptyRow text={t("noUsage")} />
          )}
        </div>
      ) : null}
    </CardContent>
  );
}

function BalanceSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="h-4 w-24 rounded bg-muted animate-pulse" />
            <span className="h-4 w-16 rounded bg-muted animate-pulse" />
          </div>
          <div className="h-2 rounded-full bg-muted animate-pulse" />
          <div className="h-3 w-32 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}
