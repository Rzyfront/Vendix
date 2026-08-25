-- DATA IMPACT:
-- Tables affected: invoice_delivery_events (NUEVA — no existía).
-- Expected row changes: 0 filas mutadas. La tabla nace vacía; nada hace backfill.
-- Destructive operations: ninguna. No hay DROP, TRUNCATE ni DELETE.
-- FK/cascade risk:
--   * invoice_delivery_events.invoice_id -> invoices(id) ON DELETE CASCADE.
--     Elegido a propósito, no copiado ciegamente del plan: `invoices.remove()`
--     (invoicing.service.ts) sólo permite borrar facturas en estado `draft`, y esta
--     tabla sólo se escribe para facturas fuera de `draft` (INVOICING_DELIVERY_002
--     bloquea el reenvío de un borrador con 409). Los dos estados son mutuamente
--     excluyentes, así que el CASCADE nunca se dispara sobre una fila con
--     historial de entrega real — coincide además con el mismo FK en la tabla
--     hermana `dian_document_events`.
--   * invoice_delivery_events.organization_id -> organizations(id) ON DELETE CASCADE,
--     igual que el resto de tablas fiscales colgadas de una organización.
--   * invoice_delivery_events.store_id -> stores(id) ON DELETE SET NULL, para no
--     perder la traza de entrega si la tienda se elimina (igual que
--     dian_document_events.store_id).
-- Idempotency: CREATE TABLE / CREATE INDEX usan IF NOT EXISTS; los 3 FK van
--   guardados con un DO $$ que sólo los crea si pg_constraint no los tiene ya.
-- Approval: migración puramente aditiva (tabla nueva, sin tocar columnas ni datos
--   existentes) — dentro del alcance explícito de E.6, sin aprobación adicional
--   requerida por la regla 6 del usuario (nada destructivo, nada de UPDATE/DELETE
--   sin WHERE, nada de CASCADE sobre tablas padre con datos de negocio).

-- CreateTable
CREATE TABLE IF NOT EXISTS "invoice_delivery_events" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "channel" VARCHAR(20) NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "zip_name" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'sent',
    "provider_error" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_delivery_events_invoice_id_created_at_idx" ON "invoice_delivery_events"("invoice_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_delivery_events_status_created_at_idx" ON "invoice_delivery_events"("status", "created_at");

-- AddForeignKey (guardado: sólo crea si no existe ya)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_delivery_events_invoice_id_fkey'
  ) THEN
    ALTER TABLE "invoice_delivery_events"
      ADD CONSTRAINT "invoice_delivery_events_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey (guardado: sólo crea si no existe ya)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_delivery_events_organization_id_fkey'
  ) THEN
    ALTER TABLE "invoice_delivery_events"
      ADD CONSTRAINT "invoice_delivery_events_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey (guardado: sólo crea si no existe ya)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_delivery_events_store_id_fkey'
  ) THEN
    ALTER TABLE "invoice_delivery_events"
      ADD CONSTRAINT "invoice_delivery_events_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
