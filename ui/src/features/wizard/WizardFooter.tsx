import { ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/i18n/context";
import type { WizardPhase, WizardStep } from "./types";

export function WizardFooter({
  step,
  phase,
  busy,
  onBack,
  onCancel,
  onNext
}: {
  step: WizardStep;
  phase: WizardPhase;
  busy: boolean;
  onBack: () => void;
  onCancel: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("wizard");
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-border bg-background/90 py-3 backdrop-blur-xl">
      <Button
        type="button"
        variant="ghost"
        onClick={step === 0 ? onCancel : onBack}
        disabled={busy}
      >
        {step === 0 ? t("cancel") : <><ArrowLeft />{t("back")}</>}
      </Button>
      {step < 2 ? (
        <Button
          key="continue"
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onNext();
          }}
        >
          {t("continue")}
          <ArrowRight />
        </Button>
      ) : (
        <Button key="submit" type="submit" disabled={busy} className="min-w-36">
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {phase === "creating"
            ? t("creating")
            : phase === "submitting"
              ? t("submitting")
              : t("createRun")}
        </Button>
      )}
    </div>
  );
}
