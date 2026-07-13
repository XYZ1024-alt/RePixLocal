import type {
  DashscopeCredentialView,
  ProviderCredentialView,
  ProviderModelOption,
  ReadinessState,
  Settings,
  ToolCheck
} from "@/types";

export type Provider = "DEEPSEEK" | "SEEDANCE";

export type Feedback = {
  type: "success" | "error";
  text: string;
  detail?: string;
};

export type ProviderModels = ProviderModelOption[] | null;

export type CredentialState = {
  credentials: ProviderCredentialView[];
  dashscope: DashscopeCredentialView | null;
  loading: boolean;
};

export type SettingsViewProps = {
  settings: Settings;
  tools: ToolCheck[];
  readiness?: ReadinessState;
  onEnsureWhisperModel: (model?: string) => void;
  onRefresh: () => Promise<void>;
  onSettingsSaved: (settings: Settings) => void;
  onMessage: (value: string) => void;
};

export type SettingsTranslator = (
  key: string,
  values?: Record<string, number | string>
) => string;
