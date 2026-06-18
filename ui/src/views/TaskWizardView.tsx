import { useState } from "react";
import {
  CheckCircle2,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  SlidersHorizontal,
  UploadCloud,
  X,
  type LucideIcon
} from "lucide-react";
import { createTask, getLatestRun, pickImageFiles, pickVideoFile, submitTask } from "@/api";
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
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_UPLOAD_BYTES,
  MIN_SCENE_COUNT,
  MIN_SOURCE_SUBTITLE_REGION_RATIO,
  RESOLUTIONS,
  REWRITE_LENGTHS,
  REWRITE_TONES,
  SOURCE_SUBTITLE_TREATMENTS,
  SUBTITLE_POSITIONS,
  TASK_TYPES,
  VOICES,
  taskConfigSchema,
  type TaskConfig
} from "@/lib/task-schema";
import { cn } from "@/lib/utils";
import type { PickedImageFile, PickedVideoFile } from "@/types";

type Phase = "idle" | "creating" | "submitting" | "done";
type StepStatus = "active" | "completed" | "pending";

const DEFAULT_CONFIG: TaskConfig = {
  taskType: "replicate",
  audioSource: "tts",
  requirements: "",
  imagePaths: [],
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
  const [images, setImages] = useState<PickedImageFile[]>([]);
  const [config, setConfig] = useState<TaskConfig>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle" && phase !== "done";
  const isImageTask = config.taskType === "image_to_video";
  const sourceReady = Boolean(
    title.trim() && (isImageTask ? images.length > 0 && config.requirements?.trim() : file)
  );
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

  async function handlePickImages() {
    if (busy) return;
    const picked = await pickImageFiles();
    if (!picked.length) return;
    const validationError = validatePickedImages(picked, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setImages(picked.slice(0, MAX_IMAGES));
    setConfig((current) => ({
      ...current,
      imagePaths: picked.slice(0, MAX_IMAGES).map((image) => image.path),
      sceneCount: Math.min(picked.length, MAX_IMAGES)
    }));
    if (!title.trim() && picked[0]) {
      setTitle(picked[0].name.replace(/\.[^.]+$/, ""));
    }
  }

  function removeImage(index: number) {
    setImages((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      setConfig((configState) => ({
        ...configState,
        imagePaths: next.map((image) => image.path),
        sceneCount: Math.max(next.length, MIN_SCENE_COUNT)
      }));
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError(t("invalidInput"));
      return;
    }
    if (isImageTask) {
      if (!images.length) {
        setError(t("selectImagesFirst"));
        return;
      }
      if (!config.requirements?.trim()) {
        setError(t("requirementsRequired"));
        return;
      }
    } else if (!file) {
      setError(t("selectFirst"));
      return;
    }

    try {
      setPhase("creating");
      const payloadConfig = {
        ...config,
        imagePaths: isImageTask ? images.map((image) => image.path) : undefined,
        sceneCount: isImageTask ? images.length : config.sceneCount
      };
      const task = await createTask({
        title: title.trim(),
        source_path: isImageTask ? "" : file!.path,
        config_json: payloadConfig
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
    setImages([]);
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
          <ModeSection
            busy={busy}
            taskType={config.taskType}
            onTaskTypeChange={(taskType) => {
              setConfig((current) => ({ ...current, taskType }));
              setError(null);
            }}
          />
          {isImageTask ? (
            <ImageSourceSection
              busy={busy}
              images={images}
              requirements={config.requirements ?? ""}
              title={title}
              onPickImages={handlePickImages}
              onRemoveImage={removeImage}
              onRequirementsChange={(requirements) =>
                setConfig((current) => ({ ...current, requirements }))
              }
              onTitleChange={setTitle}
            />
          ) : (
            <SourceSection
              busy={busy}
              file={file}
              title={title}
              onPickFile={handlePickFile}
              onTitleChange={setTitle}
            />
          )}
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

function ModeSection(props: {
  busy: boolean;
  taskType: TaskConfig["taskType"];
  onTaskTypeChange: (taskType: TaskConfig["taskType"]) => void;
}) {
  const t = useTranslations("wizard");
  return (
    <Panel icon={SlidersHorizontal} title={t("taskMode")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {TASK_TYPES.map((taskType) => (
          <button
            key={taskType}
            type="button"
            disabled={props.busy}
            onClick={() => props.onTaskTypeChange(taskType)}
            className={cn(
              "rounded-lg border px-4 py-3 text-left transition-colors",
              props.taskType === taskType
                ? "border-blue-400/50 bg-blue-500/10 text-blue-100"
                : "border-white/10 bg-[#0b1625] text-slate-300 hover:border-white/20"
            )}
          >
            <span className="block text-sm font-semibold">{t(`options.taskType.${taskType}`)}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {t(`options.taskTypeDesc.${taskType}`)}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function ImageSourceSection(props: {
  busy: boolean;
  images: PickedImageFile[];
  requirements: string;
  title: string;
  onPickImages: () => void;
  onRemoveImage: (index: number) => void;
  onRequirementsChange: (value: string) => void;
  onTitleChange: (value: string) => void;
}) {
  const t = useTranslations("wizard");
  return (
    <Panel icon={ImageIcon} title={t("sourceImages")}>
      <div
        onClick={() => !props.busy && props.onPickImages()}
        className={cn(
          "flex cursor-pointer items-center gap-4 rounded-lg border border-dashed border-blue-400/25 bg-blue-500/[0.05] p-4 transition-colors hover:border-blue-300/60",
          props.busy && "pointer-events-none opacity-60"
        )}
      >
        <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-[#0b1625] ring-1 ring-white/10">
          <UploadCloud className="size-7 text-blue-300" />
        </span>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{t("pickImages")}</span>
          <span className="text-xs text-muted-foreground">{t("pickImagesDesc")}</span>
        </div>
      </div>
      {props.images.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {props.images.map((image, index) => (
            <div
              key={image.path}
              className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-[#0b1625] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{image.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("sceneLabel", { index: index + 1 })} · {formatSize(image.size_bytes)}
                </p>
              </div>
              <button
                type="button"
                disabled={props.busy}
                onClick={() => props.onRemoveImage(index)}
                className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-red-300"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <Field label={t("requirements")}>
        <textarea
          value={props.requirements}
          onChange={(event) => props.onRequirementsChange(event.target.value)}
          placeholder={t("requirementsPlaceholder")}
          className={cn(inputClass, "min-h-28 resize-y py-2")}
          disabled={props.busy}
        />
      </Field>
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
  const isImageTask = props.config.taskType === "image_to_video";
  const update = <K extends keyof TaskConfig>(key: K, value: TaskConfig[K]) =>
    props.onConfigChange({ ...props.config, [key]: value });

  return (
    <Panel icon={SlidersHorizontal} title={t("pipelineOptions")}>
      <div className="grid gap-4 md:grid-cols-2">
        <ConfigSelect labelKey="resolution" value={props.config.resolution} onChange={(value) => update("resolution", value)} options={RESOLUTIONS} disabled={props.busy} />
        <ConfigSelect labelKey="aspectRatio" value={props.config.aspectRatio} onChange={(value) => update("aspectRatio", value)} options={ASPECT_RATIOS} disabled={props.busy} />
        <ConfigSelect labelKey="language" value={props.config.language} onChange={(value) => update("language", value)} options={LANGUAGES} disabled={props.busy} />
        <ConfigSelect labelKey="rewriteTone" value={props.config.rewriteTone} onChange={(value) => update("rewriteTone", value)} options={REWRITE_TONES} disabled={props.busy} />
        {!isImageTask ? (
          <ConfigSelect labelKey="rewriteLength" value={props.config.rewriteLength} onChange={(value) => update("rewriteLength", value)} options={REWRITE_LENGTHS} disabled={props.busy} />
        ) : null}
        <ConfigSelect labelKey="voice" value={props.config.voice} onChange={(value) => update("voice", value)} options={VOICES} disabled={props.busy} />
        {!isImageTask ? (
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
        ) : (
          <Field label={t("sceneCount")}>
            <input
              value={props.config.imagePaths?.length ?? 0}
              readOnly
              className={cn(inputClass, "opacity-70")}
            />
          </Field>
        )}
        {!isImageTask ? (
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
        ) : null}
        {!isImageTask && props.config.sourceSubtitleTreatment === "blur" ? (
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

function validatePickedImages(images: PickedImageFile[], t: (key: string, values?: Record<string, number | string>) => string) {
  if (images.length > MAX_IMAGES) {
    return t("tooManyImages", { count: MAX_IMAGES });
  }
  for (const image of images) {
    const ext = image.name.split(".").pop()?.toLowerCase();
    if (!ext || !["png", "jpg", "jpeg", "webp"].includes(ext)) {
      return t("unsupportedImageType");
    }
    if (image.size_bytes > MAX_IMAGE_BYTES) {
      return t("imageTooLarge");
    }
  }
  return null;
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