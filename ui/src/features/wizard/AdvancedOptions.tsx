import { Input } from "@/components/ui/input";
import { useTranslations } from "@/i18n/context";
import {
  MAX_SCENE_COUNT,
  MAX_SOURCE_SUBTITLE_REGION_RATIO,
  MIN_SCENE_COUNT,
  MIN_SOURCE_SUBTITLE_REGION_RATIO,
  NARRATIVE_SOURCES,
  REWRITE_LENGTHS,
  REWRITE_TONES,
  SOURCE_SUBTITLE_TREATMENTS,
  type TaskConfig
} from "@/lib/task-schema";
import type { ConfigChangeHandler, FieldErrors } from "./types";
import { WizardField } from "./WizardField";
import { WizardSelectField } from "./WizardSelectField";

const PERCENT_SCALE = 100;

export function AdvancedOptions({
  config,
  errors,
  imageTask,
  onChange
}: {
  config: TaskConfig;
  errors: FieldErrors;
  imageTask: boolean;
  onChange: ConfigChangeHandler;
}) {
  const t = useTranslations("wizard");
  return (
    <div className="grid gap-4 pt-2 md:grid-cols-2">
      {!imageTask ? <NarrativeSource config={config} errors={errors} onChange={onChange} /> : null}
      <WizardSelectField
        label={t("rewriteTone")}
        error={errors.rewriteTone}
        value={config.rewriteTone}
        options={REWRITE_TONES}
        onChange={(value) => onChange("rewriteTone", value)}
        getLabel={(value) => t(`options.rewriteTone.${value}`)}
      />
      {!imageTask ? <RewriteLength config={config} errors={errors} onChange={onChange} /> : null}
      {!imageTask ? <SceneCount config={config} errors={errors} onChange={onChange} /> : null}
      {!imageTask ? <SubtitleTreatment config={config} errors={errors} onChange={onChange} /> : null}
      {!imageTask && config.sourceSubtitleTreatment === "blur" ? (
        <SubtitleRegion config={config} errors={errors} onChange={onChange} />
      ) : null}
    </div>
  );
}

type OptionProps = {
  config: TaskConfig;
  errors: FieldErrors;
  onChange: ConfigChangeHandler;
};

function NarrativeSource({ config, errors, onChange }: OptionProps) {
  const t = useTranslations("wizard");
  return (
    <WizardSelectField
      label={t("narrativeSource")}
      error={errors.narrativeSource}
      value={config.narrativeSource}
      options={NARRATIVE_SOURCES}
      onChange={(value) => onChange("narrativeSource", value)}
      getLabel={(value) => t(`options.narrativeSource.${value}`)}
    />
  );
}

function RewriteLength({ config, errors, onChange }: OptionProps) {
  const t = useTranslations("wizard");
  return (
    <WizardSelectField
      label={t("rewriteLength")}
      error={errors.rewriteLength}
      value={config.rewriteLength}
      options={REWRITE_LENGTHS}
      onChange={(value) => onChange("rewriteLength", value)}
      getLabel={(value) => t(`options.rewriteLength.${value}`)}
    />
  );
}

function SceneCount({ config, errors, onChange }: OptionProps) {
  const t = useTranslations("wizard");
  return (
    <WizardField label={t("sceneCount")} error={errors.sceneCount}>
      <Input
        aria-invalid={Boolean(errors.sceneCount)}
        data-field-error={Boolean(errors.sceneCount)}
        type="number"
        min={MIN_SCENE_COUNT}
        max={MAX_SCENE_COUNT}
        value={config.sceneCount}
        onChange={(event) => onChange("sceneCount", Number(event.target.value))}
      />
    </WizardField>
  );
}

function SubtitleTreatment({ config, errors, onChange }: OptionProps) {
  const t = useTranslations("wizard");
  return (
    <WizardSelectField
      label={t("sourceSubtitleTreatment")}
      error={errors.sourceSubtitleTreatment}
      value={config.sourceSubtitleTreatment}
      options={SOURCE_SUBTITLE_TREATMENTS}
      onChange={(value) => onChange("sourceSubtitleTreatment", value)}
      getLabel={(value) => t(`options.sourceSubtitleTreatment.${value}`)}
    />
  );
}

function SubtitleRegion({ config, errors, onChange }: OptionProps) {
  const t = useTranslations("wizard");
  return (
    <WizardField
      label={t("sourceSubtitleRegionRatio")}
      error={errors.sourceSubtitleRegionRatio}
    >
      <Input
        aria-invalid={Boolean(errors.sourceSubtitleRegionRatio)}
        data-field-error={Boolean(errors.sourceSubtitleRegionRatio)}
        type="number"
        min={MIN_SOURCE_SUBTITLE_REGION_RATIO * PERCENT_SCALE}
        max={MAX_SOURCE_SUBTITLE_REGION_RATIO * PERCENT_SCALE}
        value={Math.round(config.sourceSubtitleRegionRatio * PERCENT_SCALE)}
        onChange={(event) =>
          onChange("sourceSubtitleRegionRatio", Number(event.target.value) / PERCENT_SCALE)
        }
      />
    </WizardField>
  );
}
