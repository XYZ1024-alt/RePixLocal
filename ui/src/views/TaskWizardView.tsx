import { useState } from "react";
import {
  CheckCircle2,
  FileVideo,
  Loader2,
  SlidersHorizontal,
  UploadCloud,
  type LucideIcon
} from "lucide-react";
import { createTask, getLatestRun, pickVideoFile, submitTask } from "@/api";
import { PageHeader } from "@/components/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "@/i18n/context";
import {
  ASPECT_RATIOS,
  DEFAULT_SCENE_COUNT,
  DEFAULT_SOURCE_SUBTITLE_REGION_RATIO,
  DEFAULT_SUBTITLE_FONT_SIZE,
  LANGUAGES,
  MAX_SCENE_COUNT,
  MAX_SOURCE_SUBTITLE_REGION_RATIO,
  MAX_UPLOAD_BYTES,
  MIN_SCENE_COUNT,
  MIN_SOURCE_SUBTITLE_REGION_RATIO,
  RESOLUTIONS,
  REWRITE_LENGTHS,
  REWRITE_TONES,
  SOURCE_SUBTITLE_TREATMENTS,
  SUBTITLE_POSITIONS,
  VOICES,
  taskConfigSchema,
  type TaskConfig
} from "@/lib/task-schema";
import { cn } from "@/lib/utils";
import type { PickedVideoFile } from "@/types";

type Phase = "idle" | "creating" | "submitting" | "done";
type StepStatus = "active" | "completed" | "pending";

const DEFAULT_CONFIG: TaskConfig = {
  resolution: "1080p",
  aspectRatio: "16:9",
  language: "zh",
  rewriteTone: "faithful",
  rewriteLength: "same",
  voice: "female-1",
  subtitleSource: "corrected_asr",
  sourceSubtitleTreatment: "blur",
  sourceSubtitleRegionRatio: DEFAULT_SOURCE_SUBTITLE_REGION_RATIO,
  subtitleStyle: {
    font: "Noto Sans",
    size: DEFAULT_SUBTITLE_FONT_SIZE,
    color: "#FFFFFF",
    position: "bottom"
  },
  sceneCount: DEFAULT_SCENE_COUNT
};

const inputClass =
  "h-10 rounded-md border border-white/10 bg-[#0b1625] px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-blue-400/60 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60";
const PERCENT_SCALE = 100;

