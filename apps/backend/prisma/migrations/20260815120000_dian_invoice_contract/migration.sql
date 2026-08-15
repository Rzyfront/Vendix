-- DATA IMPACT:
-- Tables affected: invoices, invoice_items, invoice_resolutions
-- Types created (1):
--   - aiu_component_enum  ('administracion', 'imprevistos', 'utilidad')  [NUEVO]
-- Columns added (16) — TODAS nullable, TODAS sin DEFAULT:
--   invoices (12):
--     - customer_email                    VARCHAR(255)  NULL
--     - customer_phone                    VARCHAR(50)   NULL
--     - customer_document_type            VARCHAR(5)    NULL
--     - customer_verification_digit       VARCHAR(1)    NULL
--     - customer_tax_regime               VARCHAR(10)   NULL
--     - customer_fiscal_responsibilities  JSONB         NULL
--     - payment_form                      VARCHAR(2)    NULL
--     - payment_means_code                VARCHAR(3)    NULL
--     - operation_type                    VARCHAR(2)    NULL
--     - foreign_currency                  VARCHAR(3)    NULL
--     - foreign_total_amount              DECIMAL(14,2) NULL
--     - exchange_rate_date                DATE          NULL
--   invoice_items (3):
--     - unit_code                         VARCHAR(10)   NULL
--     - account_code                      VARCHAR(20)   NULL
--     - aiu_component                     aiu_component_enum NULL
--   invoice_resolutions (1):
--     - technical_key_encrypted           TEXT          NULL
-- Indexes added: NINGUNO. Ninguna de las 16 columnas es predicado de una
--   consulta existente: todas son snapshot de emisión, se escriben al construir
--   el documento y se releen por la MISMA fila (invoices.id) o por el índice ya
--   existente invoice_items(invoice_id). Un índice aquí solo costaría escritura.
-- Expected row changes: NINGUNO. Cero UPDATE, cero INSERT, cero DELETE. Toda
--   columna nace NULL en las filas existentes; ninguna factura histórica cambia
--   un solo byte de su total, su CUFE ni su XML ya emitido.
-- Destructive operations: none. No hay DROP TABLE, DROP COLUMN, TRUNCATE,
--   CASCADE, DELETE ni UPDATE. Tampoco ALTER TYPE ... ADD VALUE: el único tipo
--   enum es NUEVO (patrón guardado por pg_type), y crear un tipo y usarlo en la
--   misma transacción SÍ es seguro — lo prohibido es agregar un VALOR a un enum
--   preexistente y usarlo en la misma migración.
-- FK/cascade risk: none. No se crea, altera ni elimina ninguna foreign key.
-- Lock risk: none en la práctica. Postgres 11+ resuelve `ADD COLUMN` nullable
--   sin DEFAULT como cambio de catálogo (metadata-only): no reescribe la tabla,
--   toma ACCESS EXCLUSIVE por milisegundos.
-- Idempotency: cada ADD COLUMN lleva IF NOT EXISTS y el CREATE TYPE va dentro
--   de un DO $$ guardado por pg_type. La migración se puede reproducir entera.
-- Approval: Fase 1 (contrato de datos) del plan de reconstrucción de facturación
--   electrónica DIAN — documentado en chat.
--
-- ============================================================================
-- CONTEXTO
-- ============================================================================
-- El backend ya construye estos datos en memoria (`ProviderInvoiceData` en
-- `providers/invoice-provider.interface.ts`, `customer-invoice-data.adapter.ts`)
-- pero la tabla no tiene dónde guardarlos: hoy se resuelven en CADA envío a la
-- DIAN, y cuando el frontend los manda la escritura revienta con 400 porque la
-- columna no existe. Esta migración es puramente ADITIVA: abre el hueco de
-- persistencia. NO escribe datos, NO backfillea, NO toca ninguna fila.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO:
--   1. NO migra `invoice_resolutions.technical_key` (texto plano) a
--      `technical_key_encrypted`. Ese backfill mueve un secreto y es una
--      migración de DATOS aparte, que exige aprobación explícita del humano y
--      snapshot de producción (CLAUDE.md §6.3).
--   2. NO pone DEFAULT en `operation_type` aunque '10' sea el valor estándar.
--      Un DEFAULT dejaría dos representaciones de lo mismo conviviendo (las
--      filas viejas en NULL y las nuevas en '10') y el lector tendría que
--      manejar ambas igual. Con NULL ⇒ '10' hay una sola regla y cero filas
--      tocadas.

-- ============================================================================
-- 1. Tipo enum NUEVO: componente AIU de una línea de factura
-- ============================================================================
-- Régimen AIU (Administración, Imprevistos, Utilidad): el IVA no grava el valor
-- total del contrato sino un subconjunto, y cuál es depende del régimen:
--   · E.T. art. 462-1 (aseo y cafetería, vigilancia, temporales de empleo):
--     base = AIU COMPLETO (A+I+U), nunca inferior al 10% del contrato.
--   · Decreto 1372/1992 art. 3 (construcción de inmueble):
--     base = ÚNICAMENTE la Utilidad.
-- La línea declara a qué componente pertenece para que la base se calcule sobre
-- el subconjunto correcto; la cabecera lo marca con `CustomizationID` = '09'
-- (Anexo Técnico 1.9). El régimen es configuración de la tienda, no se deduce.
--
-- Es un tipo NUEVO, no un valor añadido a un enum existente: por eso es seguro
-- crearlo y referenciarlo en esta misma migración.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aiu_component_enum') THEN
    CREATE TYPE "aiu_component_enum" AS ENUM (
      'administracion',
      'imprevistos',
      'utilidad'
    );
  END IF;
