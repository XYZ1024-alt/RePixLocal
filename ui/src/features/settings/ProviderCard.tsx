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
import type { ProviderCredentialView } from "@/types";
import { FeedbackAlert } from "./FeedbackAlert";
import { ModelField } from "./ModelField";
import { SecretField } from "./SecretField";
import type { Feedback, Provider, ProviderModels } from "./types";

type ProviderCardProps = {
  provider: Provider;
  label: string;
  description: string;
  credential?: ProviderCredentialView;
  onSaved: () => void | Promise<void>;
};

export function ProviderCard(props: ProviderCardProps) {
  const t = useTranslations("settings");
  const { listProviderModels, saveProviderCredential } = useServices();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(props.credential?.config?.base_url ?? "");
  const [model, setModel] = useState(props.credential?.config?.model ?? "");
  const [models, setModels] = useState<ProviderModels>(null);
  const [keyChanged, setKeyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null);
  const [validationFeedback, setValidationFeedback] = useState<Feedback | null>(null);
  const hasSavedKey = Boolean(props.credential?.masked_key) && !props.credential?.key_decrypt_failed;

  useEffect(() => {
    setBaseUrl(props.credential?.config?.base_url ?? "");
    setModel(props.credential?.config?.model ?? "");
  }, [props.credential?.config?.base_url, props.credential?.config?.model]);

  function changeKey(value: string) {
    setKey(value);
    setKeyChanged(true);
    setSaveFeedback(null);
    if (value) setModels(null);
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
      const fetched = await listProviderModels(props.provider, credentials);
      setModels(fetched.length ? fetched : null);
      if (!fetched.length) {
        setValidationFeedback({ type: "error", text: t("noModelsAvailable") });
        return;
      }
      setModel((current) => fetched.some((item) => item.id === current) ? current : fetched[0].id);
      setValidationFeedback({ type: "success", text: t("modelsFetched") });
    } catch (error) {
      setModels(null);
      setValidationFeedback({
        type: "error",
        text: t("failedToFetchModels"),
        detail: String(error)
      });
    } finally {
      setValidating(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const error = getSaveError({ key, hasSavedKey, model, keyChanged, models });
    if (error) {
      setSaveFeedback({ type: "error", text: t(error) });
      return;
    }
    setSaving(true);
    setSaveFeedback(null);
    try {
      await saveProviderCredential({
        provider: props.provider,
        label: "default",
        api_key: key,
        base_url: baseUrl,
        model
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
  const secretHint = getSecretHint({ decryptFailed, key, keyChanged, maskedKey: props.credential?.masked_key, t });

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <KeyRound className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{props.label}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</p>
          </div>
        </div>
        <StatusBadge status={decryptFailed ? "error" : hasSavedKey ? "success" : "neutral"}>
          {decryptFailed ? t("keyDecryptFailedBadge") : hasSavedKey ? t("configured") : t("notConfigured")}
        </StatusBadge>
      </div>
      <form onSubmit={save} className="space-y-4 p-5">
        <SecretField
          id={`${props.provider}-key`}
          label={t("apiKey")}
          value={key}
          placeholder={decryptFailed ? "sk-..." : props.credential?.masked_key || "sk-..."}
          revealLabel={t("revealApiKey")}
          hideLabel={t("hideApiKey")}
          hint={secretHint}
          onChange={changeKey}
        />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{t("model")}</span>
            <Button type="button" variant="outline" size="sm" onClick={validateModels} disabled={validating}>
              <RefreshCw className={cn(validating && "animate-spin")} />
              {validating ? t("fetchingModels") : t("fetchModels")}
            </Button>
          </div>
          <ModelField
            id={`${props.provider}-model`}
            label={t("model")}
            value={model}
            models={models}
            onChange={setModel}
            placeholder={t("fetchModelsToSelect")}
            selectPlaceholder={t("selectModel")}
            useCustomModelLabel={t("useCustomModel")}
            useProviderModelsLabel={t("useProviderModels")}
          />
          <FeedbackAlert feedback={validationFeedback} />
        </div>
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border-none">
            <AccordionTrigger className="text-sm">{t("advancedOptions")}</AccordionTrigger>
            <AccordionContent className="pt-2">
              <FormField label={t("baseUrl")} htmlFor={`${props.provider}-baseUrl`} description={t("baseUrlHint")}>
                <Input
                  id={`${props.provider}-baseUrl`}
                  type="url"
                  value={baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </FormField>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <FeedbackAlert feedback={saveFeedback} />
        <Button type="submit" disabled={saving || !model}>
          <Save />
          {saving ? t("saving") : t("save")}
        </Button>
      </form>
    </Panel>
  );
}

function getSaveError(input: {
  key: string;
  hasSavedKey: boolean;
  model: string;
  keyChanged: boolean;
  models: ProviderModels;
}) {
  if (!input.key && !input.hasSavedKey) return "apiKeyRequired";
  if (!input.model) return "modelRequired";
  if (input.keyChanged && !input.models) return "fetchModelsFirst";
  return null;
}

function getSecretHint(input: {
  decryptFailed?: boolean;
  key: string;
  keyChanged: boolean;
  maskedKey?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (input.decryptFailed && !input.key) return input.t("keyDecryptFailed");
  if (input.maskedKey && !input.key) return input.t("currentlySaved", { maskedKey: input.maskedKey });
  if (input.keyChanged && input.key) return input.t("keyChangedWarning");
  return undefined;
}
