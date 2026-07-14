import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { TaskConfig } from "@/lib/task-schema";
import { useServices } from "@/services/context";
import type { ProviderModelOption, WizardDraft } from "@/types";
import type {
  DraftChangeHandler,
  FieldErrors,
  WizardPhase,
  WizardStep,
  WizardTranslator
} from "./types";
import {
  DRAFT_KEY,
  DEFAULT_CONFIG,
  configForVideoModel,
  createPayload,
  hasDraftContent,
  initialVideoModel,
  readDraft,
  validateConfig,
  validateSource,
  voiceOptionsForModel
} from "./wizard-model";

type UseTaskWizardOptions = {
  t: WizardTranslator;
  onDirtyChange?: (dirty: boolean) => void;
  onSubmitted: (result: { taskId: string; runId: string }) => void | Promise<void>;
};

export function useTaskWizard(options: UseTaskWizardOptions) {
  const [draft, setDraft] = useState<WizardDraft>(readDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const video = useVideoOptions(setDraft);
  const submission = useWizardSubmission(draft, video.videoModels, setErrors, options);
  const busy = submission.phase !== "idle";

  useDraftPersistence(draft, video.videoDefaultConfig, options.onDirtyChange);
  const voice = useVoiceOptions(submission.setSubmitError);

  function updateConfig<K extends keyof TaskConfig>(key: K, value: TaskConfig[K]) {
    setDraft((current) => ({ ...current, config: { ...current.config, [key]: value } }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function updateVideoModel(modelId: string) {
    const model = video.videoModels.find((option) => option.id === modelId);
    if (!model) return;
    setDraft((current) => ({
      ...current,
      config: configForVideoModel(current.config, model)
    }));
    setErrors((current) => ({ ...current, videoModel: "", resolution: "" }));
  }

  function goNext() {
    const nextErrors =
      draft.step === 0
        ? validateSource(draft, options.t)
        : validateConfig(draft.config, video.videoModels, options.t);
    if (Object.keys(nextErrors).length > 0) return reportErrors(nextErrors, setErrors);
    setErrors({});
    setDraft((current) => ({
      ...current,
      step: Math.min(2, current.step + 1) as WizardStep
    }));
  }

  function selectStep(step: WizardStep) {
    if (!busy) setDraft((current) => ({ ...current, step }));
  }

  function goBack() {
    setDraft((current) => ({
      ...current,
      step: Math.max(0, current.step - 1) as WizardStep
    }));
  }

  return {
    draft,
    setDraft,
    errors,
    busy,
    updateConfig,
    updateVideoModel,
    goNext,
    selectStep,
    goBack,
    ...voice,
    ...video,
    ...submission,
    submitError: submission.submitError ?? video.videoModelsError
  };
}

function useWizardSubmission(
  draft: WizardDraft,
  videoModels: readonly ProviderModelOption[],
  setErrors: (errors: FieldErrors) => void,
  { t, onDirtyChange, onSubmitted }: UseTaskWizardOptions
) {
  const { createTask, submitTask } = useServices();
  const [phase, setPhase] = useState<WizardPhase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = {
      ...validateSource(draft, t),
      ...validateConfig(draft.config, videoModels, t)
    };
    if (Object.keys(nextErrors).length > 0) return reportErrors(nextErrors, setErrors);
    setSubmitError(null);
    try {
      setPhase("creating");
      const task = await createTask(createPayload(draft));
      setPhase("submitting");
      const response = await submitTask(task.id);
      sessionStorage.removeItem(DRAFT_KEY);
      onDirtyChange?.(false);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await onSubmitted({ taskId: task.id, runId: response.run_id });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      setPhase("idle");
    }
  }

  return { phase, submitError, setSubmitError, handleSubmit };
}

function useVideoOptions(setDraft: DraftChangeHandler) {
  const { listProviderCredentials, listProviderModels } = useServices();
  const [videoModels, setVideoModels] = useState<ProviderModelOption[]>([]);
  const [preferredVideoModel, setPreferredVideoModel] = useState<string>();
  const [videoModelsLoading, setVideoModelsLoading] = useState(true);
  const [videoModelsError, setVideoModelsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listProviderCredentials(), listProviderModels("SEEDANCE")])
      .then(([credentials, models]) => {
        if (!active) return;
        if (!models.length) throw new Error("Seedance returned no video models");
        setVideoModels(models);
        const preferred = credentials.find((item) => item.provider === "SEEDANCE")?.config?.model;
        setPreferredVideoModel(preferred);
        setDraft((current) => {
          const model = initialVideoModel(current.config, models, preferred);
          if (!model) return current;
          return { ...current, config: configForVideoModel(current.config, model) };
        });
      })
      .catch((error) => {
        if (active) setVideoModelsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setVideoModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listProviderCredentials, listProviderModels, setDraft]);

  const videoDefaultConfig = useMemo(() => {
    const defaultModel = initialVideoModel(DEFAULT_CONFIG, videoModels, preferredVideoModel);
    return defaultModel ? configForVideoModel(DEFAULT_CONFIG, defaultModel) : DEFAULT_CONFIG;
  }, [preferredVideoModel, videoModels]);
  return { videoModels, videoModelsLoading, videoModelsError, videoDefaultConfig };
}

function useDraftPersistence(
  draft: WizardDraft,
  defaultConfig: TaskConfig,
  onDirtyChange?: (dirty: boolean) => void
) {
  useEffect(() => {
    const dirty = hasDraftContent(draft, defaultConfig);
    onDirtyChange?.(dirty);
    if (dirty) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  }, [defaultConfig, draft, onDirtyChange]);
}

function useVoiceOptions(setError: (message: string | null) => void) {
  const { listDashscopeCredentials } = useServices();
  const [model, setModel] = useState<string | null>();
  const [voiceOptionsLoading, setVoiceOptionsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    listDashscopeCredentials()
      .then((credentials) => {
        if (active) setModel(credentials.cosyvoice_model ?? null);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setVoiceOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listDashscopeCredentials, setError]);

  return { voiceOptions: voiceOptionsForModel(model), voiceOptionsLoading };
}

function reportErrors(errors: FieldErrors, setErrors: (errors: FieldErrors) => void) {
  setErrors(errors);
  window.requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[data-field-error="true"]')?.focus()
  );
}
