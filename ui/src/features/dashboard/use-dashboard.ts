import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "@/i18n/context";
import { useServices } from "@/services/context";
import type { DashboardData, ProviderBalance } from "@/types";
import { buildDashboardModel } from "./dashboard-model";

export type DashboardBalanceState = {
  data: ProviderBalance[] | null;
  loading: boolean;
  error: string | null;
};

export function useDashboard(data: DashboardData | null) {
  const { locale } = useLocale();
  const t = useTranslations("dashboard");
  const tStages = useTranslations("stages");
  const tStatus = useTranslations("status");
  const { balanceState, reloadBalances } = useProviderBalances();
  const model = useMemo(
    () =>
      data
        ? buildDashboardModel({ data, locale, t, tStages, tStatus })
        : null,
    [data, locale, t, tStages, tStatus]
  );

  return { balanceState, model, reloadBalances, t };
}

function useProviderBalances() {
  const { getProviderBalances } = useServices();
  const [balanceState, setBalanceState] = useState<DashboardBalanceState>({
    data: null,
    loading: true,
    error: null
  });

  const reloadBalances = useCallback(async () => {
    setBalanceState((state) => ({ ...state, loading: true, error: null }));
    try {
      const data = await getProviderBalances();
      setBalanceState({ data, loading: false, error: null });
    } catch (error) {
      setBalanceState({ data: null, loading: false, error: String(error) });
    }
  }, [getProviderBalances]);

  useEffect(() => {
    void reloadBalances();
  }, [reloadBalances]);

  return { balanceState, reloadBalances };
}
