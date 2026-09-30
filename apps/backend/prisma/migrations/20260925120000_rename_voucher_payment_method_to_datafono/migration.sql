-- DATA IMPACT:
-- Tables affected: system_payment_methods, store_payment_methods
-- Expected row changes (prod, verified 2026-09-25 with READ ONLY query):
--   * system_payment_methods: 1 row (name = 'payment_vouchers')
--   * store_payment_methods: 76 rows whose display_name is still the
--     inherited default 'Vouchers de Pago'
-- Destructive operations: none (display_name / description only)
-- FK/cascade risk: none (no key, FK or enum is touched)
-- Idempotency: guarded by WHERE on the old label; a re-run changes 0 rows
-- Approval: documented in chat (2026-09-25)
--
-- Renombra la etiqueta visible del medio de pago `voucher` a "Datáfono".
-- El identificador interno (`type = 'voucher'`, `name = 'payment_vouchers'`)
-- NO cambia: lo leen el checkout, la contabilidad y el mapeo DIAN.
--
-- Las tiendas copian el display_name del sistema al activarse
-- (onboarding.service.ts), por eso se actualizan tambien sus filas; solo las
-- que conservan el texto heredado, para no pisar un nombre personalizado.

UPDATE "system_payment_methods"
SET "display_name" = 'Datáfono',
    "description"  = 'Pago con tarjeta débito o crédito mediante datáfono',
    "updated_at"   = NOW()
WHERE "name" = 'payment_vouchers'
  AND "display_name" = 'Vouchers de Pago';

UPDATE "store_payment_methods" spm
SET "display_name" = 'Datáfono',
    "updated_at"   = NOW()
FROM "system_payment_methods" sm
WHERE sm."id" = spm."system_payment_method_id"
  AND sm."name" = 'payment_vouchers'
  AND spm."display_name" = 'Vouchers de Pago';
