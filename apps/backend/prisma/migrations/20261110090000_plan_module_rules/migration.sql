-- Matriz de accesos por plan (odd/tasks/planes-matriz-accesos.md §2 y §4.1).
--
-- Qué hace:
--   1. Crea el enum plan_module_rule_mode_enum ('exclusive', 'blocked').
--   2. Crea la tabla plan_module_rules (plan_id, module_key, mode) con único
--      (plan_id, module_key), índice por module_key y FK a subscription_plans
--      con ON DELETE RESTRICT.
--   3. Siembra las reglas de las cuatro líneas comerciales activas, por prefijo
--      de código (variantes mensual/trimestral/anual incluidas), según
--      PLAN_MATRIX en apps/backend/src/common/access/plan-modules.ts:
--        - vendix-impulsa%, emprendedor-pro%: 'blocked' para los 35 módulos de
--          facturación, contabilidad, impuestos, cartera, nómina y operación fiscal.
--        - empresarial-pro%: 'exclusive' para esos 35 módulos.
--        - ia-business%: 'exclusive' para esos 35 + flows y documents.
--      Promocionales (is_promotional o plan_type='promotional') y archivados
--      (archived_at no nulo) quedan fuera de la matriz: sin filas, el plan no
--      bloquea nada.
--
-- Efecto en producción: ninguno visible. La capa de plan arranca en modo
-- auditoría (solo registra ACCESS_AUDIT layer='plan'); bloquea únicamente con
-- la llave Redis access_gate:plan:enforce:all = '1' (o la de la tienda).
--
-- DATA IMPACT:
--   Tables affected: plan_module_rules (tabla nueva). Ninguna tabla existente
--     cambia filas; subscription_plans solo se LEE.
--   Expected row changes: 35 filas por plan no promocional ni archivado cuyo
--     código empiece por vendix-impulsa, emprendedor-pro o empresarial-pro, y
--     37 por cada ia-business. Conteo previo de planes afectados:
--       SELECT code FROM subscription_plans
--       WHERE archived_at IS NULL AND is_promotional = false
--         AND plan_type <> 'promotional'
--         AND (code LIKE 'vendix-impulsa%' OR code LIKE 'emprendedor-pro%'
--              OR code LIKE 'empresarial-pro%' OR code LIKE 'ia-business%');
--   Destructive operations: ninguna. Sin DELETE, DROP, TRUNCATE ni UPDATE.
--   FK/cascade risk: FK nueva plan_module_rules.plan_id → subscription_plans
--     con ON DELETE RESTRICT (no hay cascada sobre datos de negocio).
--   Idempotency: tipos y tabla con IF NOT EXISTS / pg_type; inserts con
--     ON CONFLICT (plan_id, module_key) DO NOTHING.
--   Reversa: apagar la capa no requiere migración (sin la llave Redis la capa
--     solo audita). Para retirar las reglas, una migración nueva con
--     DELETE FROM plan_module_rules WHERE plan_id IN (...) acotado, o renombrar
--     la tabla a plan_module_rules_deprecated_YYYYMMDD; nunca DROP directo.
--   Approval: brief de Rafael (2026-11-04 02:44), "Migración aditiva e
--     idempotente: tabla plan_module_rules ... Seed de reglas para los planes
--     activos". Snapshot de prod antes del deploy.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_module_rule_mode_enum') THEN
    CREATE TYPE "plan_module_rule_mode_enum" AS ENUM ('exclusive', 'blocked');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "plan_module_rules" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "module_key" VARCHAR(64) NOT NULL,
    "mode" "plan_module_rule_mode_enum" NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_module_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plan_module_rules_plan_id_module_key_key"
  ON "plan_module_rules"("plan_id", "module_key");

CREATE INDEX IF NOT EXISTS "plan_module_rules_module_key_idx"
  ON "plan_module_rules"("module_key");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plan_module_rules_plan_id_fkey'
  ) THEN
    ALTER TABLE "plan_module_rules"
      ADD CONSTRAINT "plan_module_rules_plan_id_fkey"
      FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- vendix-impulsa%: blocked (35 módulos)
INSERT INTO "plan_module_rules" ("plan_id", "module_key", "mode")
SELECT p."id", k."module_key", 'blocked'::"plan_module_rule_mode_enum"
FROM "subscription_plans" p
CROSS JOIN (VALUES
  ('invoicing'),
  ('invoicing_invoices'),
  ('invoicing_resolutions'),
  ('invoicing_dian_config'),
  ('accounting'),
  ('accounting_journal_entries'),
  ('accounting_chart_of_accounts'),
  ('accounting_fiscal_periods'),
  ('accounting_account_mappings'),
  ('accounting_flows_dashboard'),
  ('accounting_withholding_tax'),
  ('accounting_exogenous'),
  ('reports_accounting'),
  ('taxes'),
  ('taxes_ica'),
  ('cartera_dashboard'),
  ('cartera_receivables'),
  ('cartera_payables'),
  ('cartera_aging'),
  ('payroll'),
  ('payroll_employees'),
  ('payroll_runs'),
  ('payroll_settlements'),
  ('payroll_novelties'),
  ('payroll_advances'),
  ('payroll_pila'),
  ('payroll_settings'),
  ('reports_payroll'),
  ('fiscal_operations'),
  ('fiscal_dashboard'),
  ('fiscal_obligations'),
  ('fiscal_declarations'),
  ('fiscal_close'),
  ('fiscal_audit'),
  ('fiscal_rules')
) AS k("module_key")
WHERE p."code" LIKE 'vendix-impulsa%'
  AND p."archived_at" IS NULL
  AND p."is_promotional" = false
  AND p."plan_type" <> 'promotional'