export function TaskWizardView(props: {
  onSubmitted: (runId: string) => Promise<void>;
}) {
  const t = useTranslations("wizard");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<PickedVideoFile | null>(null);
  const [config, setConfig] = useState<TaskConfig>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle" && phase !== "done";
  const sourceReady = Boolean(file && title.trim());
  const optionsReady = taskConfigSchema.safeParse(config).success;
  const steps = getWizardSteps({ sourceReady, optionsReady, phase, t });

  async function handlePickFile() {
    if (busy) return;
    const picked = await pickVideoFile();
    if (!picked) return;
    const validationError = validatePickedFile(picked, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setFile(picked);
    if (!title.trim()) {
      setTitle(picked.name.replace(/\.[^.]+$/, ""));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError(t("selectFirst"));
      return;
    }
    if (!title.trim()) {
      setError(t("invalidInput"));
      return;
    }

    try {
      setPhase("creating");
      const task = await createTask({
        title: title.trim(),
        source_path: file.path,
        config_json: config
      });
      setPhase("submitting");
      let runId: string | null = null;
      try {
        const response = await submitTask(task.id);
        runId = response.run_id;
      } catch {
        const latest = await getLatestRun(task.id);
        runId = latest?.id ?? null;
      }
      if (!runId) {
        throw new Error(t("errors.createResponseMissingUploadData"));
      }
      setPhase("done");
      await props.onSubmitted(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  function resetForm() {
    setTitle("");
    setFile(null);
    setConfig(DEFAULT_CONFIG);
    setError(null);
    setPhase("idle");
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <form
        onSubmit={handleSubmit}
        className="grid gap-5 px-4 pb-6 pt-3 lg:grid-cols-[260px_1fr] lg:px-6"
      >
        <WizardProgress steps={steps} />
        <div className="flex min-w-0 flex-col gap-4">
          <SourceSection
            busy={busy}
            file={file}
            title={title}
            onPickFile={handlePickFile}
            onTitleChange={setTitle}
          />
          <PipelineSection busy={busy} config={config} onConfigChange={setConfig} />
          {error ? (
            <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          ) : null}
          {phase !== "idle" ? (
            <p className="text-xs text-muted-foreground">{getPhaseLabel(phase, t)}</p>
          ) : null}
          <div className="flex justify-end gap-3 border-t border-white/[0.06] pt-4">
            <Button type="button" variant="outline" disabled={busy} onClick={resetForm}>
              {t("cancel")}
            </Button>
            <button
              type="submit"
              disabled={busy || !sourceReady}
              className={cn(buttonVariants(), "min-w-32", busy && "opacity-70")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {getPhaseLabel(phase, t)}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

type WizardStep = {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
};

function getWizardSteps(options: {
  sourceReady: boolean;
  optionsReady: boolean;
  phase: Phase;
  t: (key: string) => string;
}): WizardStep[] {
  const uploadCompleted = options.sourceReady && options.phase !== "idle";
  const submitActive = options.phase === "submitting";
  const submitCompleted = options.phase === "done";

  return [
    {
      key: "source",
      label: options.t("steps.source"),
      status: options.sourceReady ? "completed" : "active",
      detail: options.t(`stepStatus.${options.sourceReady ? "completed" : "active"}`)
    },
    {
      key: "options",
      label: options.t("steps.options"),
      status: options.optionsReady && options.sourceReady
        ? "completed"
        : options.sourceReady
          ? "active"
          : "pending",
      detail: options.t(
        `stepStatus.${
          options.optionsReady && options.sourceReady
            ? "completed"
            : options.sourceReady
              ? "active"
              : "pending"
        }`
      )
    },
    {
      key: "upload",
      label: options.t("steps.upload"),
      status: uploadCompleted ? "completed" : options.sourceReady ? "active" : "pending",
      detail: options.t(`stepStatus.${uploadCompleted ? "completed" : options.sourceReady ? "active" : "pending"}`)
    },
    {
      key: "submit",
      label: options.t("steps.submit"),
      status: submitCompleted ? "completed" : submitActive ? "active" : "pending",
      detail: options.t(`stepStatus.${submitCompleted ? "completed" : submitActive ? "active" : "pending"}`)
    },
    {
      key: "done",
      label: options.t("steps.done"),
      status: submitCompleted ? "completed" : "pending",
      detail: options.t(`stepStatus.${submitCompleted ? "completed" : "pending"}`)
    }
  ];
}

function WizardProgress({ steps }: { steps: WizardStep[] }) {
  return (
    <aside className="h-fit rounded-lg border border-white/[0.08] bg-[#07111f]/[0.88] p-4">
      <div className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <WizardStepItem key={step.key} index={index + 1} step={step} />
        ))}
      </div>
    </aside>
  );
}

function WizardStepItem({ index, step }: { index: number; step: WizardStep }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-3 transition-colors",
        step.status === "active" && "bg-blue-500/[0.13] text-blue-100",
        step.status === "completed" && "text-emerald-200",
        step.status === "pending" && "text-slate-400"
      )}
    >
      <StepIndex index={index} status={step.status} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{step.label}</span>
        <span className="text-xs text-muted-foreground">{step.detail}</span>
      </div>
    </div>
  );
}

function StepIndex({ index, status }: { index: number; status: StepStatus }) {
  const complete = status === "completed";
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        status === "active" && "bg-blue-500 text-white",
        complete && "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-300/30",
        status === "pending" && "bg-white/[0.07]"
      )}
    >
      {complete ? <CheckCircle2 className="size-4" /> : index}
    </span>
  );
}

