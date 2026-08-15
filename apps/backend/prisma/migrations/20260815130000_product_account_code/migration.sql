-- DATA IMPACT:
-- Tables affected: products, product_variants
-- Types created: NINGUNO. No se crea ni se altera ningún enum.
-- Columns added (2) — TODAS nullable, TODAS sin DEFAULT:
--   products (1):
--     - account_code                      VARCHAR(20)   NULL
--   product_variants (1):
--     - account_code                      VARCHAR(20)   NULL
-- Indexes added: NINGUNO. `account_code` NUNCA es predicado de una consulta:
--   se LEE por la fila que ya se trajo (el producto/variante de una línea de
--   factura, resuelto por `invoice_items.product_id` / `product_variant_id`,
--   que ya tienen sus propias FKs) y se VALIDA por `chart_of_accounts(code)`,
--   que es otra tabla. Nadie hace `WHERE products.account_code = ...`. Un
--   índice aquí solo costaría escritura en la tabla más caliente del catálogo.
-- Expected row changes: NINGUNO. Cero UPDATE, cero INSERT, cero DELETE. Las dos
--   columnas nacen NULL en TODAS las filas existentes, y NULL es exactamente el
--   contrato del comportamiento histórico ("resolver por el mapping por
--   defecto"). Ningún producto cambia de cuenta, ningún asiento ya posteado se
--   reescribe, ningún total de factura se mueve un centavo.
-- Destructive operations: none. No hay DROP TABLE, DROP COLUMN, TRUNCATE,
--   CASCADE, DELETE ni UPDATE. Tampoco ALTER TYPE ... ADD VALUE.
-- FK/cascade risk: none. NO se crea foreign key contra `chart_of_accounts`.
--   Es deliberado, ver la nota "POR QUÉ NO HAY FK" más abajo.
-- Lock risk: none en la práctica. Postgres 11+ resuelve `ADD COLUMN` nullable
--   sin DEFAULT como cambio de catálogo (metadata-only): no reescribe la tabla,
--   toma ACCESS EXCLUSIVE por milisegundos. Importa porque `products` es una de
--   las tablas más grandes y más leídas del sistema.
-- Idempotency: cada ADD COLUMN lleva IF NOT EXISTS; los COMMENT ON son
--   idempotentes por definición (reemplazan). La migración se puede reproducir
--   entera sin efectos secundarios.
-- Approval: Fase 7 (cuenta contable por producto + asiento mixto) del plan de
--   reconstrucción de facturación electrónica DIAN — documentado en chat.
--
-- ============================================================================
-- CONTEXTO
-- ============================================================================
-- Hoy el asiento de una venta acredita UNA SOLA cuenta de ingreso: la que
-- resuelve el mapping `invoice.validated.revenue` (por defecto 4135). Un PUC
-- real no funciona así — el contador separa líneas de negocio en subcuentas
-- distintas (413550 comercio al por menor, 413536 alimentos, 4145 servicios...)
-- y hoy la única salida es un asiento manual de reclasificación por CADA venta,
-- que es justo el trabajo que la contabilidad automática venía a eliminar.
--
-- Estas dos columnas dejan que el producto (o la variante, que es la unidad
-- realmente vendida) declare su propia subcuenta. El asiento agrupa las líneas
-- por cuenta resuelta y emite UNA línea de asiento por cuenta: de ahí sale el
-- ASIENTO MIXTO, donde las líneas con subcuenta propia conviven con las que
-- caen al ingreso por defecto.
--
-- ORDEN DE RESOLUCIÓN (implementado en `resolveInvoiceRevenueLines()`):
--   1. invoice_items.account_code   ← SNAPSHOT, manda sobre todo lo demás
--   2. product_variants.account_code
--   3. products.account_code
--   4. mapping key por defecto (`invoice.validated.revenue`)
--
-- El snapshot manda a propósito: que el producto se remapee mañana NO debe
-- reescribir un asiento ya contabilizado. El asiento tiene que poder
-- reconstruirse desde el documento, no desde el catálogo vivo.
--
-- POR QUÉ ESTA MIGRACIÓN NO CREA `invoice_items.account_code`:
--   Ya existe. La creó `20260815120000_dian_invoice_contract` con el mismo tipo
--   y el mismo ancho. Esta migración solo añade los DOS eslabones del catálogo
--   vivo que alimentan ese snapshot.
--
-- POR QUÉ NO HAY FK CONTRA `chart_of_accounts`:
--   1. `chart_of_accounts` se identifica por (organization_id, code) — `code`
--      NO es único global; el mismo '413550' existe una vez por organización (y
--      puede existir además por `accounting_entity_id`). Una FK necesitaría el
--      `id` numérico, y guardar el `id` rompería el requisito de que el valor
--      sea legible y portable entre entornos.
--   2. Es exactamente lo que hace el precedente ya probado en producción,
--      `withholding_concepts.account_code`: guarda el CÓDIGO PUC en texto y
--      valida contra el catálogo en el momento de usarlo.
--   3. La validación real (existe en la org Y `accepts_entries = true`) es más
--      fuerte que lo que una FK podría expresar: una FK dejaría pasar una
--      cuenta de AGRUPACIÓN, que es precisamente el error que rompe el asiento.
--      Vive en `accountCodeExistsForOrg(..., require_accepts_entries)`.

-- ============================================================================
-- 1. products.account_code — subcuenta PUC de ingreso del producto
-- ============================================================================

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "account_code" VARCHAR(20);

-- ============================================================================
-- 2. product_variants.account_code — override a nivel de variante
-- ============================================================================
-- Gana sobre el producto padre: dos presentaciones del mismo producto pueden
-- pertenecer a líneas de negocio distintas, y un mapping por producto no
-- sabría separarlas.

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "account_code" VARCHAR(20);

-- ============================================================================
-- 3. Comentarios de columna en la propia base
-- ============================================================================
-- Para el próximo lector que abra psql sin el schema.prisma al lado — y sobre
-- todo para que nadie confunda "cuenta vigente" con "cuenta contabilizada".

COMMENT ON COLUMN "products"."account_code" IS
  'Subcuenta PUC de INGRESO propia del producto (override del mapping invoice.validated.revenue, por defecto 4135). Debe existir en chart_of_accounts de la organizacion Y tener accepts_entries = true: una cuenta de agrupacion no puede recibir asientos. NULL = resolver por el mapping por defecto (comportamiento historico). NO es la cuenta contabilizada sino la VIGENTE: la contabilizada es el snapshot invoice_items.account_code. Mismo patron que withholding_concepts.account_code.';

COMMENT ON COLUMN "product_variants"."account_code" IS
  'Subcuenta PUC de INGRESO propia de la variante. Gana sobre products.account_code porque la variante es la unidad realmente vendida. NULL = hereda del producto padre; si el padre tampoco la define, cae al mapping por defecto. Mismas reglas de validacion que products.account_code.';
