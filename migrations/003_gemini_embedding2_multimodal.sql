-- Migration 003: Upgrade to Gemini Embedding 2 with multimodal support
--
-- Changes:
-- 1. Add media_type column to scam_reports for tracking image/audio/doc scans
-- 2. Add media_type column to scam_signatures for multimodal patterns
-- 3. Update search function to handle new similarity threshold (0.85)
-- 4. Add index for media_type queries
--
-- NOTE: Vector dimension stays at 768 for backward compatibility.
-- Gemini Embedding 2 supports Matryoshka truncation to 768 dims.
-- Premium tier (3072 dims) can be added as a separate column later.

-- Add media_type to scam_reports
ALTER TABLE scam_reports
  ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'text';

-- Add media_type to scam_signatures (allows image/audio pattern storage)
ALTER TABLE scam_signatures
  ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'text';

-- Add media_type to user_submissions
ALTER TABLE user_submissions
  ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'text';

-- Index for filtering by media type
CREATE INDEX IF NOT EXISTS idx_scam_reports_media_type ON scam_reports (media_type);
CREATE INDEX IF NOT EXISTS idx_scam_signatures_media_type ON scam_signatures (media_type);

-- Update the search function with higher default threshold for Embedding 2
CREATE OR REPLACE FUNCTION search_scam_signatures(
  query_embedding vector(768),
  similarity_threshold float DEFAULT 0.85,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  pattern text,
  pattern_type text,
  severity int,
  media_type text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.pattern,
    s.pattern_type,
    s.severity,
    s.media_type,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM scam_signatures s
  WHERE s.embedding IS NOT NULL
    AND 1 - (s.embedding <=> query_embedding) > similarity_threshold
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Comment for documentation
COMMENT ON FUNCTION search_scam_signatures IS
  'Search scam signatures by vector similarity using Gemini Embedding 2 (768-dim Matryoshka). Threshold raised to 0.85 for higher precision.';
