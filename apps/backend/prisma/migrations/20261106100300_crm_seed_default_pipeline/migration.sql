-- CRM · M5 (PLAN-CRM §3): pipeline de ventas por defecto para las tiendas
-- existentes. Las tiendas nuevas lo reciben en StoreBootstrapHelper
-- (`DEFAULT_CRM_PIPELINE`, mismos nombres y orden que aquí).
--
-- DATA IMPACT:
--   Tables affected: crm_pipelines (INSERT, 1 fila por tienda sin pipeline) y
--   crm_pipeline_stages (INSERT, 5 filas por pipeline sembrada).
--   Expected row changes: tiendas actuales x 1 en crm_pipelines y tiendas x 5
--   en crm_pipeline_stages. Ambas tablas son nuevas (M3) y están vacías.
--   Destructive operations: ninguna. Solo INSERT en tablas nuevas; sin UPDATE,
--   DELETE, DROP ni TRUNCATE. No toca stores ni ninguna tabla existente.
--   FK/cascade risk: ninguno. Las filas nuevas apuntan a stores (RESTRICT).
--   Idempotency: NOT EXISTS por tienda (cualquier pipeline la excluye) y por
--   pipeline (cualquier etapa la excluye), más ON CONFLICT DO NOTHING sobre
--   (store_id, name) y (pipeline_id, name). Reejecutar no inserta nada.
--   Rollback: migración de reversa explícita y aprobada, borrando solo las
--   etapas/pipelines 'Ventas' sin oportunidades ni clientes asignados.
--   Approval: PLAN-CRM PR 2, decisiones de Rafael (2026-10-31).

INSERT INTO "crm_pipelines" ("store_id", "name", "is_default", "created_at", "updated_at")
SELECT s."id", 'Ventas', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "stores" s
WHERE NOT EXISTS (
  SELECT 1 FROM "crm_pipelines" p WHERE p."store_id" = s."id"
)
ON CONFLICT DO NOTHING;

INSERT INTO "crm_pipeline_stages" ("store_id", "pipeline_id", "name", "sort_order", "kind")
SELECT p."store_id", p."id", v."name", v."sort_order", v."kind"
FROM "crm_pipelines" p
CROSS JOIN (
  VALUES
    ('Nuevo', 0, 'open'),
    ('Contactado', 1, 'open'),
    ('Cotizado', 2, 'open'),
    ('Ganado', 3, 'won'),
    ('Perdido', 4, 'lost')
) AS v("name", "sort_order", "kind")
WHERE p."name" = 'Ventas'
  AND p."is_default" = true
  AND NOT EXISTS (
    SELECT 1 FROM "crm_pipeline_stages" st WHERE st."pipeline_id" = p."id"
  )
ON CONFLICT DO NOTHING;
