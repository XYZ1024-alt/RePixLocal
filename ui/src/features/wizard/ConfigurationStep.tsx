import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "@/i18n/context";
import {
  ASPECT_RATIOS,
  LANGUAGES,
  type TaskConfig
} from "@/lib/task-schema";
import type { ProviderModelOption } from "@/types";
import { AdvancedOptions } from "./AdvancedOptions";
import type { ConfigChangeHandler, FieldErrors } from "./types";
import { WizardSelectField } from "./WizardSelectField";

const ADVANCED_CONFIG_FIELDS = new Set<keyof TaskConfig>([
  "narrativeSource",
  "rewriteTone",
  "rewriteLength",
  "sceneCount",
  "sourceSubtitleTreatment",
  "sourceSubtitleRegionRatio"
]);

export function ConfigurationStep({
  config,
  errors,
  videoModels,
  videoModelsLoading,
  voiceOptions,
  voiceOptionsLoading,
  onVideoModelChange,
  onChange
}: {
  config: TaskConfig;
  errors: FieldErrors;
  videoModels: readonly ProviderModelOption[];
  videoModelsLoading: boolean;
  voiceOptions: readonly TaskConfig["voice"][];
  voiceOptionsLoading: boolean;
  onVideoModelChange: (modelId: string) => void;
  onChange: ConfigChangeHandler;
}) {
  const t = useTranslations("wizard");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const imageTask = config.taskType === "image_to_video";
  const hasAdvancedErrors = Object.keys(errors).some((key) =>
    ADVANCED_CONFIG_FIELDS.has(key as keyof TaskConfig)
  );

  useEffect(() => {
    if (hasAdvancedErrors) setAdvancedOpen(true);
  }, [hasAdvancedErrors]);

  return (
    <Card>
      <CardHeader><CardTitle>{t("configureStepTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <PrimaryOptions
          config={config}
          errors={errors}
          videoModels={videoModels}
          videoModelsLoading={videoModelsLoading}
          voiceOptions={voiceOptions}
          voiceOptionsLoading={voiceOptionsLoading}
          onVideoModelChange={onVideoModelChange}
          onChange={onChange}
        />
        <Accordion
          type="single"
          collapsible
          value={advancedOpen || hasAdvancedErrors ? "advanced" : ""}
          onValueChange={(value) => setAdvancedOpen(value === "advanced")}
        >
          <AccordionItem value="advanced" className="rounded-lg border border-border px-4">
            <AccordionTrigger>{t("advancedOptions")}</AccordionTrigger>
            <AccordionContent>
              <AdvancedOptions
                config={config}
                errors={errors}
                imageTask={imageTask}
                onChange={onChange}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

type PrimaryOptionsProps = {
  config: TaskConfig;
  errors: FieldErrors;
  videoModels: readonly ProviderModelOption[];
  videoModelsLoading: boolean;
  voiceOptions: readonly TaskConfig["voice"][];
  voiceOptionsLoading: boolean;
  onVideoModelChange: (modelId: string) => void;
  onChange: ConfigChangeHandler;
};

function PrimaryOptions(props: PrimaryOptionsProps) {
  const t = useTranslations("wizard");
  const selectedModel = props.videoModels.find((model) => model.id === props.config.videoModel);
  const modelIds = props.videoModels.map((model) => model.id);
  const resolutions = selectedModel?.video_capabilities?.resolutions ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <WizardSelectField label={t("videoModel")} error={props.errors.videoModel} value={props.config.videoModel} options={modelIds} disabled={props.videoModelsLoading} onChange={props.onVideoModelChange} getLabel={(value) => videoModelLabel(props.videoModels, value, t("capabilitiesUnavailable"))} />
      <WizardSelectField key={props.config.videoModel} label={t("resolution")} error={props.errors.resolution} value={props.config.resolution} options={resolutions} disabled={props.videoModelsLoading || !resolutions.length} onChange={(value) => props.onChange("resolution", value)} getLabel={(value) => value} />
      <WizardSelectField label={t("aspectRatio")} error={props.errors.aspectRatio} value={props.config.aspectRatio} options={ASPECT_RATIOS} onChange={(value) => props.onChange("aspectRatio", value)} getLabel={(value) => t(`options.aspectRatio.${value}`)} />
      <WizardSelectField label={t("language")} error={props.errors.language} value={props.config.language} options={LANGUAGES} onChange={(value) => props.onChange("language", value)} getLabel={(value) => t(`options.language.${value}`)} />
      <WizardSelectField label={t("voice")} error={props.errors.voice} value={props.config.voice} options={props.voiceOptions} disabled={props.voiceOptionsLoading} onChange={(value) => props.onChange("voice", value)} getLabel={(value) => t(`options.voice.${value}`)} />
    </div>
  );
}

function videoModelLabel(
  models: readonly ProviderModelOption[],
  modelId: string,
  unavailableLabel: string
) {
  const model = models.find((option) => option.id === modelId);
  if (!model) return modelId;
  return model.video_capabilities ? model.name : `${model.name} (${unavailableLabel})`;
}
