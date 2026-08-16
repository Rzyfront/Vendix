-- Desglose de tributos POR LÍNEA en el documento fiscal (invoice_taxes → invoice_items).
--
-- DATA IMPACT:
-- Tables affected: invoice_taxes (una columna nullable + FK + índice). NINGUNA
--   otra tabla se toca. `invoice_items` sólo aparece como REFERENCED table de la
--   nueva FK: no se le altera ni una columna ni un constraint propio.
-- Types created: NINGUNO. No se crea ni se altera ningún enum
--   (`ALTER TYPE ... ADD VALUE` no aparece en esta migración).
-- Columns added (1) — nullable, SIN DEFAULT:
--   invoice_taxes (1):
--     - invoice_item_id                   INTEGER       NULL
-- Expected row changes: NINGUNO. Cero INSERT, cero UPDATE, cero DELETE. Las
--   filas históricas nacen con `invoice_item_id = NULL`, y NULL es EXACTAMENTE
--   el contrato del comportamiento vigente ("fila de cabecera; el emisor
--   reconstruye o hereda"). Ningún importe se mueve un centavo, ningún CUFE ya
--   calculado cambia, ningún documento ya aceptado se reescribe.
-- Destructive operations: none. Sin DROP TABLE, sin DROP COLUMN, sin TRUNCATE,
--   sin CASCADE, sin DELETE ni UPDATE (ni con WHERE ni sin él).
-- FK/cascade risk: none, y la elección de `ON DELETE` es deliberada:
--   · SET NULL — al borrar una `invoice_items` sus filas de tributo NO se
--     eliminan (son dato fiscal: alimentan la declaración de IVA/INC, la
--     exógena y el `cac:TaxTotal` que la DIAN contrasta) pero tampoco quedan
--     apuntando a un id muerto. Degradan al camino histórico, que sigue siendo
--     correcto para ellas.
--   · NO se usa CASCADE. Un CASCADE aquí convertiría el borrado de una línea de
--     borrador en una pérdida silenciosa de impuesto del documento.
--   · NO se usa RESTRICT. `InvoicingService.update()` borra las líneas ANTES que
--     los tributos al reeditar un borrador; con RESTRICT ese orden explotaría en
--     P2003 y toda edición de factura devolvería 500.
--   La FK entrante hacia `invoice_items` no altera el `ON DELETE Cascade` que
--   `invoice_items` ya tiene hacia `invoices`: al borrar una factura, Postgres
--   borra sus líneas y sus tributos por las cascadas que YA existían desde
--   `invoices`, y esta FK nunca llega a evaluarse contra filas huérfanas.
-- Lock risk: mínimo. `ADD COLUMN` nullable sin DEFAULT es metadata-only en
--   Postgres 11+ (no reescribe la tabla). El `ADD CONSTRAINT ... FOREIGN KEY`
--   sí valida las filas existentes, pero todas quedan en NULL y una FK no
--   valida los NULL: el escaneo es trivial. El índice se crea sin CONCURRENTLY
--   a propósito — Prisma envuelve cada migración en una transacción y
--   CONCURRENTLY no puede correr dentro de una.
-- Idempotency: `ADD COLUMN IF NOT EXISTS`, FK guardada por `pg_constraint`,
--   `CREATE INDEX IF NOT EXISTS`, `COMMENT ON` reemplaza. La migración se puede
--   reproducir entera sin efectos secundarios.
-- Approval: hueco de MODELO DE DATOS de la reconstrucción de facturación
--   electrónica DIAN (fases 0-9 ya implementadas) — documentado en chat.
-- Skill: vendix-prisma-migrations (regla anti-destructiva + idempotencia).
--
-- ============================================================================
-- CONTEXTO — qué se rompía sin esta columna
-- ============================================================================
-- El emisor UBL escribe UN `cac:TaxSubtotal` por cada tributo DE LA LÍNEA
-- (`ubl-common.builder.ts`). `invoice_taxes`, en cambio, persistía los tributos
-- AGREGADOS por cabecera, así que el emisor no tenía de dónde sacar el desglose
-- y caía al camino histórico: heredarle a TODA línea el PRIMER tributo del
-- documento. En una factura mixta IVA + INC eso hace que todas las líneas
-- declaren el esquema de la primera —una cuenta de restaurante sale entera como
-- IVA 19 % o entera como INC 8 %— y la DIAN recompone los impuestos desde lo
-- que recibe, no desde lo que el emisor quiso decir.
--
-- El parche vigente (`InvoiceFlowService.attachLineTaxes`) reconstruye el
-- desglose enumerando los 2^n subconjuntos de tributos de cabecera y aceptando
-- el único que reproduce el impuesto de la línea al centavo. Es honesto pero es
-- una reconstrucción por fuerza bruta de un dato que debería estar persistido, y
-- tiene dos techos que no puede superar: se apaga con más de 6 o menos de 2
-- tributos, y excluye las líneas con precio impuesto-incluido.
--
-- ============================================================================
-- DOS FORMAS, NUNCA MEZCLADAS EN EL MISMO DOCUMENTO
-- ============================================================================
-- La decisión de modelado vive en `InvoicingService.needsPersistedLineTaxes()`:
--
--   · Documento con UN solo tributo ⇒ se sigue escribiendo UNA fila agregada de
--     cabecera con `invoice_item_id = NULL`. El camino histórico ya emite
--     EXACTAMENTE el mismo XML (misma base, mismo importe, mismo esquema), así
--     que partirla por línea no cambiaría un byte del documento y sí
--     multiplicaría las filas que leen el PDF (`invoice-pdf.builder.ts` imprime
--     una línea por fila), el detalle del panel y los reportes fiscales.
--
--   · Documento con ≥2 tributos ⇒ UNA fila por (línea × tributo), todas con
--     `invoice_item_id`, y NINGUNA fila agregada. La cabecera NO desaparece: se
--     deriva sumando, que es literalmente lo que ya hacen todos los
--     consumidores de esta tabla (`buildTaxTotals` agrupa por esquema DIAN y
--     suma, el prevalidador suma, la exógena suma, las declaraciones suman). Por
--     eso el `cac:TaxTotal` de cabecera sale idéntico y la regla FAS01b sigue
--     cuadrando.
--
-- Lo que NO se puede hacer —y por eso se descartó -- es conservar las filas
-- agregadas Y añadir además las de línea: cada consumidor SUMA sin filtrar, así
-- que el impuesto del documento saldría al doble y la DIAN lo rechazaría.

-- ============================================================================
-- 1. invoice_taxes.invoice_item_id — la línea que este tributo grava
-- ============================================================================

ALTER TABLE "invoice_taxes"
  ADD COLUMN IF NOT EXISTS "invoice_item_id" INTEGER;

-- ============================================================================
-- 2. FK con ON DELETE SET NULL
-- ============================================================================
-- Ver el bloque "FK/cascade risk" del header: ni CASCADE (perdería impuesto del
-- documento en silencio) ni RESTRICT (rompería la reedición de borradores, que
-- borra líneas antes que tributos).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_taxes_invoice_item_id_fkey'
  ) THEN
    ALTER TABLE "invoice_taxes"
      ADD CONSTRAINT "invoice_taxes_invoice_item_id_fkey"
      FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ============================================================================
