-- DATA IMPACT:
-- Tables affected: invoices (una columna nueva, nullable)
-- Expected row changes: 0 — no se escribe ni se reescribe ninguna fila
-- Destructive operations: none (sin DROP, sin CASCADE, sin DELETE/UPDATE)
-- FK/cascade risk: none (columna escalar, sin llaves foráneas)
-- Idempotency: ADD COLUMN IF NOT EXISTS
-- Approval: aditiva y nullable; no requiere aprobación de mutación de datos

-- `invoices.aiu_contract_object` — objeto del contrato AIU de ESTE documento.
--
-- La regla CAV03 del Anexo Técnico 1.9 exige que la `cbc:Note` de la línea de
-- Administración empiece por «Contrato de servicios AIU por concepto de:» y
-- mida entre 20 y 5.000 caracteres. Hasta ahora ese objeto vivía únicamente en
-- `store_settings.invoicing.aiu.contract_object`, así que una empresa con
-- varios contratos AIU sólo podía declarar uno, y la nota se recomponía desde
-- la configuración VIGENTE al transmitir — no desde la que se validó al
-- capturar.
--
-- NULL conserva exactamente el comportamiento anterior: se cae al objeto de la
-- tienda. Por eso la columna no lleva DEFAULT y ninguna fila histórica cambia.
--
-- 4900 y no 5000 porque el prefijo obligatorio ya consume parte de la cota.
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "aiu_contract_object" VARCHAR(4900);
