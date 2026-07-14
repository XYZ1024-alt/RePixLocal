import {
  DEFAULT_SCENE_COUNT,
  DEFAULT_SOURCE_SUBTITLE_REGION_RATIO,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_UPLOAD_BYTES,
  MIN_SCENE_COUNT,
  VOICES,
  taskConfigSchema,
  type TaskConfig
} from "@/lib/task-schema";
import type {
  CreateTaskPayload,
  PickedImageFile,
  PickedVideoFile,
  ProviderModelOption,
  WizardDraft
} from "@/types";
import type { FieldErrors, WizardTranslator } from "./types";

export const DRAFT_KEY = "repix:wizard-draft";
const DEFAULT_COSYVOICE_MODEL = "cosyvoice-v3-flash";
const COSYVOICE_MODELS_WITH_NARRATOR = new Set(["cosyvoice-v3-flash", "cosyvoice-v1"]);
const COSYVOICE_V3_PLUS_VOICES = VOICES.filter((voice) => voice !== "narrator");

export const DEFAULT_CONFIG: TaskConfig = {
  taskType: "replicate",
  narrativeSource: "auto",
  requirements: "",
  imagePaths: [],
  videoProvider: "SEEDANCE",
  videoModel: "",
  resolution: "1080p",
  aspectRatio: "16:9",
  language: "zh",
  rewriteTone: "faithful",
  rewriteLength: "same",
  voice: "female-1",
  sourceSubtitleTreatment: "blur",
  sourceSubtitleRegionRatio: DEFAULT_SOURCE_SUBTITLE_REGION_RATIO,
  sceneCount: DEFAULT_SCENE_COUNT
};

const DEFAULT_DRAFT: WizardDraft = {
  title: "",
  file: null,
  images: [],
  config: DEFAULT_CONFIG,
  step: 0
};

export function readDraft(): WizardDraft {
  try {
    const stored = sessionStorage.getItem(DRAFT_KEY);
    if (!stored) return DEFAULT_DRAFT;
    const parsed = JSON.parse(stored) as Partial<WizardDraft>;
    const configResult = taskConfigSchema.safeParse(parsed.config);
    if (!configResult.success) return DEFAULT_DRAFT;
    return {
      title: parsed.title ?? "",
      file: parsed.file ?? null,
      images: parsed.images ?? [],
      config: configResult.data,
      step: parsed.step === 1 || parsed.step === 2 ? parsed.step : 0
    };
  } catch {
    sessionStorage.removeItem(DRAFT_KEY);
    return DEFAULT_DRAFT;
  }
}

export function hasDraftContent(draft: WizardDraft, defaultConfig: TaskConfig = DEFAULT_CONFIG) {
  return Boolean(
    draft.title ||
      draft.file ||
      draft.images.length ||
      draft.step ||
      JSON.stringify(draft.config) !== JSON.stringify(defaultConfig)
  );
}

export function validateSource(draft: WizardDraft, t: WizardTranslator): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.title.trim()) errors.title = t("invalidInput");
  if (draft.config.taskType === "image_to_video") {
    if (!draft.images.length) errors.source = t("selectImagesFirst");
    if (!draft.config.requirements?.trim()) errors.requirements = t("requirementsRequired");
  } else if (!draft.file) {
    errors.source = t("selectFirst");
  }
  return errors;
}

export function validateConfig(
  config: TaskConfig,
  videoModels: readonly ProviderModelOption[],
  t: WizardTranslator
): FieldErrors {
  const result = taskConfigSchema.safeParse(config);
  const errors: FieldErrors = result.success
    ? {}
    : Object.fromEntries(
        result.error.issues.map((issue) => [String(issue.path[0] ?? "config"), issue.message])
      );
  const model = videoModels.find((option) => option.id === config.videoModel);
  if (!config.videoModel) errors.videoModel = t("videoModelRequired");
  else if (!model?.video_capabilities) errors.videoModel = t("videoModelCapabilitiesUnavailable");
  else if (!model.video_capabilities.resolutions.includes(config.resolution)) {
    errors.resolution = t("resolutionUnsupported");
  }
  return errors;
}

export function configForVideoModel(
  config: TaskConfig,
  model: ProviderModelOption
): TaskConfig {
  const capabilities = model.video_capabilities;
  const resolution = capabilities?.resolutions.includes(config.resolution)
    ? config.resolution
    : capabilities?.default_resolution ?? "";
  return { ...config, videoModel: model.id, resolution };
}

export function initialVideoModel(
  config: TaskConfig,
  models: readonly ProviderModelOption[],
  preferredModel?: string
) {
  if (config.videoModel) return models.find((model) => model.id === config.videoModel);
  if (preferredModel) return models.find((model) => model.id === preferredModel);
  return models.find((model) => model.video_capabilities);
}

export function createPayload(draft: WizardDraft): CreateTaskPayload {
  const imageTask = draft.config.taskType === "image_to_video";
  return {
    title: draft.title.trim(),
    source_path: imageTask ? "" : draft.file?.path ?? "",
    config_json: {
      ...draft.config,
      imagePaths: imageTask ? draft.images.map((image) => image.path) : undefined,
      sceneCount: imageTask ? draft.images.length : draft.config.sceneCount
    }
  };
}

export function removeDraftImage(draft: WizardDraft, index: number): WizardDraft {
  const images = draft.images.filter((_, itemIndex) => itemIndex !== index);
  return {
    ...draft,
    images,
    config: {
      ...draft.config,
      imagePaths: images.map((image) => image.path),
      sceneCount: Math.max(images.length, MIN_SCENE_COUNT)
    }
  };
}

export function voiceOptionsForModel(model: string | null | undefined) {
  if (model === undefined) return COSYVOICE_V3_PLUS_VOICES;
  const normalized = model?.trim().toLowerCase() || DEFAULT_COSYVOICE_MODEL;
  return COSYVOICE_MODELS_WITH_NARRATOR.has(normalized) ? VOICES : COSYVOICE_V3_PLUS_VOICES;
}

export function validatePickedImages(images: PickedImageFile[], t: WizardTranslator) {
  if (!images.length) return t("selectImagesFirst");
  if (images.length > MAX_IMAGES) return t("tooManyImages", { count: MAX_IMAGES });
  if (images.some((image) => image.size_bytes > MAX_IMAGE_BYTES)) return t("imageTooLarge");
  return null;
}

export function validatePickedFile(file: PickedVideoFile, t: WizardTranslator) {
  if (!/\.(mp4|mov)$/i.test(file.name)) return t("unsupportedType");
  if (file.size_bytes > MAX_UPLOAD_BYTES) return t("tooLarge");
  return null;
}

export function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, "");
}

export function formatSize(size: number) {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
