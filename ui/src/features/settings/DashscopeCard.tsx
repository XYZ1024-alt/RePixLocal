import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, RefreshCw, Save } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTranslations } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { useServices } from "@/services/context";
import type { DashscopeCredentialView } from "@/types";
import { FeedbackAlert } from "./FeedbackAlert";
import { ModelField } from "./ModelField";
import { SecretField } from "./SecretField";
import type { Feedback, ProviderModels, SettingsTranslator } from "./types";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";

type ModelState = {
  qwen: ProviderModels;
  tongyi: ProviderModels;
  cosyvoice: ProviderModels;
};

const EMPTY_MODELS: ModelState = { qwen: null, tongyi: null, cosyvoice: null };

export function DashscopeCard(props: {
  credential: DashscopeCredentialView | null;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("settings");
  const { listProviderModels, saveDashscopeCredential } = useServices();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [qwenModel, setQwenModel] = useState("");
  const [tongyiModel, setTongyiModel] = useState("");
  const [cosyvoiceModel, setCosyvoiceModel] = useState("");
  const [models, setModels] = useState<ModelState>(EMPTY_MODELS);
  const [keyChanged, setKeyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null);
  const [validationFeedback, setValidationFeedback] = useState<Feedback | null>(null);
  const hasSavedKey = Boolean(props.credential?.masked_key) && !props.credential?.key_decrypt_failed;
  const allModelsSelected = Boolean(qwenModel && tongyiModel && cosyvoiceModel);

  useEffect(() => {
    setBaseUrl(props.credential?.base_url?.trim() || DEFAULT_BASE_URL);
    setQwenModel(props.credential?.qwen_vl_model ?? "");
    setTongyiModel(props.credential?.tongyi_model ?? "");
    setCosyvoiceModel(props.credential?.cosyvoice_model ?? "");
  }, [props.credential]);

  function changeKey(value: string) {
    setKey(value);
    setKeyChanged(true);
    setSaveFeedback(null);
    if (value) setModels(EMPTY_MODELS);
  }

  async function validateModels() {
    if (!key && !hasSavedKey) {
      setValidationFeedback({ type: "error", text: t("apiKeyRequired") });
      return;
    }
    setValidating(true);
    setValidationFeedback(null);
    try {
      const credentials = key ? { api_key: key, base_url: baseUrl } : undefined;
      const [qwen, tongyi, cosyvoice] = await Promise.all([
        listProviderModels("QWEN_VL", credentials),
        listProviderModels("TONGYI", credentials),
        listProviderModels("COSYVOICE", credentials)
      ]);
      setModels({ qwen: qwen.length ? qwen : null, tongyi: tongyi.length ? tongyi : null, cosyvoice: cosyvoice.length ? cosyvoice : null });
      selectFirstAvailable(qwenModel, qwen, setQwenModel);
      selectFirstAvailable(tongyiModel, tongyi, setTongyiModel);
      selectFirstAvailable(cosyvoiceModel, cosyvoice, setCosyvoiceModel);
      setValidationFeedback({
        type: qwen.length || tongyi.length || cosyvoice.length ? "success" : "error",
        text: qwen.length || tongyi.length || cosyvoice.length ? t("modelsFetched") : t("noModelsAvailable")
      });
    } catch (error) {
      setModels(EMPTY_MODELS);
      setValidationFeedback({ type: "error", text: t("failedToFetchModels"), detail: String(error) });
    } finally {
      setValidating(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const error = getSaveError({ key, hasSavedKey, allModelsSelected, keyChanged, models });
    if (error) {
      setSaveFeedback({ type: "error", text: t(error) });
      return;
    }
    setSaving(true);
    setSaveFeedback(null);
    try {
      await saveDashscopeCredential({
        api_key: key,
        base_url: baseUrl,
        qwen_vl_model: qwenModel,
        tongyi_model: tongyiModel,
        cosyvoice_model: cosyvoiceModel
      });
      setKey("");
      setKeyChanged(false);
      setSaveFeedback({ type: "success", text: t("savedSuccessfully") });
      await props.onSaved();
    } catch (error) {
      setSaveFeedback({ type: "error", text: t("failedToSave"), detail: String(error) });
    } finally {
      setSaving(false);
    }
  }

  const decryptFailed = props.credential?.key_decrypt_failed;
  const hint = getSecretHint({ credential: props.credential, key, keyChanged, t });

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"><KeyRound className="size-4" /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{t("dashscope.title")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("dashscope.description")}</p>
          </div>
        </div>
        <StatusBadge status={decryptFailed ? "error" : hasSavedKey && allModelsSelected ? "success" : "neutral"}>
          {decryptFailed ? t("keyDecryptFailedBadge") : hasSavedKey && allModelsSelected ? t("configured") : t("notConfigured")}
        </StatusBadge>
      </div>
      <form onSubmit={save} className="space-y-4 p-5">
        <SecretField
          id="dashscope-key"
          label={t("apiKey")}
          value={key}
          placeholder={decryptFailed ? "sk-..." : props.credential?.masked_key || "sk-..."}
          revealLabel={t("revealApiKey")}
          hideLabel={t("hideApiKey")}
          hint={hint}
          onChange={changeKey}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{t("dashscope.modelsHeading")}</span>
          <Button type="button" variant="outline" size="sm" onClick={validateModels} disabled={validating}>
            <RefreshCw className={cn(validating && "animate-spin")} />
            {validating ? t("fetchingModels") : t("fetchModels")}
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <ModelField {...modelFieldProps("dashscope-qwen-vl-model", t("dashscope.qwenVlModel"), qwenModel, models.qwen, setQwenModel, t)} />
          <ModelField {...modelFieldProps("dashscope-tongyi-model", t("dashscope.tongyiModel"), tongyiModel, models.tongyi, setTongyiModel, t)} />
          <ModelField {...modelFieldProps("dashscope-cosyvoice-model", t("dashscope.cosyvoiceModel"), cosyvoiceModel, models.cosyvoice, setCosyvoiceModel, t)} />
        </div>
        <FeedbackAlert feedback={validationFeedback} />
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border-none">
            <AccordionTrigger className="text-sm">{t("advancedOptions")}</AccordionTrigger>
            <AccordionContent className="pt-2">
              <FormField label={t("baseUrl")} htmlFor="dashscope-baseUrl" description={t("dashscope.baseUrlHint")}>
                <Input id="dashscope-baseUrl" type="url" value={baseUrl} placeholder={DEFAULT_BASE_URL} onChange={(event) => setBaseUrl(event.target.value)} />
              </FormField>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <FeedbackAlert feedback={saveFeedback} />
        <Button type="submit" disabled={saving || !allModelsSelected}>
          <Save />
          {saving ? t("saving") : t("save")}
        </Button>
      </form>
    </Panel>
  );
}

function modelFieldProps(
  id: string,
  label: string,
  value: string,
  models: ProviderModels,
  onChange: (value: string) => void,
  t: SettingsTranslator
) {
  return {
    id, label, value, models, onChange,
    placeholder: t("fetchModelsToSelect"),
    selectPlaceholder: t("selectModel"),
    useCustomModelLabel: t("useCustomModel"),
    useProviderModelsLabel: t("useProviderModels")
  };
}

function selectFirstAvailable(current: string, models: NonNullable<ProviderModels>, setValue: (value: string) => void) {
  if (models.length && !models.some((item) => item.id === current)) setValue(models[0].id);
}

function getSaveError(input: { key: string; hasSavedKey: boolean; allModelsSelected: boolean; keyChanged: boolean; models: ModelState }) {
  if (!input.key && !input.hasSavedKey) return "apiKeyRequired";
  if (!input.allModelsSelected) return "dashscope.allModelsRequired";
  if (input.keyChanged && !input.models.qwen && !input.models.tongyi && !input.models.cosyvoice) return "fetchModelsFirst";
  return null;
}

function getSecretHint(input: { credential: DashscopeCredentialView | null; key: string; keyChanged: boolean; t: SettingsTranslator }) {
  const { credential, key, keyChanged, t } = input;
  if (credential?.key_decrypt_failed && !key) return t("keyDecryptFailed");
  if (credential?.masked_key && !key) return t("currentlySaved", { maskedKey: credential.masked_key });
  if (credential?.keys_mismatch) return t("dashscope.keysMismatch");
  if (keyChanged && key) return t("keyChangedWarning");
  return undefined;
}