END$$;

-- ============================================================================
-- 2. invoices — snapshot fiscal del adquiriente y de la operación
-- ============================================================================
-- Bloque 2.a — Adquiriente. Snapshot al momento de facturar, igual que el
-- `customer_address JSONB` que ya vive en esta tabla: que el cliente cambie de
-- correo, de régimen o de responsabilidades mañana NO debe reescribir el
-- documento que la DIAN ya validó.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_email" VARCHAR(255);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_phone" VARCHAR(50);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_document_type" VARCHAR(5);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_verification_digit" VARCHAR(1);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_tax_regime" VARCHAR(10);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_fiscal_responsibilities" JSONB;

-- Bloque 2.b — Forma y medio de pago (cac:PaymentMeans).

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "payment_form" VARCHAR(2);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "payment_means_code" VARCHAR(3);

-- Bloque 2.c — Tipo de operación (cbc:CustomizationID).

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "operation_type" VARCHAR(2);

-- Bloque 2.d — Conversión a divisa extranjera (cac:PaymentExchangeRate).
-- OJO: la factura SIEMPRE se emite en pesos colombianos. Estas tres columnas
-- NO cambian eso; solo DECLARAN la conversión. Ver el comentario de columna.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "foreign_currency" VARCHAR(3);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "foreign_total_amount" DECIMAL(14, 2);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "exchange_rate_date" DATE;

-- ============================================================================
-- 3. invoice_items — unidad de medida, cuenta PUC y componente AIU
-- ============================================================================

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "unit_code" VARCHAR(10);

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "account_code" VARCHAR(20);

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "aiu_component" "aiu_component_enum";

-- ============================================================================
-- 4. invoice_resolutions — clave técnica cifrada
-- ============================================================================
-- Se AÑADE la columna y nada más. `technical_key` sigue en texto plano y con
-- sus valores intactos: mover el secreto es una migración de datos aparte.

ALTER TABLE "invoice_resolutions"
  ADD COLUMN IF NOT EXISTS "technical_key_encrypted" TEXT;

-- ============================================================================
-- 5. Comentarios de columna en la propia base
-- ============================================================================
-- Solo sobre las columnas donde el próximo lector va a suponer lo contrario de
-- lo que es. COMMENT ON es idempotente por definición (reemplaza).

COMMENT ON COLUMN "invoices"."customer_document_type" IS
  'Codigo DIAN del tipo de identificacion del adquiriente (11,12,13,21,22,31,41,42,47,48,50,91). CRITICO: decide si al calcular el CUFE se recorta el digito de verificacion - solo el NIT (31) lo lleva. Ver dianPartyId() en common/utils/nit.util.ts. VARCHAR(5) y no (2) porque el provider todavia acepta el alias interno (CC, NIT, NUIP).';

COMMENT ON COLUMN "invoices"."customer_tax_regime" IS
  'Codigo DIAN de regimen fiscal del adquiriente (cbc:TaxLevelCode), p.ej. 48 responsable de IVA / 49 no responsable. Es el CODIGO, no la etiqueta de users.tax_regime (GRAN_CONTRIBUYENTE no cabe en 10 caracteres, y a proposito: el XML necesita el codigo).';

COMMENT ON COLUMN "invoices"."operation_type" IS
  'cbc:CustomizationID - tipo de operacion DIAN: 10 estandar, 09 AIU, 11 mandatos, 12 transporte. NULL equivale a 10 (no hay DEFAULT para no crear dos representaciones del mismo valor).';

COMMENT ON COLUMN "invoices"."foreign_currency" IS
  'ISO 4217 de la divisa en que se PACTO la operacion. NO cambia la moneda del documento: la factura se emite SIEMPRE en COP (DocumentCurrencyCode=COP, Res. DIAN 000042/2020 art. 73). Esta columna solo declara la conversion en cac:PaymentExchangeRate.';

COMMENT ON COLUMN "invoices"."foreign_total_amount" IS
  'Total equivalente en foreign_currency. Informativo/declarativo: el importe legal sigue siendo total_amount en COP. DECIMAL(14,2) - mas holgura que los 12,2 vecinos porque una divisa debil multiplica el numero de digitos.';

COMMENT ON COLUMN "invoice_items"."account_code" IS
  'SNAPSHOT de la cuenta PUC de ingreso de esta linea al momento de facturar. Que el producto cambie de cuenta manana NO debe reescribir un asiento ya contabilizado. Mismo patron que withholding_concepts.account_code.';

COMMENT ON COLUMN "invoice_resolutions"."technical_key_encrypted" IS
  'Clave tecnica DIAN cifrada. Convive con technical_key en texto plano: esta migracion NO backfillea ni muta los valores existentes. Migrar el secreto requiere aprobacion explicita del humano y snapshot de produccion (CLAUDE.md 6.3).';
