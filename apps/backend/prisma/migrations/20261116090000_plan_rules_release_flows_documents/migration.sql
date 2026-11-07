-- Flows and documents stop being exclusive of IA Business (plan D2, approved by
-- Rafael on 2026-11-07). The `administration` industry grants these modules and
-- plans differ only by AI and its token quota. Without these rows a store on a
-- basic plan no longer sees a plan padlock on Flujos or Documentos.
--
-- DATA IMPACT:
--   Tables affected: plan_module_rules. subscription_plans is only read.
--   Expected row changes: DELETE of 2 rows (flows, documents) for each plan whose
--     code starts with ia-business; 0 rows when already applied. Count beforehand:
--       SELECT count(*) FROM plan_module_rules r
--       JOIN subscription_plans p ON p.id = r.plan_id
--       WHERE p.code LIKE 'ia-business%' AND r.mode = 'exclusive'
--         AND r.module_key IN ('flows', 'documents');
--   Destructive operations: scoped DELETE only (no TRUNCATE, DROP or CASCADE).
--   FK/cascade risk: none. plan_module_rules has no inbound foreign keys.
--   Idempotency: the WHERE matches nothing once applied, and on a database that
--     never had the rows.
--   Approval: D2 in odd/tasks/flujos-administracion-plan.md. Take a production
--     snapshot before deploying (CLAUDE.md §6.3).
--   Reversal: re-insert the rows with mode 'exclusive' for the same plans.

DELETE FROM "plan_module_rules"
WHERE "mode" = 'exclusive'
  AND "module_key" IN ('flows', 'documents')
  AND "plan_id" IN (
    SELECT "id" FROM "subscription_plans" WHERE "code" LIKE 'ia-business%'
  );
