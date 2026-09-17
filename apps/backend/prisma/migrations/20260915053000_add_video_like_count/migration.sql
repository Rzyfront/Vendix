-- DATA IMPACT:
-- Tables affected: videos
-- Expected row changes: none (adds like_count column with default 0 to existing rows)
-- Destructive operations: none (ALTER TABLE ADD COLUMN IF NOT EXISTS)
-- FK/cascade risk: none
-- Idempotency: IF NOT EXISTS on ALTER TABLE ADD COLUMN

ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "like_count" INTEGER NOT NULL DEFAULT 0;
