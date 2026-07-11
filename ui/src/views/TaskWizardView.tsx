import { useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FileVideo,
  Image as ImageIcon,
  Images,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
  type LucideIcon
} from "lucide-react";
import { createTask, getLatestRun, pickImageFiles, pickVideoFile, submitTask } from "@/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
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

const PERCENT_SCALE = 100;

const TASK_TYPE_ICONS: Record<TaskConfig["taskType"], LucideIcon> = {
  replicate: Wand2,
  image_to_video: Images
};

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
  const busy = phase !== "idle";
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
        className="animate-fade-in grid gap-5 px-4 pb-6 pt-3 lg:grid-cols-[260px_1fr] lg:px-6"
      >
        <WizardProgress steps={steps} />
        <div className="flex min-w-0 flex-col gap-5">
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
            <div className="flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200 shadow-card">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
              {error}
            </div>
          ) : null}
          {phase !== "idle" ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="size-3.5 animate-spin" />
              {getPhaseLabel(phase, t)}
            </div>
          ) : null}
          <div className="flex justify-end gap-3 border-t border-zinc-800 pt-5">
            <Button type="button" variant="outline" disabled={busy} onClick={resetForm}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !sourceReady} className="min-w-32">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {getPhaseLabel(phase, t)}
            </Button>
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
      status:
        options.optionsReady && options.sourceReady
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
      detail: options.t(
        `stepStatus.${uploadCompleted ? "completed" : options.sourceReady ? "active" : "pending"}`
      )
    },
    {
      key: "submit",
      label: options.t("steps.submit"),
      status: submitCompleted ? "completed" : submitActive ? "active" : "pending",
      detail: options.t(
        `stepStatus.${submitCompleted ? "completed" : submitActive ? "active" : "pending"}`
      )
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
    <aside className="h-fit rounded-xl border border-zinc-800 bg-zinc-950/90 p-5 shadow-card backdrop-blur-xl">
      <div className="flex flex-col">
        {steps.map((step, index) => (
          <WizardStepItem
            key={step.key}
            index={index + 1}
            step={step}
            isLast={index === steps.length - 1}
          />
        ))}
      </div>
    </aside>
  );
}

function WizardStepItem({
  index,
  step,
  isLast
}: {
  index: number;
  step: WizardStep;
  isLast: boolean;
}) {
  return (
    <div className="group flex gap-3">
      <div className="flex flex-col items-center py-1">
        <StepIndex index={index} status={step.status} />
        {!isLast ? (
          <span
            className={cn(
              "mt-2 h-full w-px transition-colors",
              step.status === "completed" ? "bg-cyan-500/40" : "bg-zinc-800"
            )}
          />
        ) : null}
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col gap-0.5 rounded-lg px-3 py-2 transition-colors",
          step.status === "active" && "bg-cyan-950/30 text-white",
          step.status === "completed" && "text-zinc-200",
          step.status === "pending" && "text-zinc-500"
        )}
      >
        <span className="truncate text-sm font-semibold">{step.label}</span>
        <span className="text-xs text-zinc-400">{step.detail}</span>
      </div>
    </div>
  );
}

