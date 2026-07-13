import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/ui/page-container";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppearanceSettings } from "@/features/settings/AppearanceSettings";
import { DashscopeCard } from "@/features/settings/DashscopeCard";
import { ProviderCard } from "@/features/settings/ProviderCard";
import { ReadinessSummary } from "@/features/settings/ReadinessSummary";
import { RuntimeSettings } from "@/features/settings/RuntimeSettings";
import { useWhisperStatus } from "@/features/settings/useWhisperStatus";
import type { CredentialState, Provider, SettingsViewProps } from "@/features/settings/types";
import { useTranslations } from "@/i18n/context";
import { useServices } from "@/services/context";

const PROVIDERS: Provider[] = ["DEEPSEEK", "SEEDANCE"];
const PROVIDER_LABELS: Record<Provider, string> = {
  DEEPSEEK: "DeepSeek",
  SEEDANCE: "Seedance"
};

const EMPTY_CREDENTIALS: CredentialState = {
  credentials: [],
  dashscope: null,
  loading: true
};

export function SettingsView(props: SettingsViewProps) {
  const t = useTranslations("settings");
  const { listDashscopeCredentials, listProviderCredentials } = useServices();
  const savedWhisperModel = props.settings.asr_model ?? "base";
  const [credentialState, setCredentialState] = useState(EMPTY_CREDENTIALS);
  const [activeWhisperModel, setActiveWhisperModel] = useState(savedWhisperModel);
  const modelStatus = useWhisperStatus(activeWhisperModel, props.onMessage);

  useEffect(() => {
    setActiveWhisperModel(savedWhisperModel);
  }, [savedWhisperModel]);

  const refreshCredentials = useCallback(async () => {
    setCredentialState((current) => ({ ...current, loading: true }));
    try {
      const [credentials, dashscope] = await Promise.all([
        listProviderCredentials(),
        listDashscopeCredentials()
      ]);
      setCredentialState({ credentials, dashscope, loading: false });
    } catch (error) {
      setCredentialState((current) => ({ ...current, loading: false }));
      props.onMessage(String(error));
    }
  }, [listDashscopeCredentials, listProviderCredentials, props.onMessage]);

  useEffect(() => {
    void refreshCredentials();
  }, [refreshCredentials]);

  const handleCredentialSaved = useCallback(async () => {
    await refreshCredentials();
    props.onSettingsSaved(props.settings);
  }, [props.onSettingsSaved, props.settings, refreshCredentials]);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <PageContainer className="space-y-5 pb-8 pt-2">
        <ReadinessSummary
          settings={props.settings}
          tools={props.tools}
          credentials={credentialState}
          modelStatus={modelStatus}
        />
        <Tabs defaultValue="ai" className="space-y-5">
          <TabsList className="h-auto min-h-10 w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto">
            <TabsTrigger value="ai">{t("tabs.aiServices")}</TabsTrigger>
            <TabsTrigger value="runtime">{t("tabs.localRuntime")}</TabsTrigger>
            <TabsTrigger value="appearance">{t("tabs.appearance")}</TabsTrigger>
          </TabsList>
          <TabsContent value="ai" className="space-y-4">
            {credentialState.loading && !credentialState.dashscope && !credentialState.credentials.length ? (
              <CredentialSkeleton />
            ) : (
              <>
                <DashscopeCard credential={credentialState.dashscope} onSaved={handleCredentialSaved} />
                <div className="grid gap-4 xl:grid-cols-2">
                  {PROVIDERS.map((provider) => (
                    <ProviderCard
                      key={provider}
                      provider={provider}
                      label={PROVIDER_LABELS[provider]}
                      description={t(`providerDesc.${provider}`)}
                      credential={credentialState.credentials.find((item) => item.provider === provider)}
                      onSaved={handleCredentialSaved}
                    />
                  ))}
                </div>
              </>
            )}
          </TabsContent>
          <TabsContent value="runtime">
            <RuntimeSettings
              initialSettings={props.settings}
              tools={props.tools}
              activeWhisperModel={activeWhisperModel}
              modelStatus={modelStatus}
              onEnsureWhisperModel={props.onEnsureWhisperModel}
              onMessage={props.onMessage}
              onRefresh={props.onRefresh}
              onSaved={props.onSettingsSaved}
              onWhisperModelChange={setActiveWhisperModel}
            />
          </TabsContent>
          <TabsContent value="appearance">
            <AppearanceSettings />
          </TabsContent>
        </Tabs>
      </PageContainer>
    </>
  );
}

function CredentialSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <Panel key={item} className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-10 w-48 rounded-md" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-36 rounded-md" />
        </Panel>
      ))}
    </div>
  );
}
