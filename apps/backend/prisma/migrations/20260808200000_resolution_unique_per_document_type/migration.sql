-- DATA IMPACT:
-- Tables affected: invoice_resolutions (solo índices — ninguna fila se modifica)
-- Expected row changes: NINGUNO. No hay UPDATE, INSERT ni DELETE en este archivo.
-- Destructive operations: none. Se reemplazan tres índices únicos parciales por
--   los mismos con `document_type` añadido a la clave. Añadir una columna a una
--   clave única la hace MENOS restrictiva, así que ninguna fila que satisficiera
--   el índice viejo puede violar el nuevo: el CREATE no puede fallar por datos.
-- FK/cascade risk: none. No se toca ninguna FK.
-- Idempotency: `DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`. Una
--   segunda corrida no encuentra los viejos y no recrea los nuevos.
-- Atomicity: BEGIN/COMMIT EXPLÍCITOS. Prisma NO envuelve el archivo en una
--   transacción — lo aprendimos con 20260808160000, que quedó a medias tras fallar
--   en su octava sentencia. Sin este bloque, un fallo entre el DROP y el CREATE
--   dejaría la tabla SIN su unicidad de numeración, que es el peor estado posible
--   para una tabla que gobierna consecutivos autorizados por la DIAN.
-- Approval: paso 9 del plan de conexión DIAN aprobado por el usuario.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE
--
-- La factura electrónica de venta y el documento equivalente POS son actos
-- administrativos SEPARADOS de la DIAN. Cada uno se autoriza por su cuenta, con
-- su propia resolución, su propio rango y su propio set de pruebas — y la DIAN
-- permite que compartan prefijo, porque lo que identifica la autorización es el
-- par (resolución, tipo de documento), no el prefijo suelto.
--
-- Los tres índices únicos de `invoice_resolutions` no incluían `document_type`,
-- así que una entidad contable no podía tener a la vez su resolución de FEV y su
-- resolución de DE bajo el mismo prefijo. El resto del modelo ya asumía lo
-- contrario:
--
--   - la columna `document_type` existe, con enum `fiscal_document_type_enum`;
--   - hay dos índices que YA la usan:
--       @@index([accounting_entity_id, document_type, is_active])
--       @@index([organization_id, accounting_entity_id, document_type])
--   - `dian-config.service.ts` resuelve la habilitación POR TIPO de documento
--     (`configurationType`), con su propio `enablement_status`, precisamente
--     porque son autorizaciones distintas.
--
-- Todo el diseño estaba por tipo menos el unique. Este archivo lo alinea.
--
-- LOS TRES ÍNDICES Y POR QUÉ SON TRES
--
-- La numeración cuelga de la entidad contable cuando existe, y de la tienda o la
-- organización cuando no. Los tres índices son parciales y mutuamente excluyentes
-- por sus predicados, cubriendo las tres formas en que una resolución puede estar
-- anclada. Se conserva esa estructura tal cual: lo único que cambia es que
-- `document_type` entra en la clave de los tres.
--
-- ⚠️ ÍNDICES PARCIALES: INVISIBLES A PRISMA
--
-- Prisma no modela índices únicos PARCIALES, así que no los ve en el schema y
-- `prisma migrate dev` los interpreta como sobrantes de la base y genera su DROP.
-- Por eso viven en SQL bruto y NO se declaran en `schema.prisma` — declararlos
-- como `@@unique` completo cambiaría su semántica y rompería los tres predicados.
--
-- Antes de aceptar un `migrate dev` generado, revisar que no contenga
-- `DROP INDEX` sobre estos tres nombres.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Resoluciones ancladas a una entidad contable (el caso normal hoy).
DROP INDEX IF EXISTS "invoice_resolutions_entity_prefix_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_resolutions_entity_prefix_doctype_uidx"
    ON "invoice_resolutions" ("accounting_entity_id", "prefix", "document_type")
 WHERE "accounting_entity_id" IS NOT NULL;

-- 2. Resoluciones de tienda sin entidad contable (legado anterior al corte fiscal).
DROP INDEX IF EXISTS "invoice_resolutions_store_prefix_no_entity_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_resolutions_store_prefix_doctype_no_entity_uidx"
    ON "invoice_resolutions" ("organization_id", "store_id", "prefix", "document_type")
 WHERE "accounting_entity_id" IS NULL AND "store_id" IS NOT NULL;

-- 3. Resoluciones de organización sin tienda ni entidad contable.
DROP INDEX IF EXISTS "invoice_resolutions_org_prefix_no_store_no_entity_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_resolutions_org_prefix_doctype_no_store_no_entity_uidx"
    ON "invoice_resolutions" ("organization_id", "prefix", "document_type")
 WHERE "accounting_entity_id" IS NULL AND "store_id" IS NULL;

COMMIT;
