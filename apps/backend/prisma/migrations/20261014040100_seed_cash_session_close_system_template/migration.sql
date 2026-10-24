-- DATA IMPACT:
-- Tables affected: print_templates
-- Expected row changes: +1 fila (INSERT) si no existe ya una plantilla de
--   sistema para format_type='cash_session_close'; 0 filas en cualquier otro
--   caso (re-ejecución). 0 filas modificadas, 0 eliminadas.
-- Destructive operations: none (solo INSERT condicionado por WHERE NOT EXISTS).
-- FK/cascade risk: none. organization_id/created_by quedan NULL, igual que
--   las demás plantillas de sistema.
-- Idempotency: guardado por `WHERE NOT EXISTS` (no hay UNIQUE sobre
--   (is_system, format_type), así que ON CONFLICT no serviría).
-- Approval: plan 2026-10-14-thermal-printable-width (step B1).
--
-- Plantilla de sistema v2 para `cash_session_close` (valor de enum agregado en
-- 20261014040000_add_cash_session_close_print_format). Sin campos margin_*:
-- el kernel de geometría provee los márgenes. La sección `cash_session_report`
-- la registra el compositor en un paso posterior.
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
  'cash_session_close',
  'Cierre de Caja Térmico (80mm)',
  'Reporte de cierre de caja para rollo térmico: resumen, medios de pago, movimientos y diferencia',
  '{"v": 2, "paper": {"copies": 1, "format": "thermal_80", "is_roll": true, "width_mm": 80}, "styles": {"font_family": "Arial, Helvetica, sans-serif", "compact_mode": true, "primary_color": "#000000", "header_alignment": "center", "font_size_base_pt": 8.5}, "columns": [], "sections": [{"id": "sec_header", "type": "header", "order": 1, "title": "Encabezado de la Tienda", "enabled": true}, {"id": "sec_cash_report", "type": "cash_session_report", "order": 2, "title": "Cierre de Caja", "enabled": true}, {"id": "sec_footer", "type": "footer", "order": 3, "title": "Pie del Reporte", "enabled": true}]}'::jsonb,
  true,
  false,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM print_templates
  WHERE is_system = true AND format_type = 'cash_session_close'
);
