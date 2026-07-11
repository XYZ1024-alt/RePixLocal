import { useEffect, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  Eye,
  EyeOff,
  Film,
  Key,
  RefreshCw,
  Save,
  Terminal,
  Wrench
} from "lucide-react";
import {
  ensureWhisperModel,
  getWhisperModelStatus,
  listDashscopeCredentials,
  listProviderCredentials,
  listProviderModels,
  saveDashscopeCredential,
  saveProviderCredential,
  updateSettings
} from "@/api";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "@/i18n/context";
import type {
  DashscopeCredentialView,
  ProviderCredentialView,
  ProviderModelOption,
  Settings,
  ToolCheck,
  WhisperModelStatus
} from "@/types";

type Provider = "DEEPSEEK" | "SEEDANCE";

const PROVIDERS: Provider[] = ["DEEPSEEK", "SEEDANCE"];

const PROVIDER_LABELS: Record<Provider, string> = {
  DEEPSEEK: "DeepSeek",
  SEEDANCE: "Seedance"
};

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";

export function SettingsView(props: {
  settings: Settings;
  tools: ToolCheck[];
  onRefresh: () => Promise<void>;
  onSettingsSaved: (settings: Settings) => void;
  onMessage: (value: string) => void;
}) {
  const t = useTranslations("settings");
  const [credentials, setCredentials] = useState<ProviderCredentialView[]>([]);
  const [dashscope, setDashscope] = useState<DashscopeCredentialView | null>(null);

  function refreshCredentials() {
    return Promise.all([listProviderCredentials(), listDashscopeCredentials()])
      .then(([providerCredentials, dashscopeCredentials]) => {
        setCredentials(providerCredentials);
        setDashscope(dashscopeCredentials);
      })
      .catch((error) => props.onMessage(String(error)));
  }

  useEffect(() => {
    void refreshCredentials();
  }, [props.onMessage]);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="container mx-auto max-w-5xl px-4 pb-8 pt-2 lg:px-6">
        <Tabs defaultValue="providers" className="space-y-6">
          <TabsList>
            <TabsTrigger
              value="providers"
              className="data-[state=active]:bg-cyan-400 data-[state=active]:text-black data-[state=active]:shadow-glow"
            >
              {t("providerKeys")}
            </TabsTrigger>
            <TabsTrigger
              value="system"
              className="data-[state=active]:bg-cyan-400 data-[state=active]:text-black data-[state=active]:shadow-glow"
            >
              {t("systemSettings")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-4">
            <DashScopeKeyCard
              credential={dashscope}
              onSaved={() => refreshCredentials()}
            />
            {PROVIDERS.map((provider) => {
              const credential = credentials.find((entry) => entry.provider === provider);
              return (
                <ProviderKeyCard
                  key={provider}
                  provider={provider}
                  label={PROVIDER_LABELS[provider]}
                  description={t(`providerDesc.${provider}`)}
                  maskedKey={credential?.masked_key}
                  keyDecryptFailed={credential?.key_decrypt_failed}
                  config={credential?.config}
                  onSaved={() => refreshCredentials()}
                />
              );
            })}
          </TabsContent>

          <TabsContent value="system">
            <SystemSettingsForm
              initialSettings={props.settings}
              tools={props.tools}
              onRefresh={props.onRefresh}
              onSaved={props.onSettingsSaved}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function DashScopeKeyCard(props: {
  credential: DashscopeCredentialView | null;
  onSaved: () => void;
}) {
  const t = useTranslations("settings");
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_DASHSCOPE_BASE_URL);
  const [qwenVlModel, setQwenVlModel] = useState("");
  const [tongyiModel, setTongyiModel] = useState("");
  const [cosyvoiceModel, setCosyvoiceModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [qwenModels, setQwenModels] = useState<ProviderModelOption[] | null>(null);
  const [tongyiModels, setTongyiModels] = useState<ProviderModelOption[] | null>(null);
  const [cosyvoiceModels, setCosyvoiceModels] = useState<ProviderModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const hasSavedKey = Boolean(props.credential?.masked_key) && !props.credential?.key_decrypt_failed;
  const allModelsSelected = Boolean(qwenVlModel && tongyiModel && cosyvoiceModel);
  const isConfigured = hasSavedKey && allModelsSelected;

  useEffect(() => {
    setBaseUrl(props.credential?.base_url?.trim() || DEFAULT_DASHSCOPE_BASE_URL);
    setQwenVlModel(props.credential?.qwen_vl_model ?? "");
    setTongyiModel(props.credential?.tongyi_model ?? "");
    setCosyvoiceModel(props.credential?.cosyvoice_model ?? "");
  }, [
    props.credential?.base_url,
    props.credential?.qwen_vl_model,
    props.credential?.tongyi_model,
    props.credential?.cosyvoice_model
  ]);

  async function persistDashscope(models?: {
    qwen_vl_model: string;
    tongyi_model: string;
    cosyvoice_model: string;
  }) {
    await saveDashscopeCredential({
      api_key: key,
      base_url: baseUrl,
      qwen_vl_model: models?.qwen_vl_model ?? qwenVlModel,
      tongyi_model: models?.tongyi_model ?? tongyiModel,
      cosyvoice_model: models?.cosyvoice_model ?? cosyvoiceModel
    });
  }

  async function handleFetchModels() {
    if (!key && !hasSavedKey) {
      setMessage({ type: "error", text: t("apiKeyRequired") });
      return;
    }

    setLoadingModels(true);
    setMessage(null);

    try {
      if (key) {
        try {
          await persistDashscope();
          setKeyChanged(false);
        } catch {
          setMessage({ type: "error", text: t("failedToSaveKey") });
          return;
        }
      }

      const [qwenFetched, tongyiFetched, cosyFetched] = await Promise.all([
        listProviderModels("QWEN_VL"),
        listProviderModels("TONGYI"),
        listProviderModels("COSYVOICE")
      ]);

      if (qwenFetched.length > 0) {
        setQwenModels(qwenFetched);
      }
      if (tongyiFetched.length > 0) {
        setTongyiModels(tongyiFetched);
      }
      if (cosyFetched.length > 0) {
        setCosyvoiceModels(cosyFetched);
      }

      if (qwenFetched.length > 0 || tongyiFetched.length > 0 || cosyFetched.length > 0) {
        setMessage({ type: "success", text: t("modelsFetched") });
      } else {
        setMessage({ type: "error", text: t("noModelsAvailable") });
      }
    } catch {
      setMessage({ type: "error", text: t("failedToFetchModels") });
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!key && !hasSavedKey) {
      setMessage({ type: "error", text: t("apiKeyRequired") });
      return;
    }
    if (!qwenVlModel || !tongyiModel || !cosyvoiceModel) {
      setMessage({ type: "error", text: t("dashscope.allModelsRequired") });
      return;
    }
    if (keyChanged && !qwenModels && !tongyiModels && !cosyvoiceModels) {
      setMessage({ type: "error", text: t("fetchModelsFirst") });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await persistDashscope();
      setMessage({ type: "success", text: t("savedSuccessfully") });
      setKey("");
      setKeyChanged(false);
      props.onSaved();
      window.setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: "error", text: t("failedToSave") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-cyan-950/20 ring-1 ring-cyan-500/30">
              <Key className="size-5 text-cyan-400" />
            </div>
            <div>
              <CardTitle>{t("dashscope.title")}</CardTitle>
              <CardDescription>{t("dashscope.description")}</CardDescription>
            </div>
          </div>
          <Badge
            variant={
              props.credential?.key_decrypt_failed
                ? "destructive"
                : isConfigured
                  ? "default"
                  : "secondary"
            }
          >
            {props.credential?.key_decrypt_failed ? (
              <>
                <AlertCircle className="mr-1 size-3" /> {t("keyDecryptFailedBadge")}
              </>
            ) : isConfigured ? (
              <>
                <CheckCircle2 className="mr-1 size-3" /> {t("configured")}
              </>
            ) : (
              <>
                <AlertCircle className="mr-1 size-3" /> {t("notConfigured")}
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Label htmlFor="dashscope-key">{t("apiKey")}</Label>
            <div className="relative mt-1.5">
              <Input
                id="dashscope-key"
                type={showKey ? "text" : "password"}
                placeholder={
                  props.credential?.key_decrypt_failed
                    ? "sk-..."
                    : props.credential?.masked_key || "sk-..."
                }
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setKeyChanged(true);
                  if (event.target.value) {
                    setQwenModels(null);
                    setTongyiModels(null);
                    setCosyvoiceModels(null);
                  }
                }}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-cyan-400"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {props.credential?.key_decrypt_failed && !key ? (
              <p className="mt-1 text-xs text-red-400">{t("keyDecryptFailed")}</p>
            ) : null}
            {props.credential?.masked_key && !key && !props.credential?.key_decrypt_failed ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("currentlySaved", { maskedKey: props.credential.masked_key })}
              </p>
            ) : null}
            {props.credential?.keys_mismatch ? (
              <p className="mt-1 text-xs text-zinc-400">{t("dashscope.keysMismatch")}</p>
            ) : null}
            {keyChanged && key ? (
              <p className="mt-1 text-xs text-zinc-400">{t("keyChangedWarning")}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("dashscope.modelsHeading")}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFetchModels}
              disabled={loadingModels}
              className="h-auto px-2 py-1 text-xs"
            >
              <RefreshCw className={cn("mr-1.5 size-3", loadingModels && "animate-spin")} />
              {loadingModels ? t("fetchingModels") : t("fetchModels")}
            </Button>
          </div>

          <DashscopeModelField
            id="dashscope-qwen-vl-model"
            label={t("dashscope.qwenVlModel")}
            value={qwenVlModel}
            models={qwenModels}
            onChange={setQwenVlModel}
            placeholder={t("fetchModelsToSelect")}
            requiredLabel={t("required")}
            useCustomModelLabel={t("useCustomModel")}
            useProviderModelsLabel={t("useProviderModels")}
            selectPlaceholder={t("selectModel")}
          />
          <DashscopeModelField
            id="dashscope-tongyi-model"
            label={t("dashscope.tongyiModel")}
            value={tongyiModel}
            models={tongyiModels}
            onChange={setTongyiModel}
            placeholder={t("fetchModelsToSelect")}
            requiredLabel={t("required")}
            useCustomModelLabel={t("useCustomModel")}
            useProviderModelsLabel={t("useProviderModels")}
            selectPlaceholder={t("selectModel")}
          />
          <DashscopeModelField
            id="dashscope-cosyvoice-model"
            label={t("dashscope.cosyvoiceModel")}
            value={cosyvoiceModel}
            models={cosyvoiceModels}
            onChange={setCosyvoiceModel}
            placeholder={t("fetchModelsToSelect")}
            requiredLabel={t("required")}
            useCustomModelLabel={t("useCustomModel")}
            useProviderModelsLabel={t("useProviderModels")}
            selectPlaceholder={t("selectModel")}
          />

          <Accordion type="single" collapsible>
            <AccordionItem value="advanced" className="border-none">
              <AccordionTrigger className="text-sm">{t("advancedOptions")}</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-2">
                <div>
                  <Label htmlFor="dashscope-baseUrl">{t("baseUrl")}</Label>
                  <Input
                    id="dashscope-baseUrl"
                    type="url"
                    placeholder={DEFAULT_DASHSCOPE_BASE_URL}
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t("dashscope.baseUrlHint")}</p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !allModelsSelected}>
              <Save className="mr-2 size-4" />
              {saving ? t("saving") : t("save")}
            </Button>
            {message ? (
              <span
                className={
                  message.type === "success" ? "text-sm text-cyan-300" : "text-sm text-red-400"
                }
              >
                {message.text}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DashscopeModelField(props: {
  id: string;
  label: string;
  value: string;
  models: ProviderModelOption[] | null;
  onChange: (value: string) => void;
  placeholder: string;
  requiredLabel: string;
  useCustomModelLabel: string;
  useProviderModelsLabel: string;
  selectPlaceholder: string;
}) {
  const [useCustomModel, setUseCustomModel] = useState(false);

  useEffect(() => {
    if (!props.models?.length) {
      setUseCustomModel(true);
    }
  }, [props.models]);

  return (
    <div>
      <Label htmlFor={props.id} className="flex items-center gap-2">
        {props.label}
        {!props.value ? <span className="text-xs text-red-400">*{props.requiredLabel}</span> : null}
      </Label>
      {props.models && !useCustomModel ? (
        <>
          <Select value={props.value} onValueChange={props.onChange}>
            <SelectTrigger id={props.id} className="mt-1.5">
              <SelectValue placeholder={props.selectPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {props.models.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setUseCustomModel(true)}
            className="mt-1 text-xs text-muted-foreground hover:text-cyan-300 hover:underline"
          >
            {props.useCustomModelLabel}
          </button>
        </>
      ) : (
        <>
          <Input
            id={props.id}
            placeholder={props.placeholder}
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            className="mt-1.5"
          />
          {props.models ? (
            <button
              type="button"
              onClick={() => setUseCustomModel(false)}
              className="mt-1 text-xs text-muted-foreground hover:text-cyan-300 hover:underline"
            >
              {props.useProviderModelsLabel}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProviderKeyCard(props: {
  provider: Provider;
  label: string;
  description: string;
  maskedKey?: string;
  keyDecryptFailed?: boolean;
  config?: { base_url?: string; model?: string } | null;
  onSaved: () => void;
}) {
  const t = useTranslations("settings");
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(props.config?.base_url ?? "");
  const [model, setModel] = useState(props.config?.model ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [models, setModels] = useState<ProviderModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const hasSavedKey = Boolean(props.maskedKey) && !props.keyDecryptFailed;
  const isConfigured = hasSavedKey;

  useEffect(() => {
    setBaseUrl(props.config?.base_url ?? "");
    setModel(props.config?.model ?? "");
  }, [props.config?.base_url, props.config?.model]);

  async function handleFetchModels() {
    if (!key && !hasSavedKey) {
      setMessage({ type: "error", text: t("apiKeyRequired") });
      return;
    }

    setLoadingModels(true);
    setMessage(null);

    try {
      const fetched = await listProviderModels(
        props.provider,
        key ? { api_key: key, base_url: baseUrl } : undefined
      );
      if (fetched.length > 0) {
        setModels(fetched);
        setUseCustomModel(false);
        setModel((current) =>
          fetched.some((option) => option.id === current) ? current : fetched[0].id
        );
        setMessage({ type: "success", text: t("modelsFetched") });
      } else {
        setModels(null);
        setUseCustomModel(true);
        setMessage({ type: "error", text: t("noModelsAvailable") });
      }
    } catch {
      setMessage({ type: "error", text: t("failedToFetchModels") });
      setModels(null);
      setUseCustomModel(true);
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!key && !hasSavedKey) {
      setMessage({ type: "error", text: t("apiKeyRequired") });
      return;
    }
    if (!model) {
      setMessage({ type: "error", text: t("modelRequired") });
      return;
    }
    if (keyChanged && !models) {
      setMessage({ type: "error", text: t("fetchModelsFirst") });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await saveProviderCredential({
        provider: props.provider,
        label: "default",
        api_key: key,
        base_url: baseUrl,
        model
      });
      setMessage({ type: "success", text: t("savedSuccessfully") });
      setKey("");
      setKeyChanged(false);
      props.onSaved();
      window.setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: "error", text: t("failedToSave") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-cyan-950/20 ring-1 ring-cyan-500/30">
              <Key className="size-5 text-cyan-400" />
            </div>
            <div>
              <CardTitle>{props.label}</CardTitle>
              <CardDescription>{props.description}</CardDescription>
            </div>
          </div>
          <Badge
            variant={
              props.keyDecryptFailed ? "destructive" : isConfigured ? "default" : "secondary"
            }
          >
            {props.keyDecryptFailed ? (
              <>
                <AlertCircle className="mr-1 size-3" /> {t("keyDecryptFailedBadge")}
              </>
            ) : isConfigured ? (
              <>
                <CheckCircle2 className="mr-1 size-3" /> {t("configured")}
              </>
            ) : (
              <>
                <AlertCircle className="mr-1 size-3" /> {t("notConfigured")}
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Label htmlFor={`${props.provider}-key`}>{t("apiKey")}</Label>
            <div className="relative mt-1.5">
              <Input
                id={`${props.provider}-key`}
                type={showKey ? "text" : "password"}
                placeholder={
                  props.keyDecryptFailed ? "sk-..." : props.maskedKey || "sk-..."
                }
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setKeyChanged(true);
                  if (event.target.value) {
                    setModels(null);
                    setModel("");
                  }
                }}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-cyan-400"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {props.keyDecryptFailed && !key ? (
              <p className="mt-1 text-xs text-red-400">{t("keyDecryptFailed")}</p>
            ) : null}
            {props.maskedKey && !key && !props.keyDecryptFailed ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("currentlySaved", { maskedKey: props.maskedKey })}
              </p>
            ) : null}
            {keyChanged && key ? (
              <p className="mt-1 text-xs text-zinc-400">{t("keyChangedWarning")}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={`${props.provider}-model`} className="flex items-center gap-2">
                {t("model")}
                {!model ? <span className="text-xs text-red-400">*{t("required")}</span> : null}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchModels}
                disabled={loadingModels}
                className="h-auto px-2 py-1 text-xs"
              >
                <RefreshCw className={cn("mr-1.5 size-3", loadingModels && "animate-spin")} />
                {loadingModels ? t("fetchingModels") : t("fetchModels")}
              </Button>
            </div>

            {models && !useCustomModel ? (
              <>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id={`${props.provider}-model`} className="mt-1.5">
                    <SelectValue placeholder={t("selectModel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => setUseCustomModel(true)}
                  className="mt-1 text-xs text-muted-foreground hover:text-cyan-300 hover:underline"
                >
                  {t("useCustomModel")}
                </button>
              </>
            ) : (
              <>
                <Input
                  id={`${props.provider}-model`}
                  placeholder={t("fetchModelsToSelect")}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="mt-1.5"
                />
                {models ? (
                  <button
                    type="button"
                    onClick={() => setUseCustomModel(false)}
                    className="mt-1 text-xs text-muted-foreground hover:text-cyan-300 hover:underline"
                  >
                    {t("useProviderModels")}
                  </button>
                ) : null}
              </>
            )}
          </div>

          <Accordion type="single" collapsible>
            <AccordionItem value="advanced" className="border-none">
              <AccordionTrigger className="text-sm">{t("advancedOptions")}</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-2">
                <div>
                  <Label htmlFor={`${props.provider}-baseUrl`}>{t("baseUrl")}</Label>
                  <Input
                    id={`${props.provider}-baseUrl`}
                    type="url"
                    placeholder="https://api.example.com/v1"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t("baseUrlHint")}</p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !model}>
              <Save className="mr-2 size-4" />
              {saving ? t("saving") : t("save")}
            </Button>
            {message ? (
              <span className={message.type === "success" ? "text-sm text-cyan-300" : "text-sm text-red-400"}>
                {message.text}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ToolCheckRow({
  tool,
  modelStatus,
  t
}: {
  tool: ToolCheck;
  modelStatus: WhisperModelStatus | null;
  t: (key: string, values?: Record<string, number | string>) => string;
}) {
  const Icon = toolIcon[tool.name] ?? Wrench;
  const downloading = tool.name === "whisper" && modelStatus?.downloading;
  const progress =
    downloading && modelStatus && modelStatus.bytes_total
      ? Math.min(100, Math.round((modelStatus.bytes_done ?? 0) / modelStatus.bytes_total * 100))
      : null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border px-3 py-3 text-sm transition-all duration-200",
        tool.found
          ? "border-zinc-800 bg-zinc-900 hover:border-cyan-500/50"
          : "border-red-900/50 bg-red-950/40 hover:border-red-900/70"
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 h-full w-1",
          tool.found ? "bg-cyan-400 shadow-glow" : "bg-red-600"
        )}
      />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-lg",
              tool.found
                ? "bg-cyan-950/20 text-cyan-400 ring-1 ring-cyan-500/30"
                : "bg-zinc-900 text-red-400 ring-1 ring-zinc-700"
            )}
          >
            <Icon className="size-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <strong className="flex items-center gap-2 font-semibold">
              {tool.name}
              {tool.bundled ? (
                <span className="rounded-md border border-cyan-500/30 bg-cyan-950/30 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
                  {t("system.bundled")}
                </span>
              ) : null}
            </strong>
            <span className="text-xs text-muted-foreground">{tool.path ?? tool.error}</span>
          </div>
        </div>
        <div className="shrink-0">
          {tool.found ? (
            <CheckCircle2 className="size-5 text-cyan-400" />
          ) : (
            <AlertCircle className="size-5 text-red-400" />
          )}
        </div>
      </div>
      {tool.name === "whisper" && modelStatus ? (
        <div className="mt-3 pl-2">
          {downloading && progress !== null ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-cyan-300/80">{t("system.downloadingModel")}</span>
                <span className="font-medium text-cyan-300">{progress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-cyan-400 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <p
              className={cn(
                "text-xs",
                modelStatus.downloaded ? "text-cyan-300" : "text-muted-foreground"
              )}
            >
              {modelStatus.downloaded
                ? t("system.modelReady", { model: modelStatus.model_name })
                : modelStatus.error
                  ? modelStatus.error
                  : t("system.modelPending", { model: modelStatus.model_name })}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

const toolIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  ffmpeg: Film,
  ffprobe: Film,
  whisper: AudioLines
};

function SystemSettingsForm(props: {
  initialSettings: Settings;
  tools: ToolCheck[];
  onRefresh: () => Promise<void>;
  onSaved: (settings: Settings) => void;
}) {
  const t = useTranslations("settings");
  const [asrModel, setAsrModel] = useState(props.initialSettings.asr_model ?? "base");
  const [ffmpegBin, setFfmpegBin] = useState(props.initialSettings.ffmpeg_path ?? "");
  const [ffprobeBin, setFfprobeBin] = useState(props.initialSettings.ffprobe_path ?? "");
  const [modelStatus, setModelStatus] = useState<WhisperModelStatus | null>(null);
  const [whisperBin, setWhisperBin] = useState(props.initialSettings.whisper_bin ?? "");
  const [whisperModelDir, setWhisperModelDir] = useState(props.initialSettings.whisper_model_dir ?? "");
  const [mockProviders, setMockProviders] = useState(props.initialSettings.mock_providers ?? true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setAsrModel(props.initialSettings.asr_model ?? "base");
    setFfmpegBin(props.initialSettings.ffmpeg_path ?? "");
    setFfprobeBin(props.initialSettings.ffprobe_path ?? "");
    setWhisperBin(props.initialSettings.whisper_bin ?? "");
    setWhisperModelDir(props.initialSettings.whisper_model_dir ?? "");
    setMockProviders(props.initialSettings.mock_providers ?? true);
  }, [props.initialSettings]);

  useEffect(() => {
    getWhisperModelStatus(asrModel)
      .then(setModelStatus)
      .catch(() => setModelStatus(null));
  }, [asrModel, props.tools]);

  async function handleRecheck() {
    try {
      await ensureWhisperModel(asrModel);
    } catch {
      // check_ffmpeg surfaces errors in the tool list.
    }
    await props.onRefresh();
    const status = await getWhisperModelStatus(asrModel).catch(() => null);
    setModelStatus(status);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = await updateSettings({
        workspace_root: props.initialSettings.workspace_root,
        ffmpeg_path: ffmpegBin.trim() || undefined,
        ffprobe_path: ffprobeBin.trim() || undefined,
        asr_model: asrModel,
        mock_providers: mockProviders,
        whisper_bin: whisperBin.trim() || undefined,
        whisper_model_dir: whisperModelDir.trim() || undefined
      });
      props.onSaved(saved);
      setMessage({ type: "success", text: t("system.saved") });
      window.setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: "error", text: t("failedToSave") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-cyan-950/20 ring-1 ring-cyan-500/30">
              <Wrench className="size-5 text-cyan-400" />
            </div>
            {t("system.configuration")}
          </CardTitle>
          <CardDescription>{t("system.configurationDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <label
              htmlFor="mockProviders"
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-4 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950/20 hover:text-cyan-300"
            >
              <input
                id="mockProviders"
                type="checkbox"
                checked={mockProviders}
                onChange={(event) => setMockProviders(event.target.checked)}
                className="mt-0.5 size-4 rounded border-zinc-700 bg-zinc-950 text-white accent-cyan-400 ring-offset-background focus:ring-2 focus:ring-cyan-500"
              />
              <div>
                <span className="text-sm font-semibold">{t("system.mockProviders")}</span>
                <p className="mt-1 text-xs text-muted-foreground">{t("system.mockProvidersHint")}</p>
              </div>
            </label>

            <div>
              <Label htmlFor="asrModel">{t("system.whisperModel")}</Label>
              <Select value={asrModel} onValueChange={setAsrModel}>
                <SelectTrigger id="asrModel" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tiny">{t("system.whisperOptions.tiny")}</SelectItem>
                  <SelectItem value="base">{t("system.whisperOptions.base")}</SelectItem>
                  <SelectItem value="small">{t("system.whisperOptions.small")}</SelectItem>
                  <SelectItem value="medium">{t("system.whisperOptions.medium")}</SelectItem>
                  <SelectItem value="large-v3">{t("system.whisperOptions.large-v3")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">{t("system.whisperHint")}</p>
            </div>

            <div>
              <Label htmlFor="whisperBin">{t("system.whisperBin")}</Label>
              <Input
                id="whisperBin"
                value={whisperBin}
                onChange={(event) => setWhisperBin(event.target.value)}
                placeholder={t("system.whisperBinPlaceholder")}
                className="mt-1.5"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("system.whisperBinHint")}</p>
            </div>

            <div>
              <Label htmlFor="whisperModelDir">{t("system.whisperModelDir")}</Label>
              <Input
                id="whisperModelDir"
                value={whisperModelDir}
                onChange={(event) => setWhisperModelDir(event.target.value)}
                placeholder={props.initialSettings.workspace_root}
                className="mt-1.5"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("system.whisperModelDirHint")}</p>
            </div>

            <div>
              <Label htmlFor="ffmpegBin">{t("system.ffmpegPath")}</Label>
              <Input
                id="ffmpegBin"
                value={ffmpegBin}
                onChange={(event) => setFfmpegBin(event.target.value)}
                placeholder={t("system.ffmpegPlaceholder")}
                className="mt-1.5"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("system.ffmpegHint")}</p>
            </div>

            <div>
              <Label htmlFor="ffprobeBin">{t("system.ffprobePath")}</Label>
              <Input
                id="ffprobeBin"
                value={ffprobeBin}
                onChange={(event) => setFfprobeBin(event.target.value)}
                placeholder={t("system.ffprobePlaceholder")}
                className="mt-1.5"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">{t("system.ffprobeHint")}</p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                <Save className="mr-2 size-4" />
                {saving ? t("saving") : t("system.save")}
              </Button>
              {message ? (
                <span className={message.type === "success" ? "text-sm text-cyan-300" : "text-sm text-red-400"}>
                  {message.text}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-cyan-950/20 ring-1 ring-cyan-500/30">
              <Terminal className="size-5 text-cyan-400" />
            </div>
            {t("system.externalTools")}
          </CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={handleRecheck}>
            <RefreshCw className="mr-2 size-4" />
            {t("system.recheck")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-md bg-zinc-950 px-3 py-2 text-xs text-zinc-400 font-mono">
            {props.initialSettings.workspace_root}
          </p>
          <div className="space-y-2">
            {props.tools.map((tool) => (
              <ToolCheckRow key={tool.name} tool={tool} modelStatus={modelStatus} t={t} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
