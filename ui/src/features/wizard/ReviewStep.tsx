import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "@/i18n/context";
import type { ProviderModelOption, WizardDraft } from "@/types";

export function ReviewStep({
  draft,
  videoModels
}: {
  draft: WizardDraft;
  videoModels: readonly ProviderModelOption[];
}) {
  const t = useTranslations("wizard");
  const videoModel = videoModels.find((model) => model.id === draft.config.videoModel);
  const rows: Array<[string, string]> = [
    [t("taskMode"), t(`options.taskType.${draft.config.taskType}`)],
    [t("taskTitle"), draft.title],
    [
      t("source"),
      draft.config.taskType === "replicate"
        ? draft.file?.name ?? ""
        : t("imageCount", { count: draft.images.length })
    ],
    [t("videoModel"), videoModel?.name ?? draft.config.videoModel],
    [t("resolution"), draft.config.resolution],
    [t("aspectRatio"), draft.config.aspectRatio],
    [t("language"), t(`options.language.${draft.config.language}`)]
  ];
  if (draft.config.taskType === "replicate") {
    rows.push([
      t("narrativeSource"),
      t(`options.narrativeSource.${draft.config.narrativeSource}`)
    ]);
  }
  rows.push([t("voice"), t(`options.voice.${draft.config.voice}`)]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reviewStepTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
