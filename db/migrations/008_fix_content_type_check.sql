-- Fix content_type CHECK constraint on scam_reports to accept media types
-- Media scans (photos, voice, documents) write content_type as 'media_image',
-- 'media_audio', 'media_document' but the constraint only allows 'url','text','mixed'.
-- Without this fix, all media scan results silently fail to insert.

ALTER TABLE public.scam_reports DROP CONSTRAINT IF EXISTS scam_reports_content_type_check;
ALTER TABLE public.scam_reports ADD CONSTRAINT scam_reports_content_type_check
  CHECK (content_type IN ('url', 'text', 'mixed', 'media_image', 'media_audio', 'media_document'));
