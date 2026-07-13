import { CloudCog, MonitorCheck } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTranslations } from "@/i18n/context";
import type { CredentialState } from "./types";
import type { Settings, ToolCheck, WhisperModelStatus } from "@/types";

export function ReadinessSummary(props: {
  settings: Settings;
  tools: ToolCheck[];
  credentials: CredentialState;
  modelStatus: WhisperModelStatus | null;
}) {
  const t = useTranslations("settings");
  const local = getLocalReadiness(props.tools, props.modelStatus);
  const providers = getProviderReadiness(props.settings, props.credentials);
  const loading = props.credentials.loading || !props.tools.length || !props.modelStatus;
  const ready = local.ready && providers.ready;

  return (
    <Panel className="p-5" aria-live="polite">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{t("readiness.title")}</h2>
            {loading ? <Skeleton className="h-5 w-20 rounded-full" /> : (
              <StatusBadge status={ready ? "success" : "warning"}>
                {ready ? t("readiness.ready") : t("readiness.attention")}
              </StatusBadge>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {props.settings.mock_providers ? t("readiness.mockDescription") : t("readiness.realDescription")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[25rem]">
          <ReadinessItem icon={MonitorCheck} label={t("readiness.localRuntime")} ready={local.ready} detail={props.modelStatus?.downloading ? t("readiness.downloading") : props.modelStatus?.error ? t("readiness.failed") : t("readiness.readyCount", { count: local.count, total: local.total })} loading={!props.tools.length || !props.modelStatus} />
          <ReadinessItem icon={CloudCog} label={t("readiness.aiServices")} ready={providers.ready} detail={t("readiness.readyCount", { count: providers.count, total: providers.total })} loading={props.credentials.loading} />
        </div>
      </div>
    </Panel>
  );
}

function ReadinessItem(props: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ready: boolean;
  detail: string;
  loading: boolean;
}) {
  const Icon = props.icon;
  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {props.loading ? <Skeleton className="h-8 flex-1 rounded-md" /> : (
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{props.label}</p>
          <p className={props.ready ? "mt-0.5 text-xs text-success" : "mt-0.5 text-xs text-warning"}>{props.detail}</p>
        </div>
      )}
    </div>
  );
}

function getLocalReadiness(tools: ToolCheck[], modelStatus: WhisperModelStatus | null) {
  const required = ["ffmpeg", "ffprobe", "whisper"];
  const toolsReady = required.filter((name) => tools.some((tool) => tool.name === name && tool.found)).length;
  const count = toolsReady + Number(Boolean(modelStatus?.downloaded));
  return { ready: count === required.length + 1, count, total: required.length + 1 };
}

function getProviderReadiness(settings: Settings, state: CredentialState) {
  if (settings.mock_providers) return { ready: true, count: 3, total: 3 };
  const providers = ["DEEPSEEK", "SEEDANCE"];
  const readyProviders = providers.filter((provider) => state.credentials.some((credential) => credential.provider === provider && credential.masked_key && !credential.key_decrypt_failed)).length;
  const dashscopeReady = Boolean(
    state.dashscope?.masked_key && !state.dashscope.key_decrypt_failed &&
    state.dashscope.qwen_vl_model && state.dashscope.tongyi_model && state.dashscope.cosyvoice_model
  );
  const count = readyProviders + Number(dashscopeReady);
  return { ready: count === 3, count, total: 3 };
}
