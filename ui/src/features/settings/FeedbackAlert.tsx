import { InlineAlert } from "@/components/ui/inline-alert";
import { useTranslations } from "@/i18n/context";
import type { Feedback } from "./types";

export function FeedbackAlert({ feedback }: { feedback: Feedback | null }) {
  const t = useTranslations("settings");
  if (!feedback) return null;

  return (
    <InlineAlert
      variant={feedback.type === "error" ? "error" : "success"}
      title={feedback.text}
      details={feedback.detail}
      detailsLabel={t("errorDetails")}
    >
    </InlineAlert>
  );
}
