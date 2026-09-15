-- Material OCR progress: live extraction state (page/pages/percent/etaSeconds)
-- written by the worker while a PDF is being OCR'd and surfaced to the web UI.
ALTER TABLE "materials" ADD COLUMN "progress" jsonb;