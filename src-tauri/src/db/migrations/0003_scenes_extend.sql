-- Extend scenes for re-pix parity (visual/motion prompts + metadata).
ALTER TABLE scenes ADD COLUMN visual_prompt TEXT;
ALTER TABLE scenes ADD COLUMN motion_prompt TEXT;
ALTER TABLE scenes ADD COLUMN metadata_json TEXT;