function SourceSection(props: {
  busy: boolean;
  file: PickedVideoFile | null;
  title: string;
  onPickFile: () => void;
  onTitleChange: (value: string) => void;
}) {
  const t = useTranslations("wizard");

  return (
    <Panel icon={FileVideo} title={t("sourceVideo")}>
      <div
        onClick={() => !props.busy && props.onPickFile()}
        className={cn(
          "flex cursor-pointer items-center gap-4 rounded-lg border border-dashed border-blue-400/25 bg-blue-500/[0.05] p-4 transition-colors hover:border-blue-300/60",
          props.busy && "pointer-events-none opacity-60"
        )}
      >
        <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-[#0b1625] ring-1 ring-white/10">
          {props.file ? (
            <CheckCircle2 className="size-7 text-emerald-300" />
          ) : (
            <UploadCloud className="size-7 text-blue-300" />
          )}
        </span>
        {props.file ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm font-semibold">{props.file.name}</span>
            <span className="text-xs text-muted-foreground">{formatSize(props.file.size_bytes)}</span>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-semibold">{t("dragDrop")}</span>
            <span className="text-xs text-muted-foreground">{t("clickBrowse")}</span>
          </div>
        )}
      </div>
      <Field label={t("taskTitle")}>
        <input
          value={props.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
          placeholder={t("taskTitlePlaceholder")}
          className={inputClass}
          disabled={props.busy}
        />
      </Field>
    </Panel>
  );
}

function PipelineSection(props: {
  busy: boolean;
  config: TaskConfig;
  onConfigChange: (config: TaskConfig) => void;
}) {
  const t = useTranslations("wizard");
  const update = <K extends keyof TaskConfig>(key: K, value: TaskConfig[K]) =>
    props.onConfigChange({ ...props.config, [key]: value });

  return (
    <Panel icon={SlidersHorizontal} title={t("pipelineOptions")}>
      <div className="grid gap-4 md:grid-cols-2">
        <ConfigSelect labelKey="resolution" value={props.config.resolution} onChange={(value) => update("resolution", value)} options={RESOLUTIONS} disabled={props.busy} />
        <ConfigSelect labelKey="aspectRatio" value={props.config.aspectRatio} onChange={(value) => update("aspectRatio", value)} options={ASPECT_RATIOS} disabled={props.busy} />
        <ConfigSelect labelKey="language" value={props.config.language} onChange={(value) => update("language", value)} options={LANGUAGES} disabled={props.busy} />
        <ConfigSelect labelKey="rewriteTone" value={props.config.rewriteTone} onChange={(value) => update("rewriteTone", value)} options={REWRITE_TONES} disabled={props.busy} />
        <ConfigSelect labelKey="rewriteLength" value={props.config.rewriteLength} onChange={(value) => update("rewriteLength", value)} options={REWRITE_LENGTHS} disabled={props.busy} />
        <ConfigSelect labelKey="voice" value={props.config.voice} onChange={(value) => update("voice", value)} options={VOICES} disabled={props.busy} />
        <Field label={t("sceneCount")}>
          <input
            type="number"
            min={MIN_SCENE_COUNT}
            max={MAX_SCENE_COUNT}
            value={props.config.sceneCount}
            onChange={(event) => update("sceneCount", Number(event.target.value))}
            className={inputClass}
            disabled={props.busy}
          />
        </Field>
        <Field label={t("sourceSubtitleTreatment")}>
          <SelectInput
            value={props.config.sourceSubtitleTreatment}
            onChange={(sourceSubtitleTreatment) =>
              props.onConfigChange({ ...props.config, sourceSubtitleTreatment })
            }
            options={SOURCE_SUBTITLE_TREATMENTS}
            disabled={props.busy}
            getLabel={(option) => t(`options.sourceSubtitleTreatment.${option}`)}
          />
        </Field>
        {props.config.sourceSubtitleTreatment === "blur" ? (
          <Field label={t("sourceSubtitleRegionRatio")}>
            <input
              type="number"
              min={MIN_SOURCE_SUBTITLE_REGION_RATIO * PERCENT_SCALE}
              max={MAX_SOURCE_SUBTITLE_REGION_RATIO * PERCENT_SCALE}
              value={Math.round(props.config.sourceSubtitleRegionRatio * PERCENT_SCALE)}
              onChange={(event) =>
                props.onConfigChange({
                  ...props.config,
                  sourceSubtitleRegionRatio: Number(event.target.value) / PERCENT_SCALE
                })
              }
              className={inputClass}
              disabled={props.busy}
            />
          </Field>
        ) : null}
        <Field label={t("subtitlePosition")}>
          <SelectInput
            value={props.config.subtitleStyle.position}
            onChange={(position) =>
              props.onConfigChange({
                ...props.config,
                subtitleStyle: { ...props.config.subtitleStyle, position }
              })
            }
            options={SUBTITLE_POSITIONS}
            disabled={props.busy}
            getLabel={(option) => t(`options.subtitlePosition.${option}`)}
          />
        </Field>
      </div>
    </Panel>
  );
}

function ConfigSelect<T extends string>(props: {
  labelKey: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
  disabled: boolean;
}) {
  const t = useTranslations("wizard");
  return (
    <Field label={t(props.labelKey)}>
      <SelectInput
        value={props.value}
        onChange={props.onChange}
        options={props.options}
        disabled={props.disabled}
        getLabel={(option) => t(`options.${props.labelKey}.${option}`)}
      />
    </Field>
  );
}

function Panel({
  icon: Icon,
  title,
  children
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-cyan-400/10 text-cyan-300">
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function SelectInput<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
  disabled: boolean;
  getLabel: (value: T) => string;
}) {
  return (
    <select
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value as T)}
      className={inputClass}
    >
      {props.options.map((option) => (
        <option key={option} value={option}>
          {props.getLabel(option)}
        </option>
      ))}
    </select>
  );
}

function validatePickedFile(file: PickedVideoFile, t: (key: string) => string) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "mp4" && ext !== "mov") {
    return t("unsupportedType");
  }
  if (file.size_bytes > MAX_UPLOAD_BYTES) return t("tooLarge");
  return null;
}

function getPhaseLabel(phase: Phase, t: (key: string) => string) {
  if (phase === "creating") return t("creating");
  if (phase === "submitting") return t("submitting");
  if (phase === "done") return t("done");
  return t("createRun");
}

function formatSize(size: number) {
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}