-- 3. Índice
-- ============================================================================
-- El emisor agrupa los tributos del documento POR LÍNEA en cada envío
-- (`attachPersistedLineTaxes`), y el `ON DELETE SET NULL` obliga a Postgres a
-- buscar las filas hijas cada vez que se borra una `invoice_items` — que es
-- exactamente lo que hace `InvoicingService.update()` en cada edición de
-- borrador. Sin índice ese SET NULL es un seq scan de `invoice_taxes` por línea
-- borrada.

CREATE INDEX IF NOT EXISTS "invoice_taxes_invoice_item_id_idx"
  ON "invoice_taxes" ("invoice_item_id");

-- ============================================================================
-- 4. Comentario de columna en la propia base
-- ============================================================================
-- Para el próximo que abra psql sin el schema.prisma al lado, y sobre todo para
-- que nadie escriba filas agregadas y filas de línea en el mismo documento.

COMMENT ON COLUMN "invoice_taxes"."invoice_item_id" IS
  'Linea del documento que este tributo grava. NULL = fila de CABECERA (todo el historico, y la forma canonica de un documento con un solo tributo). Un documento usa UNA sola forma: o una fila agregada por tributo con invoice_item_id NULL, o una fila por (linea x tributo) con invoice_item_id NOT NULL. NUNCA las dos: cada consumidor de esta tabla SUMA sus filas sin filtrar (cac:TaxTotal de cabecera, prevalidador, exogena, declaraciones de IVA/INC/ICA), asi que agregado + desglose juntos duplicarian el impuesto del documento y la DIAN lo rechazaria por FAS01b. ON DELETE SET NULL: borrar una linea degrada la fila al camino historico en vez de borrar dato fiscal o bloquear la edicion del borrador.';
