-- =====================================================================
-- Migration: bank_transfer_config_accounts (CP-POLLO-ARABE-727 E.1 / QUI-728)
-- Purpose: Migrar el `custom_config` LEGACY del método `bank_transfer` del shape
--          plano `{ bank_name, account_number, account_holder, swift_code, clabe }`
--          al shape multi-cuenta `{ accounts: [{ ...root, legacy: true }] }`.
--          El campo `bank_name` NO se borra: se mueve a `accounts[0].legacy`
--          (marcado con `legacy: true` para que la UI lo distinga de una cuenta
--          vinculada a `bank_accounts.id`).
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: store_payment_methods (DATA MUTATION — alcance de PLATAFORMA,
--                    todos los tenants con el método `bank_transfer` activado)
--   Rows mutated:    las filas cuyo `system_payment_method.type = 'bank_transfer'`
--                    Y cuyo `custom_config` aún es el shape plano (tiene la clave
--                    `bank_name` y NO tiene la clave `accounts`). Cambio esperado:
--                    exactamente el número de métodos bank_transfer sin migrar.
--   Destructive operations: none (no se borra `bank_name`; se reasigna dentro de
--                    `accounts[0].legacy`)
--   FK/cascade risk: none
--   Idempotency: WHERE excluye las filas que ya tienen `accounts`; re-ejecutar es
--                no-op (no re-migra las ya migradas).
--   Approval: CP-POLLO-ARABE-727 E.1 (QUI-728)
-- =====================================================================

UPDATE "store_payment_methods" AS spm
SET "custom_config" = jsonb_build_object(
  'accounts',
  jsonb_build_array( (spm."custom_config"::jsonb || jsonb_build_object('legacy', true)) )
)
WHERE spm."custom_config" IS NOT NULL
  AND spm."custom_config"::jsonb ? 'bank_name'
  AND NOT (spm."custom_config"::jsonb ? 'accounts')
  AND EXISTS (
    SELECT 1
    FROM "system_payment_methods" AS sy
    WHERE sy."id" = spm."system_payment_method_id"
      AND sy."type" = 'bank_transfer'
  );
