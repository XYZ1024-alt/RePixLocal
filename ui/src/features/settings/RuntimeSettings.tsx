import { useEffect, useState, type FormEvent } from "react";
import { AudioLines, Film, RefreshCw, Save, Terminal, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTranslations } from "@/i18n/context";
import { useServices } from "@/services/context";
import type { Settings, ToolCheck, WhisperModelStatus } from "@/types";
import { FeedbackAlert } from "./FeedbackAlert";
import type { Feedback, SettingsTranslator } from "./types";

const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v3"] as const;

type RuntimeSettingsProps = {
  initialSettings: Settings;
  tools: ToolCheck[];
  activeWhisperModel: string;
  modelStatus: WhisperModelStatus | null;
  onEnsureWhisperModel: (model?: string) => void;
  onMessage: (value: string) => void;
  onRefresh: () => Promise<void>;
  onSaved: (settings: Settings) => void;
  onWhisperModelChange: (model: string) => void;
};

export function RuntimeSettings(props: RuntimeSettingsProps) {
  const t = useTranslations("settings");
  const { updateSettings } = useServices();
  const form = useRuntimeForm(props.initialSettings);
  const [saving, setSaving] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await updateSettings({
        workspace_root: props.initialSettings.workspace_root,
        ffmpeg_path: form.ffmpegBin.trim() || undefined,
        ffprobe_path: form.ffprobeBin.trim() || undefined,
        asr_model: props.activeWhisperModel,
        mock_providers: form.mockProviders,
        whisper_bin: form.whisperBin.trim() || undefined,
        whisper_model_dir: form.whisperModelDir.trim() || undefined
      });
      props.onSaved(saved);
      setFeedback({ type: "success", text: t("system.saved") });
    } catch (error) {
      setFeedback({ type: "error", text: t("failedToSave"), detail: String(error) });
    } finally {
      setSaving(false);
    }
  }

  async function recheck() {
    setRechecking(true);
    props.onEnsureWhisperModel(props.activeWhisperModel);
    try {
      await props.onRefresh();
    } catch (error) {
      props.onMessage(String(error));
    } finally {
      setRechecking(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
      <Panel>
        <PanelHeader icon={Wrench} title={t("system.configuration")} description={t("system.configurationDesc")} />
        <form onSubmit={save} className="space-y-5 p-5">
          <label htmlFor="mockProviders" className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/40 p-4 transition-colors duration-control hover:border-foreground/25">
            <input
              id="mockProviders"
              type="checkbox"
              checked={form.mockProviders}
              onChange={(event) => form.setMockProviders(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">{t("system.mockProviders")}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("system.mockProvidersHint")}</span>
            </span>
          </label>
          <FormField label={t("system.whisperModel")} htmlFor="asrModel" description={t("system.whisperHint")}>
            <Select value={props.activeWhisperModel} onValueChange={props.onWhisperModelChange}>
              <SelectTrigger id="asrModel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WHISPER_MODELS.map((model) => <SelectItem key={model} value={model}>{t(`system.whisperOptions.${model}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <RuntimePathFields form={form} workspaceRoot={props.initialSettings.workspace_root} t={t} />
          <FeedbackAlert feedback={feedback} />
          <Button type="submit" disabled={saving}>
            <Save />
            {saving ? t("saving") : t("system.save")}
          </Button>
        </form>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-3">
            <Terminal className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{t("system.externalTools")}</h3>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={recheck} disabled={rechecking}>
            <RefreshCw className={rechecking ? "animate-spin" : undefined} />
            {t("system.recheck")}
          </Button>
        </div>
        <div className="space-y-3 p-5" aria-live="polite">
          <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{props.initialSettings.workspace_root}</code>
          {!props.tools.length ? <ToolSkeleton /> : props.tools.map((tool) => (
            <ToolRow key={tool.name} tool={tool} modelStatus={props.modelStatus} t={t} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function RuntimePathFields(props: {
  form: ReturnType<typeof useRuntimeForm>;
  workspaceRoot: string;
  t: SettingsTranslator;
}) {
  const fields = [
    ["whisperBin", "system.whisperBin", "system.whisperBinHint", "system.whisperBinPlaceholder", props.form.whisperBin, props.form.setWhisperBin],
    ["whisperModelDir", "system.whisperModelDir", "system.whisperModelDirHint", null, props.form.whisperModelDir, props.form.setWhisperModelDir],
    ["ffmpegBin", "system.ffmpegPath", "system.ffmpegHint", "system.ffmpegPlaceholder", props.form.ffmpegBin, props.form.setFfmpegBin],
    ["ffprobeBin", "system.ffprobePath", "system.ffprobeHint", "system.ffprobePlaceholder", props.form.ffprobeBin, props.form.setFfprobeBin]
  ] as const;

  return <>{fields.map(([id, label, hint, placeholder, value, setValue]) => (
    <FormField key={id} label={props.t(label)} htmlFor={id} description={props.t(hint)}>
      <Input id={id} value={value} placeholder={placeholder ? props.t(placeholder) : props.workspaceRoot} onChange={(event) => setValue(event.target.value)} />
    </FormField>
  ))}</>;
}

function ToolRow(props: { tool: ToolCheck; modelStatus: WhisperModelStatus | null; t: SettingsTranslator }) {
  const Icon = TOOL_ICONS[props.tool.name] ?? Wrench;
  const downloading = props.tool.name === "whisper" && props.modelStatus?.downloading;
  const progress = downloading && props.modelStatus?.bytes_total
    ? Math.min(100, Math.round(((props.modelStatus.bytes_done ?? 0) / props.modelStatus.bytes_total) * 100))
    : null;

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              {props.tool.name}
              {props.tool.bundled ? <StatusBadge status="info">{props.t("system.bundled")}</StatusBadge> : null}
            </div>
            <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">{props.tool.path ?? props.tool.error}</p>
          </div>
        </div>
        <StatusBadge status={props.tool.found ? "success" : "error"}>
          {props.tool.found ? props.t("ready") : props.t("failed")}
        </StatusBadge>
      </div>
      {props.tool.name === "whisper" && props.modelStatus ? (
        <div className="mt-3">
          {progress !== null ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground"><span>{props.t("system.downloadingModel")}</span><span>{progress}%</span></div>
              <Progress value={progress} aria-label={props.t("system.downloadingModel")} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {props.modelStatus.downloaded
                ? props.t("system.modelReady", { model: props.modelStatus.model_name })
                : props.modelStatus.error || props.t("system.modelPending", { model: props.modelStatus.model_name })}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PanelHeader(props: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }) {
  const Icon = props.icon;
  return <div className="border-b border-border p-5"><div className="flex items-center gap-3"><Icon className="size-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">{props.title}</h3></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{props.description}</p></div>;
}

function ToolSkeleton() {
  return <div className="space-y-2" aria-hidden="true">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-16 w-full rounded-md" />)}</div>;
}

function useRuntimeForm(settings: Settings) {
  const [ffmpegBin, setFfmpegBin] = useState(settings.ffmpeg_path ?? "");
  const [ffprobeBin, setFfprobeBin] = useState(settings.ffprobe_path ?? "");
  const [whisperBin, setWhisperBin] = useState(settings.whisper_bin ?? "");
  const [whisperModelDir, setWhisperModelDir] = useState(settings.whisper_model_dir ?? "");
  const [mockProviders, setMockProviders] = useState(settings.mock_providers ?? true);
  useEffect(() => {
    setFfmpegBin(settings.ffmpeg_path ?? "");
    setFfprobeBin(settings.ffprobe_path ?? "");
    setWhisperBin(settings.whisper_bin ?? "");
    setWhisperModelDir(settings.whisper_model_dir ?? "");
    setMockProviders(settings.mock_providers ?? true);
  }, [settings]);
  return { ffmpegBin, setFfmpegBin, ffprobeBin, setFfprobeBin, whisperBin, setWhisperBin, whisperModelDir, setWhisperModelDir, mockProviders, setMockProviders };
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ffmpeg: Film,
  ffprobe: Film,
  whisper: AudioLines
};
