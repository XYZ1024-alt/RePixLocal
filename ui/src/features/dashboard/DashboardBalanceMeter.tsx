import { Badge } from "@/components/ui/badge";
import { useLocale, useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { ProviderBalance, ProviderBalanceAccount } from "@/types";
import {
  BALANCE_METER_CLASS,
  BALANCE_STATUS_VARIANT,
  formatCheckedAt,
  MIN_VISIBLE_METER_PERCENT,
  providerBalanceLabel,
  providerBalanceMessage
} from "./dashboard-balance";

export function DashboardBalanceMeter({
  balance,
  relativeValue
}: {
  balance: ProviderBalance;
  relativeValue: number;
}) {
  const { locale } = useLocale();
  const t = useTranslations("dashboard");
  const checkedAt = formatCheckedAt(balance.checked_at, locale);
  const message = providerBalanceMessage(balance, t);

  return (
    <div className="group flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">
            {providerBalanceLabel(balance.provider)}
          </span>
          <Badge variant={BALANCE_STATUS_VARIANT[balance.status]}>
            {t(`balanceStatus.${balance.status}`)}
          </Badge>
        </div>
        <span className="text-muted-foreground">{checkedAt}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-inset ring-1 ring-inset ring-border">
        <div
          className={cn(
            "h-full origin-left rounded-full transition-transform duration-panel",
            BALANCE_METER_CLASS[balance.status]
          )}
          style={{
            transform: `scaleX(${Math.max(relativeValue, MIN_VISIBLE_METER_PERCENT) / 100})`
          }}
        />
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {balance.accounts.length > 0 ? (
        <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {balance.accounts.map((account) => (
            <BalanceAccount key={`${balance.provider}-${account.currency}`} info={account} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BalanceAccount({ info }: { info: ProviderBalanceAccount }) {
  const t = useTranslations("dashboard");
  return (
    <div className="rounded-md bg-surface-inset p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t("balanceCurrency")}</span>
        <span className="text-xs font-semibold">{info.currency}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <BalanceAmount label={t("balanceTotal")} value={info.total_balance} />
        {info.granted_balance ? (
          <BalanceAmount label={t("balanceGranted")} value={info.granted_balance} />
        ) : null}
        {info.topped_up_balance ? (
          <BalanceAmount label={t("balanceToppedUp")} value={info.topped_up_balance} />
        ) : null}
      </div>
    </div>
  );
}

function BalanceAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
