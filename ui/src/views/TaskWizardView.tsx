import { PageHeader } from "@/components/PageHeader";
import { ConfigurationStep } from "@/features/wizard/ConfigurationStep";
import { ErrorNotice } from "@/features/wizard/ErrorNotice";
import { ReadinessNotice } from "@/features/wizard/ReadinessNotice";
import { ReviewStep } from "@/features/wizard/ReviewStep";
import { SourceStep } from "@/features/wizard/SourceStep";
import { WizardFooter } from "@/features/wizard/WizardFooter";
import { WizardStepNavigation } from "@/features/wizard/WizardStepNavigation";
import { useTaskWizard } from "@/features/wizard/useTaskWizard";
import { useTranslations } from "@/i18n/context";
import type { ReadinessState } from "@/types";

export function TaskWizardView({
  readiness,
  onCancel,
  onDirtyChange,
  onOpenSettings,
  onSubmitted
}: {
  readiness?: ReadinessState;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenSettings?: () => void;
  onSubmitted: (result: { taskId: string; runId: string }) => void | Promise<void>;
}) {
  const t = useTranslations("wizard");
  const wizard = useTaskWizard({ t, onDirtyChange, onSubmitted });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <form
        onSubmit={wizard.handleSubmit}
        className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-8 pt-3 lg:px-6"
      >
        <WizardStepNavigation step={wizard.draft.step} onSelect={wizard.selectStep} />
        {readiness?.status === "attention" ? (
          <ReadinessNotice readiness={readiness} onOpenSettings={onOpenSettings} />
        ) : null}
        {wizard.draft.step === 0 ? (
          <SourceStep
            draft={wizard.draft}
            busy={wizard.busy}
            errors={wizard.errors}
            onChange={wizard.setDraft}
            onError={wizard.setSubmitError}
          />
        ) : null}
        {wizard.draft.step === 1 ? (
          <ConfigurationStep
            config={wizard.draft.config}
            errors={wizard.errors}
            videoModels={wizard.videoModels}
            videoModelsLoading={wizard.videoModelsLoading}
            voiceOptions={wizard.voiceOptions}
            voiceOptionsLoading={wizard.voiceOptionsLoading}
            onVideoModelChange={wizard.updateVideoModel}
            onChange={wizard.updateConfig}
          />
        ) : null}
        {wizard.draft.step === 2 ? (
          <ReviewStep draft={wizard.draft} videoModels={wizard.videoModels} />
        ) : null}
        {wizard.submitError ? <ErrorNotice message={wizard.submitError} /> : null}
        <WizardFooter
          step={wizard.draft.step}
          phase={wizard.phase}
          busy={wizard.busy}
          onBack={wizard.goBack}
          onCancel={() => onCancel?.()}
          onNext={wizard.goNext}
        />
      </form>
    </>
  );
}
