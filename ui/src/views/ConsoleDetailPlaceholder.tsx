import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslations } from "@/i18n/context";

export function ConsoleDetailPlaceholder(props: { runId: string | null }) {
  const t = useTranslations("console");

  return (
    <>
      <PageHeader title={t("title")} description={props.runId ?? t("notStarted")} />
      <div className="px-4 pb-6 lg:px-6">
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      </div>
    </>
  );
}