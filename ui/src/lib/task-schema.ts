import { z } from "zod";

export const RESOLUTIONS = ["720p", "1080p"] as const;
export const ASPECT_RATIOS = ["16:9", "9:16"] as const;
export const LANGUAGES = ["zh", "en"] as const;
export const REWRITE_TONES = ["faithful", "casual", "professional", "dramatic"] as const;
export const REWRITE_LENGTHS = ["shorter", "same", "longer"] as const;
export const VOICES = ["female-1", "male-1", "narrator"] as const;
export const SUBTITLE_POSITIONS = ["bottom", "center", "top"] as const;
export const SUBTITLE_SOURCES = ["corrected_asr"] as const;
export const SOURCE_SUBTITLE_TREATMENTS = ["blur", "none"] as const;
export const MIN_SCENE_COUNT = 1;
export const DEFAULT_SCENE_COUNT = 5;
export const MAX_SCENE_COUNT = 20;
export const DEFAULT_SUBTITLE_FONT_SIZE = 32;
export const DEFAULT_SOURCE_SUBTITLE_REGION_RATIO = 0.18;
export const MAX_SOURCE_SUBTITLE_REGION_RATIO = 0.3;
export const MIN_SOURCE_SUBTITLE_REGION_RATIO = 0.08;

export const subtitleStyleSchema = z.object({
  font: z.string().min(1).default("Noto Sans"),
  size: z.number().int().min(12).max(96).default(DEFAULT_SUBTITLE_FONT_SIZE),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a #RRGGBB hex color")
    .default("#FFFFFF"),
  position: z.enum(SUBTITLE_POSITIONS).default("bottom")
});

export const taskConfigSchema = z.object({
  resolution: z.enum(RESOLUTIONS).default("1080p"),
  aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
  language: z.enum(LANGUAGES).default("zh"),
  rewriteTone: z.enum(REWRITE_TONES).default("faithful"),
  rewriteLength: z.enum(REWRITE_LENGTHS).default("same"),
  voice: z.enum(VOICES).default("female-1"),
  subtitleSource: z.enum(SUBTITLE_SOURCES).default("corrected_asr"),
  sourceSubtitleTreatment: z.enum(SOURCE_SUBTITLE_TREATMENTS).default("blur"),
  sourceSubtitleRegionRatio: z
    .number()
    .min(MIN_SOURCE_SUBTITLE_REGION_RATIO)
    .max(MAX_SOURCE_SUBTITLE_REGION_RATIO)
    .default(DEFAULT_SOURCE_SUBTITLE_REGION_RATIO),
  subtitleStyle: subtitleStyleSchema.default({
    font: "Noto Sans",
    size: DEFAULT_SUBTITLE_FONT_SIZE,
    color: "#FFFFFF",
    position: "bottom"
  }),
  sceneCount: z.number().int().min(MIN_SCENE_COUNT).max(MAX_SCENE_COUNT).default(DEFAULT_SCENE_COUNT)
});

export const ALLOWED_MIME = ["video/mp4", "video/quicktime"] as const;
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const createTaskSchema = z.object({
  idempotencyKey: z.string().uuid(),
  title: z.string().trim().min(1, "title is required").max(200),
  filename: z.string().trim().min(1, "filename is required"),
  contentType: z.enum(ALLOWED_MIME),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  config: taskConfigSchema
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskConfig = z.infer<typeof taskConfigSchema>;