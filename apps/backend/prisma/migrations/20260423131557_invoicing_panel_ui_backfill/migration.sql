-- DATA IMPACT:
-- tabla: user_settings
-- operacion: añadir 3 keys a config.panel_ui.STORE_ADMIN para usuarios cuyo panel_ui ya tiene STORE_ADMIN
-- filas afectadas: todos los user_settings con panel_ui.STORE_ADMIN (solo los que NO tengan cada key)
-- idempotente: SI (WHERE NOT ? key)

BEGIN;

UPDATE user_settings
SET config = jsonb_set(config, '{panel_ui,STORE_ADMIN,invoicing_invoices}', 'true'::jsonb)
WHERE config->'panel_ui' ? 'STORE_ADMIN'
  AND NOT (config->'panel_ui'->'STORE_ADMIN' ? 'invoicing_invoices');

UPDATE user_settings
SET config = jsonb_set(config, '{panel_ui,STORE_ADMIN,invoicing_resolutions}', 'true'::jsonb)
WHERE config->'panel_ui' ? 'STORE_ADMIN'
  AND NOT (config->'panel_ui'->'STORE_ADMIN' ? 'invoicing_resolutions');

UPDATE user_settings
SET config = jsonb_set(config, '{panel_ui,STORE_ADMIN,invoicing_dian_config}', 'true'::jsonb)
WHERE config->'panel_ui' ? 'STORE_ADMIN'
  AND NOT (config->'panel_ui'->'STORE_ADMIN' ? 'invoicing_dian_config');

-- Mismo backfill sobre default_templates (template_data.panel_ui.STORE_ADMIN)
-- para templates ya seedeados que no se re-ejecuten con el seed
UPDATE default_templates
SET template_data = jsonb_set(template_data, '{panel_ui,STORE_ADMIN,invoicing_invoices}', 'true'::jsonb)
WHERE template_data->'panel_ui' ? 'STORE_ADMIN'
  AND NOT (template_data->'panel_ui'->'STORE_ADMIN' ? 'invoicing_invoices');

UPDATE default_templates
SET template_data = jsonb_set(template_data, '{panel_ui,STORE_ADMIN,invoicing_resolutions}', 'true'::jsonb)
WHERE template_data->'panel_ui' ? 'STORE_ADMIN'
  AND NOT (template_data->'panel_ui'->'STORE_ADMIN' ? 'invoicing_resolutions');

UPDATE default_templates
SET template_data = jsonb_set(template_data, '{panel_ui,STORE_ADMIN,invoicing_dian_config}', 'true'::jsonb)
WHERE template_data->'panel_ui' ? 'STORE_ADMIN'
  AND NOT (template_data->'panel_ui'->'STORE_ADMIN' ? 'invoicing_dian_config');

COMMIT;
