import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "@/i18n/context";
import type { WizardDraft } from "@/types";

export function ReviewStep({ draft }: { draft: WizardDraft }) {
  const t = useTranslations("wizard");
  const rows = [
    [t("taskMode"), t(`options.taskType.${draft.config.taskType}`)],
    [t("taskTitle"), draft.title],
    [
      t("source"),
      draft.config.taskType === "replicate"
        ? draft.file?.name ?? ""
        : t("imageCount", { count: draft.images.length })
    ],
    [t("resolution"), draft.config.resolution],
    [t("aspectRatio"), draft.config.aspectRatio],
    [t("language"), t(`options.language.${draft.config.language}`)],
    [t("voice"), t(`options.voice.${draft.config.voice}`)]
  ];
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
