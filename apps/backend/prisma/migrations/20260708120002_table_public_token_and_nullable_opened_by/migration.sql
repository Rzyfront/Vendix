-- DATA IMPACT: Non-destructive. Adds tables.public_token (backfilled for existing rows via gen_random_bytes(24) hex). Relaxes table_sessions.opened_by to nullable. No rows deleted.
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "public_token" VARCHAR(64);
UPDATE "tables" SET "public_token" = encode(gen_random_bytes(24), 'hex') WHERE "public_token" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "tables_public_token_key" ON "tables"("public_token");
ALTER TABLE "table_sessions" ALTER COLUMN "opened_by" DROP NOT NULL;