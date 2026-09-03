-- =====================================================================
-- Migration: bank_accounts_image (QUI-728 / imagen 21:9 por cuenta)
-- Purpose:   añadir `image_s3_key` nullable a `bank_accounts` para que
--            cada cuenta bancaria pueda tener su propio logo/imagen
--            (relación 21:9) subido vía S3. La ruta completa la firma
--            `S3Service.getPresignedUrl` al servir el listado; nunca se
--            guarda la URL firmada en DB.
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: bank_accounts
--   Expected row changes: 0 (additive, nullable, sin backfill)
--   Destructive operations: none
--   FK/cascade risk: none
--   Idempotency: ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   Approval: QUI-728 (transferencia bancaria multi-cuenta + imagen)
-- =====================================================================

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS image_s3_key VARCHAR(512);