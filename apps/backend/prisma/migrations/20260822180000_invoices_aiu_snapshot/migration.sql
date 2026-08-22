-- Congela el régimen de base gravable AIU en la propia factura.
--
-- DATA IMPACT:
--   Tablas afectadas: invoices (solo DDL)
--   Filas mutadas esperadas: 0
--   Operación: 3 x ADD COLUMN, todas NULLABLE y SIN DEFAULT
--   Sin UPDATE, sin DELETE, sin DROP, sin TRUNCATE, sin CASCADE
--   FKs entrantes: no se toca ninguna (no hay FK nueva en esta migración)
--   Reversible: DROP COLUMN de tres columnas recién creadas y vacías
--
-- POR QUÉ NO SE RELLENAN LAS FILAS EXISTENTES
--   Las 84 facturas actuales se emitieron leyendo el régimen VIVO de
--   store_settings.invoicing.aiu. Rellenar aquí un régimen sería inventar con
--   qué configuración se emitieron: el ajuste pudo cambiar después. NULL es el
--   dato honesto y el código lo interpreta como "cae al ajuste vivo, con traza".
--
-- POR QUÉ ESTAS COLUMNAS EXISTEN
--   Los dos regímenes AIU son incompatibles y deciden qué parte del contrato es
--   base gravable: E.T. art. 462-1 grava A+I+U con piso del 10 % del valor del
--   contrato; Decreto 1372/1992 art. 3 grava solo la Utilidad. Mientras el
--   régimen vivía únicamente en la configuración de la tienda, cambiarlo entre
--   la captura y la transmisión hacía que el XML declarara una base distinta de
--   la calculada — exactamente lo que prohíben FAU04 y FAX01 del Anexo Técnico
--   1.9. Mismo criterio que ya sostiene invoices.aiu_contract_object.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "aiu_regime" VARCHAR(30);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "aiu_minimum_percent" DECIMAL(5,2);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "aiu_taxable_matrix" JSONB;

COMMENT ON COLUMN "invoices"."aiu_regime" IS
  'Snapshot del régimen de base gravable AIU con el que se calculó este documento: et_462_1 (grava A+I+U) o decreto_1372_1992 (grava solo Utilidad). NULL = factura anterior a esta columna; se cae al ajuste vivo de la tienda con traza explícita.';
COMMENT ON COLUMN "invoices"."aiu_minimum_percent" IS
  'Snapshot del piso legal aplicado sobre el valor del contrato (10.00 por defecto en et_462_1). Se re-verifica antes de firmar; su divergencia emite INVOICING_AIU_001.';
COMMENT ON COLUMN "invoices"."aiu_taxable_matrix" IS
  'Snapshot de la gravabilidad efectiva por componente AIU y la tarifa que la sostiene. Es el dato que el calculador no tenia: sin tarifa no podia imponer el impuesto de una linea gravable declarada sin impuesto, y la factura salia sub-declarada.';
