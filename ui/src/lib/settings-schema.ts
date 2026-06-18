import { z } from "zod";

export const providerKeySchema = z.object({
  provider: z.enum(["DEEPSEEK", "SEEDANCE"]),
  key: z.string().trim().optional().or(z.literal("")),
  baseUrl: z.string().trim().url().optional().or(z.literal("")),
  model: z.string().trim().optional()
});

export const dashscopeCredentialSchema = z.object({
  api_key: z.string().trim().optional().or(z.literal("")),
  base_url: z.string().trim().optional().or(z.literal("")),
  qwen_vl_model: z.string().trim().min(1),
  tongyi_model: z.string().trim().min(1),
  cosyvoice_model: z.string().trim().min(1)
});

export const systemSettingsSchema = z.object({
  asrModel: z.enum(["tiny", "base", "small", "medium", "large-v3"]),
  ffmpegBin: z.string().min(1, "FFmpeg path is required"),
  ffprobeBin: z.string().min(1, "FFprobe path is required")
});