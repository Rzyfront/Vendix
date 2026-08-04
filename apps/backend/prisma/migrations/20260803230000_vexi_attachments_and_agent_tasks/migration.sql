-- Vexi recibe documentos y ejecuta trabajos que no caben en un turno.
--
-- DATA IMPACT:
--   Tablas afectadas: NINGUNA existente. Se CREAN `ai_attachments` y
--     `ai_agent_tasks`, ambas vacías.
--   Filas esperadas: 0 INSERT / 0 UPDATE / 0 DELETE.
--   Destructivo: NO. Sin DROP, sin DELETE, sin TRUNCATE, sin CASCADE, sin
--     ALTER sobre columnas con datos productivos.
--   Idempotente: SÍ. Todo con IF NOT EXISTS, así que reaplicarla es un no-op.
--
-- POR QUÉ `ai_attachments`: el documento que el usuario le pasa a Vexi tiene
-- que terminar relacionado con el registro que originó, con el mismo rigor con
-- que un gasto guarda su factura. `linked_entity_type` / `linked_entity_id` se
-- llenan cuando la escritura queda aplicada; hasta entonces el adjunto existe
-- pero no está ligado a nada, que es exactamente el estado de un flujo que la
-- persona todavía no aprobó.
--
-- POR QUÉ sin FK hacia la entidad ligada: el mismo par apunta a órdenes de
-- compra, gastos, ajustes de inventario, socios o identidad fiscal según el
-- flujo. Modelarlo con FK exigiría una columna nullable por dominio y una
-- migración por cada dominio nuevo.
--
-- POR QUÉ se guarda `s3_key` y no una URL: una URL firmada vence, así que
-- persistirla convierte el adjunto en un enlace roto a las horas. La firma se
-- calcula al leer (`S3Service.getPresignedUrl`).

CREATE TABLE IF NOT EXISTS "ai_attachments" (
  "id"                  SERIAL       PRIMARY KEY,
  "store_id"            INTEGER      NOT NULL,
  "organization_id"     INTEGER      NOT NULL,
  "user_id"             INTEGER      NOT NULL,
  "conversation_id"     INTEGER,
  "s3_key"              VARCHAR(500) NOT NULL,
  "mime_type"           VARCHAR(100) NOT NULL,
  "size_bytes"          INTEGER      NOT NULL,
  "original_name"       VARCHAR(255) NOT NULL,
  "linked_entity_type"  VARCHAR(60),
  "linked_entity_id"    INTEGER,
  "consumed_by_app_key" VARCHAR(100),
  "created_at"          TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linked_at"           TIMESTAMP(6)
);

CREATE INDEX IF NOT EXISTS "ai_attachments_store_id_idx"
  ON "ai_attachments" ("store_id");
CREATE INDEX IF NOT EXISTS "ai_attachments_store_id_user_id_idx"
  ON "ai_attachments" ("store_id", "user_id");
CREATE INDEX IF NOT EXISTS "ai_attachments_conversation_id_idx"
  ON "ai_attachments" ("conversation_id");
CREATE INDEX IF NOT EXISTS "ai_attachments_linked_entity_type_linked_entity_id_idx"
  ON "ai_attachments" ("linked_entity_type", "linked_entity_id");

-- POR QUÉ `ai_agent_tasks`: una carga de 300 productos o una conciliación de
-- un mes no caben en el presupuesto de un turno (10 vueltas, 60 s). El plan
-- aprobado se guarda junto al trabajo para que el resultado se pueda leer
-- contra lo que la persona autorizó, no contra lo que el modelo decidió
-- después.
--
-- `status` es VARCHAR y no un enum nuevo a propósito: los estados los dicta
-- BullMQ (queued / active / completed / failed) y un enum de Postgres exigiría
-- ALTER TYPE cada vez que la cola gane uno.

CREATE TABLE IF NOT EXISTS "ai_agent_tasks" (
  "id"              SERIAL       PRIMARY KEY,
  "store_id"        INTEGER      NOT NULL,
  "organization_id" INTEGER      NOT NULL,
  "user_id"         INTEGER      NOT NULL,
  "conversation_id" INTEGER,
  "goal"            TEXT         NOT NULL,
  "plan"            JSONB,
  "status"          VARCHAR(20)  NOT NULL DEFAULT 'queued',
  "job_id"          VARCHAR(100),
  "result"          JSONB,
  "error"           TEXT,
  "created_at"      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"     TIMESTAMP(6)
);

CREATE INDEX IF NOT EXISTS "ai_agent_tasks_store_id_idx"
  ON "ai_agent_tasks" ("store_id");
CREATE INDEX IF NOT EXISTS "ai_agent_tasks_store_id_status_idx"
  ON "ai_agent_tasks" ("store_id", "status");
CREATE INDEX IF NOT EXISTS "ai_agent_tasks_job_id_idx"
  ON "ai_agent_tasks" ("job_id");
