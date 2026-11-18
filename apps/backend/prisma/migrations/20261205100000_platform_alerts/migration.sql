-- QUI-1010 · Bot de monitoreo de la API (odd/tasks/qui-1010-monitoreo.md, S2 y S4).
--
-- DATA IMPACT:
--   Tables affected: 1 tabla NUEVA (platform_alerts). Ninguna tabla existente
--   cambia: sin columnas nuevas ni modificadas en otras tablas.
--   Expected row changes: 0 INSERT, 0 UPDATE, 0 DELETE. La tabla nace vacía;
--   la llena el backend en caliente.
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni TRUNCATE.
--   FK/cascade risk: ninguno. La tabla no tiene FKs (registro de plataforma que
--   sobrevive a tiendas y organizaciones) y nadie la referencia.
--   Idempotency: CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS. Aplicarla
--   dos veces no falla.
--   Approval: brief QUI-1010 (tabla aditiva).

-- 1. Tabla
CREATE TABLE IF NOT EXISTS "platform_alerts" (
    "id" SERIAL NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "process" VARCHAR(255) NOT NULL,
    "error_type" VARCHAR(120) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "affected_store_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "notified_occurrences" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalated_at" TIMESTAMP(6),
    "resolved_at" TIMESTAMP(6),
    "resolution" VARCHAR(32),
    "resolved_by_user_id" INTEGER,
    "ticket_number" VARCHAR(40),
    "telegram_message_id" VARCHAR(32),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_alerts_pkey" PRIMARY KEY ("id")
);

-- 2. Índices que declara schema.prisma
CREATE INDEX IF NOT EXISTS "platform_alerts_status_severity_idx" ON "platform_alerts"("status", "severity");
CREATE INDEX IF NOT EXISTS "platform_alerts_last_seen_at_idx" ON "platform_alerts"("last_seen_at");
CREATE INDEX IF NOT EXISTS "platform_alerts_fingerprint_idx" ON "platform_alerts"("fingerprint");

-- 3. Una sola alerta ABIERTA por huella (Prisma no expresa índices parciales).
--    Es lo que garantiza "la misma falla repetida no genera avisos duplicados"
--    aunque dos procesos (API y worker) la registren a la vez: el segundo
--    INSERT choca (P2002) y el código suma la ocurrencia a la fila abierta.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_alerts_open_fingerprint_key"
  ON "platform_alerts" ("fingerprint")
  WHERE "status" = 'open';
