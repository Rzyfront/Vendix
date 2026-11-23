-- M11 (F8 T49): voice catalog for response reading (TTS) and per-agent voice.
--
-- What it does:
--   Creates ai_voice_profiles (one row = one voice of one speech provider
--   config) and adds the nullable ai_agents.voice_profile_id that points an
--   agent (Vex, Vexi) at one catalog voice.
--
-- DATA IMPACT:
--   Tables affected: ai_voice_profiles (new, created EMPTY), ai_agents (new
--   nullable column, NULL on every existing row).
--   Expected row changes: 0 rows inserted, 0 updated, 0 deleted. This
--   migration is DDL only: it seeds no catalog and assigns no voice. Until a
--   super admin registers a voice and assigns it, every agent keeps reading
--   with the existing fallback (ai_engine_applications.metadata.speech).
--   Destructive operations: none.
--   FK/cascade risk: ai_voice_profiles.config_id -> ai_engine_configs is
--   ON DELETE RESTRICT (a provider config with voices cannot be deleted);
--   ai_agents.voice_profile_id -> ai_voice_profiles is ON DELETE SET NULL (the
--   agent falls back, it is never deleted). No CASCADE anywhere.
--   Idempotency: IF NOT EXISTS on table, column and indexes; constraints
--   guarded by pg_constraint.
--   Reversibility: additive; nothing reads the new objects unless a voice is
--   assigned.
--   Pending (NOT in this migration, needs explicit approval + prod snapshot +
--   dry-run): initial catalog seed and UPDATE ai_agents ... WHERE key IN
--   ('vex','vexi').

CREATE TABLE IF NOT EXISTS "ai_voice_profiles" (
    "id" SERIAL NOT NULL,
    "config_id" INTEGER NOT NULL,
    "voice_id" VARCHAR(150) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "language" VARCHAR(16) NOT NULL DEFAULT 'es',
    "speed" DECIMAL(4,2),
    "vol" DECIMAL(4,2),
    "sample_text" VARCHAR(120),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_voice_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_voice_profiles_config_id_voice_id_key"
    ON "ai_voice_profiles"("config_id", "voice_id");
CREATE INDEX IF NOT EXISTS "ai_voice_profiles_is_active_idx"
    ON "ai_voice_profiles"("is_active");

ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "voice_profile_id" INTEGER;
CREATE INDEX IF NOT EXISTS "ai_agents_voice_profile_id_idx"
    ON "ai_agents"("voice_profile_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_voice_profiles_config_id_fkey'
  ) THEN
    ALTER TABLE "ai_voice_profiles"
      ADD CONSTRAINT "ai_voice_profiles_config_id_fkey"
      FOREIGN KEY ("config_id") REFERENCES "ai_engine_configs"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_agents_voice_profile_id_fkey'
  ) THEN
    ALTER TABLE "ai_agents"
      ADD CONSTRAINT "ai_agents_voice_profile_id_fkey"
      FOREIGN KEY ("voice_profile_id") REFERENCES "ai_voice_profiles"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
