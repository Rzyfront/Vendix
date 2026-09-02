-- DATA IMPACT:
-- Tables affected: print_templates
-- Expected row changes: +1 fila (INSERT) si no existe ya una plantilla de
--   sistema para format_type='pos_electronic_invoice'; 0 filas en cualquier
--   otro caso (re-ejecución, o entorno donde ya se sembró manualmente).
-- Destructive operations: none (solo INSERT condicionado por WHERE NOT EXISTS).
-- FK/cascade risk: none. organization_id/created_by quedan NULL, igual que
--   las otras 15 plantillas de sistema.
-- Idempotency: guardado por `WHERE NOT EXISTS`, no por `ON CONFLICT` — la
--   tabla no tiene constraint UNIQUE sobre (is_system, format_type)
--   (`idx_print_templates_system_format` es un btree normal), así que
--   `ON CONFLICT DO NOTHING` no dispararía nada y permitiría duplicados.
-- Approval: solicitado explícitamente por el dueño del repo (Paso 4 del plan
--   de impresión fiscal POS, 2026-09-02).
--
-- `pos_electronic_invoice` entró al enum `print_format_type_enum` en la
-- migración `20260901010000_add_pos_electronic_invoice`, pero nunca tuvo fila
-- de plantilla de sistema en producción: sólo se sembró vía
-- `prisma/seeds/print-templates.seed.ts`, que corre contra dev/local y NUNCA
-- se ejecuta en el pipeline de despliegue de producción (éste sólo corre
-- `migrate deploy`). Resultado verificado contra prod: `SELECT count(*) FROM
-- print_templates WHERE is_system AND format_type = 'pos_electronic_invoice'`
-- devuelve 0, mientras los otros 15 formatos sí tienen su fila. Sin base,
-- `print-gateway.service.ts` (líneas 176-199) no encuentra `baseDefinition` y
-- lanza `PRINT_FORMAT_NOT_FOUND_001` al primer render — el "error al
-- setearlo" que reporta el dueño: el guardado en `store_print_format_configs`
-- sí persiste, pero la LECTURA subsiguiente (para renderizar o para el propio
-- Hub) revienta.
--
-- La `definition` de abajo es v2 (`definition-v2.schema.json`, campo `v: 2`),
-- copiada tal cual de la fila que YA pasó la validación AJV del Hub en local
-- (`print_templates.id = 18` en `vendix_postgres`, verificado por consulta
-- directa) — no la del seed TS, que quedó en formato v1 legado sin el campo
-- `v`. Mismo `name`/`description` que el seed para que ambas fuentes no
-- diverjan en lo que sí comparten.
INSERT INTO print_templates (
  format_type,
  name,
  description,
  definition,
  is_system,
  is_shared,
  organization_id,
  created_by,
  created_at,
  updated_at
)
SELECT
  'pos_electronic_invoice',
  'Tiquete Factura Electrónica POS Térmica (80mm)',
  'Tirilla física para caja POS con CUFE, código QR oficial de la DIAN, resolución e impuestos',
  '{"v": 2, "paper": {"copies": 1, "format": "thermal_80", "is_roll": true, "width_mm": 80, "margin_mm": 0, "auto_print": true}, "styles": {"font_family": "Courier New, Courier, monospace", "compact_mode": true, "primary_color": "#000000", "header_alignment": "center", "font_size_base_pt": 8.5}, "columns": [{"id": "col_desc", "key": "product_name", "align": "left", "label": "Descripción", "format": "text", "enabled": true, "width_percent": 50}, {"id": "col_qty", "key": "quantity", "align": "center", "label": "Cant.", "format": "number", "enabled": true, "width_percent": 15}, {"id": "col_tot", "key": "total_price", "align": "right", "label": "Total", "format": "currency", "enabled": true, "width_percent": 35}], "sections": [{"id": "sec_dian_header", "type": "fiscal_header", "order": 1, "title": "Cabecera Fiscal Emisor y Resolución", "enabled": true}, {"id": "sec_doc_info", "type": "document_info", "order": 2, "title": "Datos de la Venta", "enabled": true}, {"id": "sec_dian_buyer", "type": "fiscal_buyer_info", "order": 3, "title": "Datos del Adquirente", "enabled": true}, {"id": "sec_items", "type": "items_table", "order": 4, "title": "Detalle de Bienes / Servicios", "enabled": true}, {"id": "sec_totals", "type": "totals_summary", "order": 5, "title": "Liquidación Total", "enabled": true}, {"id": "sec_dian_taxes", "type": "fiscal_tax_breakdown", "order": 6, "title": "Discriminación de Impuestos (IVA/INC)", "enabled": true}, {"id": "sec_dian_cufe", "type": "fiscal_cufe_box", "order": 7, "title": "CUFE y Validación DIAN", "enabled": true}, {"id": "sec_dian_qr", "type": "fiscal_qr_section", "order": 8, "title": "Código QR DIAN y Software Proveedor", "enabled": true}, {"id": "sec_footer", "type": "footer", "order": 9, "title": "Pie del Tiquete", "enabled": true}]}'::jsonb,
  true,
  false,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM print_templates
  WHERE is_system = true AND format_type = 'pos_electronic_invoice'
);
