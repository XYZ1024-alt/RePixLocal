import { AlertCircle } from "lucide-react";
import { useTranslations } from "@/i18n/context";

export function ErrorNotice({ message }: { message: string }) {
  const t = useTranslations("wizard");
  return (
    <div
      className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
      role="alert"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertCircle className="size-4" />
        {t("submitFailed")}
      </div>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary>{t("technicalDetails")}</summary>
        <p className="mt-1 break-words font-mono">{message}</p>
      </details>
    </div>
  );
}
