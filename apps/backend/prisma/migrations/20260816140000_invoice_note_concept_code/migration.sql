-- DATA IMPACT:
-- Tables affected: invoices (una columna nueva, nullable)
-- Expected row changes: 0 — cero UPDATE, cero INSERT, cero DELETE. Ninguna nota
--   ya emitida cambia un solo byte de su XML, su CUDE ni su total.
-- Destructive operations: none (sin DROP, sin TRUNCATE, sin CASCADE, sin
--   DELETE/UPDATE, sin ALTER TYPE)
-- FK/cascade risk: none (columna escalar, sin llaves foráneas)
-- Lock risk: none en la práctica. Postgres 11+ resuelve `ADD COLUMN` nullable
--   sin DEFAULT como cambio de catálogo: no reescribe la tabla.
-- Idempotency: ADD COLUMN IF NOT EXISTS (+ COMMENT ON, idempotente por
--   definición: reemplaza)
-- Approval: aditiva y nullable, sin mutación de filas; no requiere la aprobación
--   explícita que CLAUDE.md §6.3 exige para migraciones de datos.

-- ============================================================================
-- `invoices.note_concept_code` — concepto de corrección de una nota crédito o
-- débito (`cac:DiscrepancyResponse/cbc:ResponseCode`).
-- ============================================================================
-- POR QUÉ EXISTE ESTA COLUMNA
-- ---------------------------
-- El concepto DIAN no tenía dónde vivir. Los builders lo emitían como literal:
-- `ubl-credit-note.builder.ts` escribía `'2'` y `ubl-debit-note.builder.ts`
-- escribía `'2'`, pasara lo que pasara. Consecuencia fiscal: una nota crédito
-- por «Rebaja o descuento» (concepto 3) le declaraba a la DIAN «Anulación de
-- factura electrónica» (concepto 2). El documento se acepta —el código es
-- válido— pero AFIRMA algo distinto de lo que ocurrió, y queda así en el
-- repositorio de la DIAN.
--
-- El concepto elegido por el usuario sí viajaba, pero como PROSA: el frontend lo
-- anteponía entre corchetes al motivo, el servicio lo guardaba en
-- `invoices.notes` y el builder lo publicaba en `cbc:Description`. Un texto
-- libre no es un código: ningún validador lo lee y ninguna consulta lo agrupa.
--
-- CATÁLOGO (Anexo Técnico 1.9 §13.2.7.4 y §13.2.7.5, tablas 13.2.4 / 13.2.5;
-- `.gc` ConceptoNotaCredito-2.1 y ConceptoNotaDebito-2.1):
--   · nota crédito: '1' devolución parcial · '2' anulación · '3' rebaja o
--     descuento · '4' ajuste de precio · '5' otros
--   · nota débito:  '1' intereses · '2' gastos por cobrar · '3' cambio del valor
--     · '4' otro
-- Un solo dígito, sin cero a la izquierda: lo desempata la regla CAD02a del
-- anexo 1.9, que cita el código como "2". El detalle está en
-- `providers/dian-direct/constants/dian-note-concepts.ts`.
--
-- POR QUÉ NULLABLE Y SIN DEFAULT
-- ------------------------------
-- Mismo criterio que `invoices.operation_type` (migración
-- 20260815120000_dian_invoice_contract): un DEFAULT dejaría dos
-- representaciones del mismo valor conviviendo —las notas históricas en NULL y
-- las nuevas en '2'— y el lector tendría que tratar ambas igual. Con NULL ⇒ se
-- cae al literal histórico ('2') hay UNA sola regla, cero filas tocadas, y el
-- XML de las notas ya creadas sigue saliendo exactamente igual que antes.
--
-- POR QUÉ VARCHAR(2) PARA UN DÍGITO
-- ---------------------------------
-- Consistencia con `invoices.operation_type VARCHAR(2)`, que es la otra columna
-- de código DIAN de esta tabla, y holgura para el formato de dos dígitos
-- ('01'…'06') que usa el Schematron de 2019 por si la DIAN vuelve a él. El
-- dominio real lo cierra el DTO con `@IsIn`, no el ancho de la columna.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "note_concept_code" VARCHAR(2);

COMMENT ON COLUMN "invoices"."note_concept_code" IS
  'Concepto de correccion de una nota credito o debito - cac:DiscrepancyResponse/cbc:ResponseCode. Nota credito: 1 devolucion parcial, 2 anulacion, 3 rebaja o descuento, 4 ajuste de precio, 5 otros. Nota debito: 1 intereses, 2 gastos por cobrar, 3 cambio del valor, 4 otro (Anexo Tecnico 1.9, tablas 13.2.4 y 13.2.5). Un solo digito, sin cero a la izquierda (regla CAD02a). NULL = se emite el literal historico 2, que es lo que los builders escribian antes de que existiera esta columna; sin DEFAULT para no crear dos representaciones del mismo valor. Solo aplica a invoice_type credit_note / debit_note.';
