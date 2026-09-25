-- ============================================================================
-- Ticket POS unificado con FE POS (paridad de formato + leyenda no fiscal)
-- ============================================================================
-- La tirilla `pos_sale_ticket` divergió de la FE POS: 9pt vs 8.5pt, 4 columnas
-- (con precio unitario) vs 3, y sin leyenda de "no es factura electrónica".
-- Esta migración actualiza la ÚNICA fila de sistema con la definición v2 ya
-- validada contra `definition-v2.schema.json` (AJV, script /tmp/ticket-def-build.js):
--   1. styles.font_size_base_pt: 9 -> 8.5
--   2. columns: se elimina col_price; col_tot width 20 -> 35 (suma 100)
--   3. footer.fields: se agrega f_disclaimer (document.non_fiscal_disclaimer)
-- El resto de la definición se preserva byte por byte desde la fila viva
-- (incluye ajustes de Hub como sec_table_info que el seed TS no tiene).
-- Las personalizaciones de merchants (store_print_format_configs) no se tocan:
-- esto solo mueve la base del sistema.
--
-- DATA IMPACT:
--   Tabla:  print_templates (1 fila: is_system=true AND format_type='pos_sale_ticket')
--   Columnas: definition, updated_at
--   Idempotente: re-correr fija el mismo valor (UPDATE determinista)
--   Sin CASCADE / DROP / DELETE; sin PII; dry-run aplicado en local + verificado
--   Aprobación explícita: plan PLAN-POS-TICKET-FE-PARITY.md ("ejecuta" 2026-09-24)
-- ============================================================================

UPDATE print_templates
SET
  definition = '{"paper":{"copies":1,"format":"thermal_80","is_roll":true,"width_mm":80,"margin_mm":1.5},"styles":{"font_family":"Arial, Helvetica, sans-serif","compact_mode":true,"primary_color":"#000000","header_alignment":"center","font_size_base_pt":8.5},"columns":[{"id":"col_desc","key":"product_name","align":"left","label":"Descripción","format":"text","enabled":true,"width_percent":50},{"id":"col_qty","key":"quantity","align":"center","label":"Cant.","format":"number","enabled":true,"width_percent":15},{"id":"col_tot","key":"total_price","align":"right","label":"Total","format":"currency","enabled":true,"width_percent":35}],"sections":[{"id":"sec_header","type":"header","order":1,"title":"Encabezado","fields":[{"id":"f_logo","key":"store.logo_url","label":"Logo","enabled":true,"position":"center"},{"id":"f_name","key":"store.name","label":"Nombre Comercial","enabled":true,"position":"center"},{"id":"f_legal","key":"store.legal_name","label":"Razón Social","enabled":true,"position":"center"},{"id":"f_nit","key":"store.tax_id","label":"NIT / RUT","enabled":true,"position":"center"},{"id":"f_addr","key":"store.address","label":"Dirección","enabled":true,"position":"center"},{"id":"f_phone","key":"store.phone","label":"Teléfono","enabled":true,"position":"center"}],"enabled":true},{"id":"sec_doc_info","type":"document_info","order":2,"title":"Datos del Ticket","fields":[{"id":"f_num","key":"order.order_number","label":"Ticket #","enabled":true,"position":"left"},{"id":"f_date","key":"order.created_at","label":"Fecha y Hora","enabled":true,"position":"left"},{"id":"f_cashier","key":"order.cashier_name","label":"Cajero","enabled":true,"position":"left"},{"id":"f_terminal","key":"order.pos_terminal","label":"Caja / Terminal","enabled":true,"position":"right"}],"enabled":true},{"id":"sec_table_info","type":"table_info","order":3,"title":"Mesa, Mesero y Turno","enabled":true},{"id":"sec_customer","type":"customer_info","order":4,"title":"Datos del Cliente","fields":[{"id":"f_cname","key":"customer.name","label":"Cliente","enabled":true,"position":"left"},{"id":"f_cnit","key":"customer.tax_id","label":"C.C. / NIT","enabled":true,"position":"left"}],"enabled":true},{"id":"sec_items","type":"items_table","order":5,"title":"Detalle de Productos","enabled":true},{"id":"sec_totals","type":"totals_summary","order":6,"title":"Totales y Pagos","fields":[{"id":"f_sub","key":"order.subtotal_amount","label":"Subtotal","enabled":true,"position":"right"},{"id":"f_disc","key":"order.discount_amount","label":"Descuento","enabled":true,"position":"right"},{"id":"f_tax","key":"order.tax_amount","label":"Impuestos","enabled":true,"position":"right"},{"id":"f_tot","key":"order.grand_total","label":"TOTAL A PAGAR","enabled":true,"position":"right"},{"id":"f_paym","key":"order.payment_method","label":"Método de Pago","enabled":true,"position":"right"},{"id":"f_recv","key":"order.amount_received","label":"Efectivo Recibido","enabled":true,"position":"right"},{"id":"f_chg","key":"order.change_due","label":"Cambio / Vuelto","enabled":true,"position":"right"}],"enabled":true},{"id":"sec_footer","type":"footer","order":7,"title":"Pie de Ticket","fields":[{"id":"f_msg","key":"receipts.receipt_footer","label":"Mensaje de Despedida","enabled":true,"position":"center"},{"id":"f_disclaimer","key":"document.non_fiscal_disclaimer","label":"Leyenda No Fiscal","enabled":true,"position":"center"},{"id":"f_powered","key":"system.powered_by","label":"Firma del Sistema","enabled":true,"position":"center"}],"enabled":true}],"v":2}',
  updated_at = CURRENT_TIMESTAMP
WHERE is_system IS TRUE
  AND format_type = 'pos_sale_ticket';
