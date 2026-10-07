-- DATA IMPACT: 0 filas modificadas (columna nullable nueva)
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "timeout_seconds" INTEGER;
