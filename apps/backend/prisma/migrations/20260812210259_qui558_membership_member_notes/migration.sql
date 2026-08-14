-- QUI-558: Notas estructuradas por socio (EPS, estado físico, lesiones, etc.)
-- Patrón espejo de customer_consultation_notes pero sin booking.
-- Permite UPSERT real desde el bulk-scan (member_roster_ocr).
-- Una fila por (customer_id, note_key) garantiza idempotencia al re-escanear.

CREATE TABLE "membership_member_notes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "note_key" VARCHAR(100) NOT NULL,
    "note_value" TEXT NOT NULL,
    "include_in_summary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_member_notes_pkey" PRIMARY KEY ("id")
);

-- Búsqueda por tienda + socio (carga de ficha)
CREATE INDEX "membership_member_notes_store_id_customer_id_idx"
    ON "membership_member_notes"("store_id", "customer_id");

-- Lookup para UPSERT natural-key (customer_id, note_key)
CREATE INDEX "membership_member_notes_customer_id_note_key_idx"
    ON "membership_member_notes"("customer_id", "note_key");