function StepIndex({ index, status }: { index: number; status: StepStatus }) {
  const complete = status === "completed";
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200",
        status === "active" && "bg-cyan-400 text-black ring-1 ring-cyan-300/50 shadow-glow",
        complete &&
          "bg-cyan-950/40 text-cyan-300 ring-1 ring-cyan-500/40",
        status === "pending" && "bg-zinc-950 text-zinc-500 ring-1 ring-zinc-800"
      )}
    >
      {complete ? <Check className="size-4" /> : index}
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
      <div className="grid gap-4 sm:grid-cols-2">
        {TASK_TYPES.map((taskType) => {
          const TypeIcon = TASK_TYPE_ICONS[taskType];
          const selected = props.taskType === taskType;
          return (
            <button
              key={taskType}
              type="button"
              disabled={props.busy}
              onClick={() => props.onTaskTypeChange(taskType)}
              className={cn(
                "group relative flex flex-col gap-3 rounded-xl border p-5 text-left transition-all duration-200",
                selected
                  ? "border-cyan-400/60 bg-cyan-950/20 text-white shadow-glow"
                  : "border-zinc-800 bg-black text-zinc-300 hover:border-cyan-500/50 hover:bg-cyan-950/10 hover:shadow-card"
              )}
            >
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-lg transition-colors",
                  selected
                    ? "bg-cyan-950/50 text-cyan-300 ring-1 ring-cyan-500/40"
                    : "bg-zinc-900 text-zinc-500 group-hover:bg-cyan-950/30 group-hover:text-cyan-300"
                )}
              >
                <TypeIcon className="size-5" />
              </span>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{t(`options.taskType.${taskType}`)}</span>
                <span className="text-xs leading-relaxed text-zinc-400">
                  {t(`options.taskTypeDesc.${taskType}`)}
                </span>
              </div>
              {selected ? (
                <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-cyan-400 text-black shadow-glow">
                  <Check className="size-3" />
                </span>
              ) : null}
            </button>
          );
        })}
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
          "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-800 bg-black p-8 text-center transition-all duration-200 hover:border-cyan-500/50 hover:bg-cyan-950/10 hover:shadow-card",
          props.busy && "pointer-events-none opacity-60"
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-xl bg-cyan-950/30 text-cyan-300 shadow-card ring-1 ring-cyan-500/30 transition-all duration-200 group-hover:scale-110 group-hover:bg-cyan-950/50 group-hover:text-cyan-200 group-hover:ring-cyan-400/50">
          <UploadCloud className="size-7" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("pickImages")}</span>
          <span className="text-xs text-zinc-400">{t("pickImagesDesc")}</span>
        </div>
      </div>
      {props.images.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {props.images.map((image, index) => (
            <div
              key={image.path}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 shadow-card transition-all duration-200 hover:border-cyan-500/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-cyan-950/20 text-cyan-400 ring-1 ring-cyan-500/20">
                <ImageIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{image.name}</p>
                <p className="text-xs text-zinc-400">
                  {t("sceneLabel", { index: index + 1 })} · {formatSize(image.size_bytes)}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={props.busy}
                onClick={() => props.onRemoveImage(index)}
                className="size-8 text-zinc-500 hover:text-red-400"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <Field label={t("requirements")}>
        <textarea
          value={props.requirements}
          onChange={(event) => props.onRequirementsChange(event.target.value)}
          placeholder={t("requirementsPlaceholder")}
          className="flex min-h-28 w-full resize-y rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white shadow-inner transition-all duration-200 placeholder:text-zinc-500 focus-visible:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={props.busy}
        />
      </Field>
      <Field label={t("taskTitle")}>
        <Input
          value={props.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
          placeholder={t("taskTitlePlaceholder")}
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
          "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-800 bg-black p-8 text-center transition-all duration-200 hover:border-cyan-500/50 hover:bg-cyan-950/10 hover:shadow-card",
          props.busy && "pointer-events-none opacity-60"
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-xl bg-cyan-950/30 text-cyan-300 shadow-card ring-1 ring-cyan-500/30 transition-all duration-200 group-hover:scale-110 group-hover:bg-cyan-950/50 group-hover:text-cyan-200 group-hover:ring-cyan-400/50">
          {props.file ? (
            <CheckCircle2 className="size-7 text-cyan-400" />
          ) : (
            <UploadCloud className="size-7" />
          )}
        </span>
        {props.file ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-semibold">{props.file.name}</span>
            <span className="text-xs text-zinc-400">{formatSize(props.file.size_bytes)}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{t("dragDrop")}</span>
            <span className="text-xs text-zinc-400">{t("clickBrowse")}</span>
          </div>
        )}
      </div>
      <Field label={t("taskTitle")}>
        <Input
          value={props.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
          placeholder={t("taskTitlePlaceholder")}
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
      <div className="grid gap-5 md:grid-cols-2">
        <ConfigSelect
          labelKey="resolution"
          value={props.config.resolution}
          onChange={(value) => update("resolution", value)}
          options={RESOLUTIONS}
          disabled={props.busy}
        />
        <ConfigSelect
          labelKey="aspectRatio"
          value={props.config.aspectRatio}
          onChange={(value) => update("aspectRatio", value)}
          options={ASPECT_RATIOS}
          disabled={props.busy}
        />
        <ConfigSelect
          labelKey="language"
          value={props.config.language}
          onChange={(value) => update("language", value)}
          options={LANGUAGES}
          disabled={props.busy}
        />
        <ConfigSelect
          labelKey="rewriteTone"
          value={props.config.rewriteTone}
          onChange={(value) => update("rewriteTone", value)}
          options={REWRITE_TONES}
          disabled={props.busy}
        />
        {!isImageTask ? (
          <ConfigSelect
            labelKey="rewriteLength"
            value={props.config.rewriteLength}
            onChange={(value) => update("rewriteLength", value)}
            options={REWRITE_LENGTHS}
            disabled={props.busy}
          />
        ) : null}
        <ConfigSelect
          labelKey="voice"
          value={props.config.voice}
          onChange={(value) => update("voice", value)}
          options={VOICES}
          disabled={props.busy}
        />
        {!isImageTask ? (
          <Field label={t("sceneCount")}>
            <Input
              type="number"
              min={MIN_SCENE_COUNT}
              max={MAX_SCENE_COUNT}
              value={props.config.sceneCount}
              onChange={(event) => update("sceneCount", Number(event.target.value))}
              disabled={props.busy}
            />
          </Field>
        ) : (
          <Field label={t("sceneCount")}>
            <Input value={props.config.imagePaths?.length ?? 0} readOnly className="opacity-70" />
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
            <Input
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
        <CardTitle className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-950/30 text-cyan-400 ring-1 ring-cyan-500/30">
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <Label>{label}</Label>
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
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(value as T)}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem key={option} value={option}>
            {props.getLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function validatePickedImages(
  images: PickedImageFile[],
  t: (key: string, values?: Record<string, number | string>) => string
) {
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
