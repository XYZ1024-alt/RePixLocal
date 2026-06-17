import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  Save,
  Wrench
} from "lucide-react";
import {
  listProviderCredentials,
  listProviderModels,
  saveProviderCredential,
  updateSettings
} from "@/api";
import { PageHeader } from "@/components/PageHeader";
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
import type { ProviderCredentialView, ProviderModelOption, Settings, ToolCheck } from "@/types";

type Provider = "DEEPSEEK" | "QWEN_VL" | "TONGYI" | "SEEDANCE";

const PROVIDERS: Provider[] = ["DEEPSEEK", "QWEN_VL", "TONGYI", "SEEDANCE"];

const PROVIDER_LABELS: Record<Provider, string> = {
  DEEPSEEK: "DeepSeek",
  QWEN_VL: "Qwen-VL",
  TONGYI: "Tongyi Wanxiang",
  SEEDANCE: "Seedance"
};

export function SettingsView(props: {
  settings: Settings;
  tools: ToolCheck[];
  onRefresh: () => Promise<void>;
  onSettingsSaved: (settings: Settings) => void;
  onMessage: (value: string) => void;
}) {
  const t = useTranslations("settings");
  const [credentials, setCredentials] = useState<ProviderCredentialView[]>([]);

  useEffect(() => {
    listProviderCredentials()
      .then(setCredentials)
      .catch((error) => props.onMessage(String(error)));
  }, [props.onMessage]);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="container mx-auto max-w-5xl px-4 pb-8 pt-2 lg:px-6">
        <Tabs defaultValue="providers" className="space-y-6">
          <TabsList>
            <TabsTrigger value="providers">{t("providerKeys")}</TabsTrigger>
            <TabsTrigger value="system">{t("systemSettings")}</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-4">
            {PROVIDERS.map((provider) => {
              const credential = credentials.find((entry) => entry.provider === provider);
              return (
                <ProviderKeyCard
                  key={provider}
                  provider={provider}
                  label={PROVIDER_LABELS[provider]}
                  description={t(`providerDesc.${provider}`)}
                  maskedKey={credential?.masked_key}
                  config={credential?.config}
                  onSaved={() =>
                    listProviderCredentials()
                      .then(setCredentials)
                      .catch((error) => props.onMessage(String(error)))
                  }
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

function ProviderKeyCard(props: {
  provider: Provider;
  label: string;
  description: string;
  maskedKey?: string;
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
  const isConfigured = Boolean(props.maskedKey);

  useEffect(() => {
    setBaseUrl(props.config?.base_url ?? "");
    setModel(props.config?.model ?? "");
  }, [props.config?.base_url, props.config?.model]);

  async function handleFetchModels() {
    setLoadingModels(true);
    setMessage(null);
    try {
      const fetched = await listProviderModels(props.provider);
      if (fetched.length > 0) {
        setModels(fetched);
        setUseCustomModel(false);
        setModel("");
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
    if (!key && !props.maskedKey) {
      setMessage({ type: "error", text: t("apiKeyRequired") });
      return;
    }
    if (!model) {
      setMessage({ type: "error", text: t("modelRequired") });
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
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-400/20">
              <Key className="size-5 text-blue-400" />
            </div>
            <div>
              <CardTitle>{props.label}</CardTitle>
              <CardDescription>{props.description}</CardDescription>
            </div>
          </div>
          <Badge variant={isConfigured ? "default" : "secondary"}>
            {isConfigured ? (
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
                placeholder={props.maskedKey || "sk-..."}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
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
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {props.maskedKey && !key ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("currentlySaved", { maskedKey: props.maskedKey })}
              </p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={`${props.provider}-model`} className="flex items-center gap-2">
                {t("model")}
                {!model ? <span className="text-xs text-red-500">*{t("required")}</span> : null}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleFetchModels}
                disabled={loadingModels}
                className="h-auto p-1 text-xs"
              >
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
                  className="mt-1 text-xs text-muted-foreground hover:underline"
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
                    className="mt-1 text-xs text-muted-foreground hover:underline"
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
              <span className={message.type === "success" ? "text-sm text-green-500" : "text-sm text-red-500"}>
                {message.text}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SystemSettingsForm(props: {
  initialSettings: Settings;
  tools: ToolCheck[];
  onRefresh: () => Promise<void>;
  onSaved: (settings: Settings) => void;
}) {
  const t = useTranslations("settings");
  const [asrModel, setAsrModel] = useState(props.initialSettings.asr_model ?? "base");
  const [ffmpegBin, setFfmpegBin] = useState(props.initialSettings.ffmpeg_path ?? "ffmpeg");
  const [ffprobeBin, setFfprobeBin] = useState(props.initialSettings.ffprobe_path ?? "ffprobe");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setAsrModel(props.initialSettings.asr_model ?? "base");
    setFfmpegBin(props.initialSettings.ffmpeg_path ?? "ffmpeg");
    setFfprobeBin(props.initialSettings.ffprobe_path ?? "ffprobe");
  }, [props.initialSettings]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = await updateSettings({
        workspace_root: props.initialSettings.workspace_root,
        ffmpeg_path: ffmpegBin,
        ffprobe_path: ffprobeBin,
        asr_model: asrModel
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
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-5" />
            {t("system.configuration")}
          </CardTitle>
          <CardDescription>{t("system.configurationDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
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
              <Label htmlFor="ffmpegBin">{t("system.ffmpegPath")}</Label>
              <Input
                id="ffmpegBin"
                value={ffmpegBin}
                onChange={(event) => setFfmpegBin(event.target.value)}
                placeholder="ffmpeg"
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
                placeholder="ffprobe"
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
                <span className={message.type === "success" ? "text-sm text-green-500" : "text-sm text-red-500"}>
                  {message.text}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("system.externalTools")}</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => props.onRefresh()}>
            <RefreshCw className="mr-2 size-4" />
            {t("system.recheck")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">{props.initialSettings.workspace_root}</p>
          {props.tools.map((tool) => (
            <div
              key={tool.name}
              className={tool.found ? "rounded-md border border-emerald-400/20 bg-emerald-500/5 px-3 py-2 text-sm" : "rounded-md border border-red-400/20 bg-red-500/5 px-3 py-2 text-sm"}
            >
              <div className="flex items-center justify-between gap-3">
                <strong>{tool.name}</strong>
                <span className="text-muted-foreground">{tool.path ?? tool.error}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}