ON CONFLICT ("plan_id", "module_key") DO NOTHING;

-- emprendedor-pro%: blocked (35 módulos)
INSERT INTO "plan_module_rules" ("plan_id", "module_key", "mode")
SELECT p."id", k."module_key", 'blocked'::"plan_module_rule_mode_enum"
FROM "subscription_plans" p
CROSS JOIN (VALUES
  ('invoicing'),
  ('invoicing_invoices'),
  ('invoicing_resolutions'),
  ('invoicing_dian_config'),
  ('accounting'),
  ('accounting_journal_entries'),
  ('accounting_chart_of_accounts'),
  ('accounting_fiscal_periods'),
  ('accounting_account_mappings'),
  ('accounting_flows_dashboard'),
  ('accounting_withholding_tax'),
  ('accounting_exogenous'),
  ('reports_accounting'),
  ('taxes'),
  ('taxes_ica'),
  ('cartera_dashboard'),
  ('cartera_receivables'),
  ('cartera_payables'),
  ('cartera_aging'),
  ('payroll'),
  ('payroll_employees'),
  ('payroll_runs'),
  ('payroll_settlements'),
  ('payroll_novelties'),
  ('payroll_advances'),
  ('payroll_pila'),
  ('payroll_settings'),
  ('reports_payroll'),
  ('fiscal_operations'),
  ('fiscal_dashboard'),
  ('fiscal_obligations'),
  ('fiscal_declarations'),
  ('fiscal_close'),
  ('fiscal_audit'),
  ('fiscal_rules')
) AS k("module_key")
WHERE p."code" LIKE 'emprendedor-pro%'
  AND p."archived_at" IS NULL
  AND p."is_promotional" = false
  AND p."plan_type" <> 'promotional'
ON CONFLICT ("plan_id", "module_key") DO NOTHING;

-- empresarial-pro%: exclusive (35 módulos)
INSERT INTO "plan_module_rules" ("plan_id", "module_key", "mode")
SELECT p."id", k."module_key", 'exclusive'::"plan_module_rule_mode_enum"
FROM "subscription_plans" p
CROSS JOIN (VALUES
  ('invoicing'),
  ('invoicing_invoices'),
  ('invoicing_resolutions'),
  ('invoicing_dian_config'),
  ('accounting'),
  ('accounting_journal_entries'),
  ('accounting_chart_of_accounts'),
  ('accounting_fiscal_periods'),
  ('accounting_account_mappings'),
  ('accounting_flows_dashboard'),
  ('accounting_withholding_tax'),
  ('accounting_exogenous'),
  ('reports_accounting'),
  ('taxes'),
  ('taxes_ica'),
  ('cartera_dashboard'),
  ('cartera_receivables'),
  ('cartera_payables'),
  ('cartera_aging'),
  ('payroll'),
  ('payroll_employees'),
  ('payroll_runs'),
  ('payroll_settlements'),
  ('payroll_novelties'),
  ('payroll_advances'),
  ('payroll_pila'),
  ('payroll_settings'),
  ('reports_payroll'),
  ('fiscal_operations'),
  ('fiscal_dashboard'),
  ('fiscal_obligations'),
  ('fiscal_declarations'),
  ('fiscal_close'),
  ('fiscal_audit'),
  ('fiscal_rules')
) AS k("module_key")
WHERE p."code" LIKE 'empresarial-pro%'
  AND p."archived_at" IS NULL
  AND p."is_promotional" = false
  AND p."plan_type" <> 'promotional'
ON CONFLICT ("plan_id", "module_key") DO NOTHING;

-- ia-business%: exclusive (37 módulos)
INSERT INTO "plan_module_rules" ("plan_id", "module_key", "mode")
SELECT p."id", k."module_key", 'exclusive'::"plan_module_rule_mode_enum"
FROM "subscription_plans" p
CROSS JOIN (VALUES
  ('invoicing'),
  ('invoicing_invoices'),
  ('invoicing_resolutions'),
  ('invoicing_dian_config'),
  ('accounting'),
  ('accounting_journal_entries'),
  ('accounting_chart_of_accounts'),
  ('accounting_fiscal_periods'),
  ('accounting_account_mappings'),
  ('accounting_flows_dashboard'),
  ('accounting_withholding_tax'),
  ('accounting_exogenous'),
  ('reports_accounting'),
  ('taxes'),
  ('taxes_ica'),
  ('cartera_dashboard'),
  ('cartera_receivables'),
  ('cartera_payables'),
  ('cartera_aging'),
  ('payroll'),
  ('payroll_employees'),
  ('payroll_runs'),
  ('payroll_settlements'),
  ('payroll_novelties'),
  ('payroll_advances'),
  ('payroll_pila'),
  ('payroll_settings'),
  ('reports_payroll'),
  ('fiscal_operations'),
  ('fiscal_dashboard'),
  ('fiscal_obligations'),
  ('fiscal_declarations'),
  ('fiscal_close'),
  ('fiscal_audit'),
  ('fiscal_rules'),
  ('flows'),
  ('documents')
) AS k("module_key")
WHERE p."code" LIKE 'ia-business%'
  AND p."archived_at" IS NULL
  AND p."is_promotional" = false
  AND p."plan_type" <> 'promotional'
ON CONFLICT ("plan_id", "module_key") DO NOTHING;
