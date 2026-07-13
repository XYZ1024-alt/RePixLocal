import type { ProviderBalance, ProviderBalanceAccount } from "@/types";
import type { DashboardTranslator } from "./dashboard-model";

export const MIN_VISIBLE_METER_PERCENT = 3;

export const BALANCE_METER_CLASS: Record<ProviderBalance["status"], string> = {
  available: "bg-success",
  unsupported: "bg-muted-foreground",
  not_configured: "bg-warning",
  error: "bg-danger"
};

export const BALANCE_STATUS_VARIANT: Record<
  ProviderBalance["status"],
  "success" | "warning" | "destructive" | "secondary"
> = {
  available: "success",
  unsupported: "secondary",
  not_configured: "warning",
  error: "destructive"
};

export function numericBalance(accounts: ProviderBalanceAccount[]): number {
  return accounts.reduce((sum, account) => sum + parseNumeric(account.total_balance), 0);
}

export function providerBalanceLabel(provider: string) {
  const labels: Record<string, string> = {
    DASHSCOPE: "DashScope",
    DEEPSEEK: "DeepSeek",
    SEEDANCE: "Seedance"
  };
  return labels[provider] ?? provider;
}

export function providerBalanceMessage(
  balance: ProviderBalance,
  t: DashboardTranslator
) {
  if (balance.status === "unsupported" && balance.provider === "DASHSCOPE") {
    return t("balanceUnsupportedDashscope");
  }
  if (balance.status === "unsupported" && balance.provider === "SEEDANCE") {
    return t("balanceUnsupportedSeedance");
  }
  if (balance.status === "not_configured") {
    return t("balanceNotConfigured", { provider: providerBalanceLabel(balance.provider) });
  }
  if (balance.status === "error") {
    return balance.message ?? t("balanceStatus.error");
  }
  return null;
}

export function formatCheckedAt(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function parseNumeric(value: string): number {
  const cleaned = value.replace(/[^\d.]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
