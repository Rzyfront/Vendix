-- =====================================================================
-- Migration: 20260831180000_seed_master_system_print_templates
-- Purpose: Sembrar en base de datos las 15 plantillas maestras del sistema
--          (is_system = true, organization_id = NULL) para el Hub de Formatos
--          de Impresión. Resuelve el error 404 (PRINT_FORMAT_NOT_FOUND_001)
--          en producción cuando una tienda consulta o activa cualquier formato.
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: print_templates
--   Expected row changes: 15 filas sembradas o actualizadas (is_system = true)
--   Destructive operations: none (upsert idempotente sin borrado)
--   FK/cascade risk: none (plantillas globales sin tenant ni author)
--   Idempotency: bloque DO $$ con IF EXISTS UPDATE ELSE INSERT por format_type
--   Approval: solicitado por el usuario para activar el Hub en producción
-- =====================================================================

DO $$
BEGIN

  -- [pos_sale_ticket] Ticket de Venta POS Estándar (80mm)
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'pos_sale_ticket') THEN
    UPDATE "print_templates"
    SET "name" = 'Ticket de Venta POS Estándar (80mm)',
        "description" = 'Plantilla térmica optimizada para recibos de caja en rollos de 80mm',
        "definition" = '{"paper":{"format":"thermal_80","width_mm":80,"is_roll":true,"margin_mm":0,"copies":1},"styles":{"font_family":"''Courier New'', Courier, monospace","font_size_base_pt":9,"primary_color":"#000000","header_alignment":"center","compact_mode":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado","enabled":true,"order":1,"fields":[{"id":"f_logo","key":"store.logo_url","label":"Logo","enabled":true,"position":"center"},{"id":"f_name","key":"store.name","label":"Nombre Comercial","enabled":true,"position":"center"},{"id":"f_legal","key":"store.legal_name","label":"Razón Social","enabled":true,"position":"center"},{"id":"f_nit","key":"store.tax_id","label":"NIT / RUT","enabled":true,"position":"center"},{"id":"f_addr","key":"store.address","label":"Dirección","enabled":true,"position":"center"},{"id":"f_phone","key":"store.phone","label":"Teléfono","enabled":true,"position":"center"}]},{"id":"sec_doc_info","type":"document_info","title":"Datos del Ticket","enabled":true,"order":2,"fields":[{"id":"f_num","key":"order.order_number","label":"Ticket #","enabled":true,"position":"left"},{"id":"f_date","key":"order.created_at","label":"Fecha y Hora","enabled":true,"position":"left"},{"id":"f_cashier","key":"order.cashier_name","label":"Cajero","enabled":true,"position":"left"},{"id":"f_terminal","key":"order.pos_terminal","label":"Caja / Terminal","enabled":true,"position":"right"}]},{"id":"sec_table_info","type":"table_info","title":"Mesa, Mesero y Turno","enabled":true,"order":3},{"id":"sec_customer","type":"customer_info","title":"Datos del Cliente","enabled":true,"order":4,"fields":[{"id":"f_cname","key":"customer.name","label":"Cliente","enabled":true,"position":"left"},{"id":"f_cnit","key":"customer.tax_id","label":"C.C. / NIT","enabled":true,"position":"left"}]},{"id":"sec_items","type":"items_table","title":"Detalle de Productos","enabled":true,"order":5},{"id":"sec_totals","type":"totals_summary","title":"Totales y Pagos","enabled":true,"order":6,"fields":[{"id":"f_sub","key":"order.subtotal_amount","label":"Subtotal","enabled":true,"position":"right"},{"id":"f_disc","key":"order.discount_amount","label":"Descuento","enabled":true,"position":"right"},{"id":"f_tax","key":"order.tax_amount","label":"Impuestos","enabled":true,"position":"right"},{"id":"f_tot","key":"order.grand_total","label":"TOTAL A PAGAR","enabled":true,"position":"right"},{"id":"f_paym","key":"order.payment_method","label":"Método de Pago","enabled":true,"position":"right"},{"id":"f_recv","key":"order.amount_received","label":"Efectivo Recibido","enabled":true,"position":"right"},{"id":"f_chg","key":"order.change_due","label":"Cambio / Vuelto","enabled":true,"position":"right"}]},{"id":"sec_footer","type":"footer","title":"Pie de Ticket","enabled":true,"order":7,"fields":[{"id":"f_msg","key":"receipts.receipt_footer","label":"Mensaje de Despedida","enabled":true,"position":"center"},{"id":"f_powered","key":"system.powered_by","label":"Firma del Sistema","enabled":true,"position":"center"}]}],"columns":[{"id":"col_desc","key":"product_name","label":"Descripción","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_price","key":"unit_price","label":"Precio","enabled":true,"width_percent":15,"align":"right","format":"currency"},{"id":"col_tot","key":"total_price","label":"Total","enabled":true,"width_percent":20,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'pos_sale_ticket';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'pos_sale_ticket',
      'Ticket de Venta POS Estándar (80mm)',
      'Plantilla térmica optimizada para recibos de caja en rollos de 80mm',
      '{"paper":{"format":"thermal_80","width_mm":80,"is_roll":true,"margin_mm":0,"copies":1},"styles":{"font_family":"''Courier New'', Courier, monospace","font_size_base_pt":9,"primary_color":"#000000","header_alignment":"center","compact_mode":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado","enabled":true,"order":1,"fields":[{"id":"f_logo","key":"store.logo_url","label":"Logo","enabled":true,"position":"center"},{"id":"f_name","key":"store.name","label":"Nombre Comercial","enabled":true,"position":"center"},{"id":"f_legal","key":"store.legal_name","label":"Razón Social","enabled":true,"position":"center"},{"id":"f_nit","key":"store.tax_id","label":"NIT / RUT","enabled":true,"position":"center"},{"id":"f_addr","key":"store.address","label":"Dirección","enabled":true,"position":"center"},{"id":"f_phone","key":"store.phone","label":"Teléfono","enabled":true,"position":"center"}]},{"id":"sec_doc_info","type":"document_info","title":"Datos del Ticket","enabled":true,"order":2,"fields":[{"id":"f_num","key":"order.order_number","label":"Ticket #","enabled":true,"position":"left"},{"id":"f_date","key":"order.created_at","label":"Fecha y Hora","enabled":true,"position":"left"},{"id":"f_cashier","key":"order.cashier_name","label":"Cajero","enabled":true,"position":"left"},{"id":"f_terminal","key":"order.pos_terminal","label":"Caja / Terminal","enabled":true,"position":"right"}]},{"id":"sec_table_info","type":"table_info","title":"Mesa, Mesero y Turno","enabled":true,"order":3},{"id":"sec_customer","type":"customer_info","title":"Datos del Cliente","enabled":true,"order":4,"fields":[{"id":"f_cname","key":"customer.name","label":"Cliente","enabled":true,"position":"left"},{"id":"f_cnit","key":"customer.tax_id","label":"C.C. / NIT","enabled":true,"position":"left"}]},{"id":"sec_items","type":"items_table","title":"Detalle de Productos","enabled":true,"order":5},{"id":"sec_totals","type":"totals_summary","title":"Totales y Pagos","enabled":true,"order":6,"fields":[{"id":"f_sub","key":"order.subtotal_amount","label":"Subtotal","enabled":true,"position":"right"},{"id":"f_disc","key":"order.discount_amount","label":"Descuento","enabled":true,"position":"right"},{"id":"f_tax","key":"order.tax_amount","label":"Impuestos","enabled":true,"position":"right"},{"id":"f_tot","key":"order.grand_total","label":"TOTAL A PAGAR","enabled":true,"position":"right"},{"id":"f_paym","key":"order.payment_method","label":"Método de Pago","enabled":true,"position":"right"},{"id":"f_recv","key":"order.amount_received","label":"Efectivo Recibido","enabled":true,"position":"right"},{"id":"f_chg","key":"order.change_due","label":"Cambio / Vuelto","enabled":true,"position":"right"}]},{"id":"sec_footer","type":"footer","title":"Pie de Ticket","enabled":true,"order":7,"fields":[{"id":"f_msg","key":"receipts.receipt_footer","label":"Mensaje de Despedida","enabled":true,"position":"center"},{"id":"f_powered","key":"system.powered_by","label":"Firma del Sistema","enabled":true,"position":"center"}]}],"columns":[{"id":"col_desc","key":"product_name","label":"Descripción","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_price","key":"unit_price","label":"Precio","enabled":true,"width_percent":15,"align":"right","format":"currency"},{"id":"col_tot","key":"total_price","label":"Total","enabled":true,"width_percent":20,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [sales_order_invoice] Factura de Venta / Orden Carta Estándar
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'sales_order_invoice') THEN
    UPDATE "print_templates"
    SET "name" = 'Factura de Venta / Orden Carta Estándar',
        "description" = 'Plantilla formal de orden y factura comercial en formato Carta / A4',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif","font_size_base_pt":10,"primary_color":"#4f46e5","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Cabecera Corporativa","enabled":true,"order":1},{"id":"sec_parties","type":"parties_info","title":"Emisor y Cliente","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Detalle de Ítems","enabled":true,"order":3},{"id":"sec_totals","type":"totals_summary","title":"Liquidación y Totales","enabled":true,"order":4},{"id":"sec_notes","type":"custom_notes","title":"Términos y Notas","enabled":true,"order":5},{"id":"sec_footer","type":"footer","title":"Pie de Página","enabled":true,"order":6}],"columns":[{"id":"col_num","key":"index","label":"#","enabled":true,"width_percent":5,"align":"center","format":"number"},{"id":"col_sku","key":"variant_sku","label":"SKU / Código","enabled":true,"width_percent":15,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Descripción del Producto","enabled":true,"width_percent":40,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":10,"align":"center","format":"number"},{"id":"col_price","key":"unit_price","label":"Precio Unitario","enabled":true,"width_percent":15,"align":"right","format":"currency"},{"id":"col_tot","key":"total_price","label":"Total","enabled":true,"width_percent":15,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'sales_order_invoice';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'sales_order_invoice',
      'Factura de Venta / Orden Carta Estándar',
      'Plantilla formal de orden y factura comercial en formato Carta / A4',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif","font_size_base_pt":10,"primary_color":"#4f46e5","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Cabecera Corporativa","enabled":true,"order":1},{"id":"sec_parties","type":"parties_info","title":"Emisor y Cliente","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Detalle de Ítems","enabled":true,"order":3},{"id":"sec_totals","type":"totals_summary","title":"Liquidación y Totales","enabled":true,"order":4},{"id":"sec_notes","type":"custom_notes","title":"Términos y Notas","enabled":true,"order":5},{"id":"sec_footer","type":"footer","title":"Pie de Página","enabled":true,"order":6}],"columns":[{"id":"col_num","key":"index","label":"#","enabled":true,"width_percent":5,"align":"center","format":"number"},{"id":"col_sku","key":"variant_sku","label":"SKU / Código","enabled":true,"width_percent":15,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Descripción del Producto","enabled":true,"width_percent":40,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":10,"align":"center","format":"number"},{"id":"col_price","key":"unit_price","label":"Precio Unitario","enabled":true,"width_percent":15,"align":"right","format":"currency"},{"id":"col_tot","key":"total_price","label":"Total","enabled":true,"width_percent":15,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [dispatch_note] Remisión y Guía de Despacho A4
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'dispatch_note') THEN
    UPDATE "print_templates"
    SET "name" = 'Remisión y Guía de Despacho A4',
        "description" = 'Documento logístico de entrega con transportadora, firmas y control de bultos',
        "definition" = '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":2,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":9.5,"primary_color":"#0f766e","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Cabecera Logística","enabled":true,"order":1},{"id":"sec_shipping","type":"shipping_info","title":"Datos de Envío y Destino","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Ítems Despachados","enabled":true,"order":3},{"id":"sec_signatures","type":"signatures_box","title":"Firmas de Entrega y Recibido","enabled":true,"order":4}],"columns":[{"id":"col_idx","key":"index","label":"#","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_sku","key":"variant_sku","label":"Código / SKU","enabled":true,"width_percent":22,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Producto / Descripción","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Despachada","enabled":true,"width_percent":20,"align":"center","format":"number"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'dispatch_note';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'dispatch_note',
      'Remisión y Guía de Despacho A4',
      'Documento logístico de entrega con transportadora, firmas y control de bultos',
      '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":2,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":9.5,"primary_color":"#0f766e","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Cabecera Logística","enabled":true,"order":1},{"id":"sec_shipping","type":"shipping_info","title":"Datos de Envío y Destino","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Ítems Despachados","enabled":true,"order":3},{"id":"sec_signatures","type":"signatures_box","title":"Firmas de Entrega y Recibido","enabled":true,"order":4}],"columns":[{"id":"col_idx","key":"index","label":"#","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_sku","key":"variant_sku","label":"Código / SKU","enabled":true,"width_percent":22,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Producto / Descripción","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Despachada","enabled":true,"width_percent":20,"align":"center","format":"number"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [quotation] Cotización Comercial Carta
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'quotation') THEN
    UPDATE "print_templates"
    SET "name" = 'Cotización Comercial Carta',
        "description" = 'Propuesta comercial con vigencia, condiciones de pago y presentación corporativa',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":18,"copies":1,"orientation":"portrait"},"styles":{"font_family":"-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif","font_size_base_pt":10,"primary_color":"#2563eb","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Comercial","enabled":true,"order":1},{"id":"sec_parties","type":"parties_info","title":"Datos de la Empresa y Prospecto","enabled":true,"order":2},{"id":"sec_validity","type":"validity_banner","title":"Vigencia de la Oferta","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Productos / Servicios Cotizados","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Resumen Financiero","enabled":true,"order":5},{"id":"sec_terms","type":"custom_notes","title":"Términos y Condiciones","enabled":true,"order":6}],"columns":[{"id":"col_idx","key":"index","label":"#","enabled":true,"width_percent":5,"align":"center","format":"number"},{"id":"col_desc","key":"product_name","label":"Concepto / Producto","enabled":true,"width_percent":45,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":10,"align":"center","format":"number"},{"id":"col_price","key":"unit_price","label":"Precio Unitario","enabled":true,"width_percent":20,"align":"right","format":"currency"},{"id":"col_tot","key":"total_price","label":"Subtotal","enabled":true,"width_percent":20,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'quotation';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'quotation',
      'Cotización Comercial Carta',
      'Propuesta comercial con vigencia, condiciones de pago y presentación corporativa',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":18,"copies":1,"orientation":"portrait"},"styles":{"font_family":"-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif","font_size_base_pt":10,"primary_color":"#2563eb","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Comercial","enabled":true,"order":1},{"id":"sec_parties","type":"parties_info","title":"Datos de la Empresa y Prospecto","enabled":true,"order":2},{"id":"sec_validity","type":"validity_banner","title":"Vigencia de la Oferta","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Productos / Servicios Cotizados","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Resumen Financiero","enabled":true,"order":5},{"id":"sec_terms","type":"custom_notes","title":"Términos y Condiciones","enabled":true,"order":6}],"columns":[{"id":"col_idx","key":"index","label":"#","enabled":true,"width_percent":5,"align":"center","format":"number"},{"id":"col_desc","key":"product_name","label":"Concepto / Producto","enabled":true,"width_percent":45,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":10,"align":"center","format":"number"},{"id":"col_price","key":"unit_price","label":"Precio Unitario","enabled":true,"width_percent":20,"align":"right","format":"currency"},{"id":"col_tot","key":"total_price","label":"Subtotal","enabled":true,"width_percent":20,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [credit_note] Nota Crédito Comercial A4
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'credit_note') THEN
    UPDATE "print_templates"
    SET "name" = 'Nota Crédito Comercial A4',
        "description" = 'Documento de ajuste contable o devolución sobre órdenes previas',
        "definition" = '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#dc2626","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Nota Crédito","enabled":true,"order":1},{"id":"sec_ref","type":"document_reference","title":"Referencia a Factura/Orden Afectada","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Ítems Afectados / Devueltos","enabled":true,"order":3},{"id":"sec_totals","type":"totals_summary","title":"Monto Total Acreditado","enabled":true,"order":4}],"columns":[{"id":"col_desc","key":"product_name","label":"Concepto / Ítem","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_val","key":"unit_price","label":"Valor Devuelto","enabled":true,"width_percent":35,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'credit_note';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'credit_note',
      'Nota Crédito Comercial A4',
      'Documento de ajuste contable o devolución sobre órdenes previas',
      '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#dc2626","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Nota Crédito","enabled":true,"order":1},{"id":"sec_ref","type":"document_reference","title":"Referencia a Factura/Orden Afectada","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Ítems Afectados / Devueltos","enabled":true,"order":3},{"id":"sec_totals","type":"totals_summary","title":"Monto Total Acreditado","enabled":true,"order":4}],"columns":[{"id":"col_desc","key":"product_name","label":"Concepto / Ítem","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_val","key":"unit_price","label":"Valor Devuelto","enabled":true,"width_percent":35,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [purchase_order] Orden de Compra a Proveedor A4
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'purchase_order') THEN
    UPDATE "print_templates"
    SET "name" = 'Orden de Compra a Proveedor A4',
        "description" = 'Documento formal de aprovisionamiento emitido hacia proveedores',
        "definition" = '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif","font_size_base_pt":9.5,"primary_color":"#1e293b","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Cabecera Orden de Compra","enabled":true,"order":1},{"id":"sec_supplier","type":"parties_info","title":"Datos del Proveedor y Entrega","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Líneas de Compra Solicitadas","enabled":true,"order":3},{"id":"sec_totals","type":"totals_summary","title":"Total Compra Estimado","enabled":true,"order":4}],"columns":[{"id":"col_sku","key":"variant_sku","label":"Código / SKU","enabled":true,"width_percent":20,"align":"left","format":"text"},{"id":"col_name","key":"product_name","label":"Producto / Descripción","enabled":true,"width_percent":45,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Pedida","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_cost","key":"unit_price","label":"Costo Unitario","enabled":true,"width_percent":20,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'purchase_order';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'purchase_order',
      'Orden de Compra a Proveedor A4',
      'Documento formal de aprovisionamiento emitido hacia proveedores',
      '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif","font_size_base_pt":9.5,"primary_color":"#1e293b","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Cabecera Orden de Compra","enabled":true,"order":1},{"id":"sec_supplier","type":"parties_info","title":"Datos del Proveedor y Entrega","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Líneas de Compra Solicitadas","enabled":true,"order":3},{"id":"sec_totals","type":"totals_summary","title":"Total Compra Estimado","enabled":true,"order":4}],"columns":[{"id":"col_sku","key":"variant_sku","label":"Código / SKU","enabled":true,"width_percent":20,"align":"left","format":"text"},{"id":"col_name","key":"product_name","label":"Producto / Descripción","enabled":true,"width_percent":45,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Pedida","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_cost","key":"unit_price","label":"Costo Unitario","enabled":true,"width_percent":20,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [transfer_note] Nota de Traslado de Inventario A4
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'transfer_note') THEN
    UPDATE "print_templates"
    SET "name" = 'Nota de Traslado de Inventario A4',
        "description" = 'Guía de movimiento entre bodegas o tiendas del mismo negocio',
        "definition" = '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":2,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":9.5,"primary_color":"#d97706","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado de Traslado","enabled":true,"order":1},{"id":"sec_locs","type":"locations_info","title":"Origen y Destino","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Ítems Transferidos","enabled":true,"order":3},{"id":"sec_signatures","type":"signatures_box","title":"Firmas de Despacho y Recepción","enabled":true,"order":4}],"columns":[{"id":"col_sku","key":"variant_sku","label":"SKU","enabled":true,"width_percent":20,"align":"left","format":"text"},{"id":"col_name","key":"product_name","label":"Producto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Movida","enabled":true,"width_percent":20,"align":"center","format":"number"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'transfer_note';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'transfer_note',
      'Nota de Traslado de Inventario A4',
      'Guía de movimiento entre bodegas o tiendas del mismo negocio',
      '{"paper":{"format":"a4","width_mm":210,"is_roll":false,"margin_mm":15,"copies":2,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":9.5,"primary_color":"#d97706","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado de Traslado","enabled":true,"order":1},{"id":"sec_locs","type":"locations_info","title":"Origen y Destino","enabled":true,"order":2},{"id":"sec_items","type":"items_table","title":"Ítems Transferidos","enabled":true,"order":3},{"id":"sec_signatures","type":"signatures_box","title":"Firmas de Despacho y Recepción","enabled":true,"order":4}],"columns":[{"id":"col_sku","key":"variant_sku","label":"SKU","enabled":true,"width_percent":20,"align":"left","format":"text"},{"id":"col_name","key":"product_name","label":"Producto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Movida","enabled":true,"width_percent":20,"align":"center","format":"number"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [fiscal_electronic_invoice] Factura Electrónica DIAN Carta Oficial
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'fiscal_electronic_invoice') THEN
    UPDATE "print_templates"
    SET "name" = 'Factura Electrónica DIAN Carta Oficial',
        "description" = 'Representación gráfica oficial con CUFE, código QR y resolución DIAN (Anexo 1.9)',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":12,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Segoe UI'', Arial, sans-serif","font_size_base_pt":9,"primary_color":"#1e3a8a","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_dian_header","type":"fiscal_header","title":"Cabecera Fiscal Emisor y Resolución","enabled":true,"order":1},{"id":"sec_dian_cufe","type":"fiscal_cufe_box","title":"CUFE y Validación DIAN","enabled":true,"order":2},{"id":"sec_dian_buyer","type":"fiscal_buyer_info","title":"Datos del Adquirente","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Detalle de Bienes / Servicios","enabled":true,"order":4},{"id":"sec_dian_taxes","type":"fiscal_tax_breakdown","title":"Discriminación de Impuestos (IVA/INC)","enabled":true,"order":5},{"id":"sec_totals","type":"totals_summary","title":"Liquidación Total","enabled":true,"order":6},{"id":"sec_dian_qr","type":"fiscal_qr_section","title":"Código QR DIAN y Software Proveedor","enabled":true,"order":7}],"columns":[{"id":"col_sku","key":"variant_sku","label":"Código","enabled":true,"width_percent":12,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Descripción / Servicio","enabled":true,"width_percent":38,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_unit","key":"unit_price","label":"Valor Unit.","enabled":true,"width_percent":14,"align":"right","format":"currency"},{"id":"col_tax_rate","key":"tax_rate","label":"% IVA","enabled":true,"width_percent":10,"align":"center","format":"percent"},{"id":"col_tot","key":"total_price","label":"Total Línea","enabled":true,"width_percent":18,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'fiscal_electronic_invoice';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'fiscal_electronic_invoice',
      'Factura Electrónica DIAN Carta Oficial',
      'Representación gráfica oficial con CUFE, código QR y resolución DIAN (Anexo 1.9)',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":12,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Segoe UI'', Arial, sans-serif","font_size_base_pt":9,"primary_color":"#1e3a8a","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_dian_header","type":"fiscal_header","title":"Cabecera Fiscal Emisor y Resolución","enabled":true,"order":1},{"id":"sec_dian_cufe","type":"fiscal_cufe_box","title":"CUFE y Validación DIAN","enabled":true,"order":2},{"id":"sec_dian_buyer","type":"fiscal_buyer_info","title":"Datos del Adquirente","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Detalle de Bienes / Servicios","enabled":true,"order":4},{"id":"sec_dian_taxes","type":"fiscal_tax_breakdown","title":"Discriminación de Impuestos (IVA/INC)","enabled":true,"order":5},{"id":"sec_totals","type":"totals_summary","title":"Liquidación Total","enabled":true,"order":6},{"id":"sec_dian_qr","type":"fiscal_qr_section","title":"Código QR DIAN y Software Proveedor","enabled":true,"order":7}],"columns":[{"id":"col_sku","key":"variant_sku","label":"Código","enabled":true,"width_percent":12,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Descripción / Servicio","enabled":true,"width_percent":38,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_unit","key":"unit_price","label":"Valor Unit.","enabled":true,"width_percent":14,"align":"right","format":"currency"},{"id":"col_tax_rate","key":"tax_rate","label":"% IVA","enabled":true,"width_percent":10,"align":"center","format":"percent"},{"id":"col_tot","key":"total_price","label":"Total Línea","enabled":true,"width_percent":18,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [fiscal_credit_note] Nota Crédito Electrónica DIAN Carta Oficial
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'fiscal_credit_note') THEN
    UPDATE "print_templates"
    SET "name" = 'Nota Crédito Electrónica DIAN Carta Oficial',
        "description" = 'Representación gráfica oficial de nota crédito electrónica con CUDE y QR DIAN',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":12,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Segoe UI'', Arial, sans-serif","font_size_base_pt":9,"primary_color":"#991b1b","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_dian_header","type":"fiscal_header","title":"Cabecera Fiscal Emisor","enabled":true,"order":1},{"id":"sec_dian_cude","type":"fiscal_cufe_box","title":"CUDE y Factura Afectada","enabled":true,"order":2},{"id":"sec_dian_buyer","type":"fiscal_buyer_info","title":"Datos del Adquirente","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Líneas Afectadas","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Totales Ajustados","enabled":true,"order":5},{"id":"sec_dian_qr","type":"fiscal_qr_section","title":"Código QR DIAN","enabled":true,"order":6}],"columns":[{"id":"col_desc","key":"product_name","label":"Concepto / Ítem","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_val","key":"total_price","label":"Total Afectado","enabled":true,"width_percent":35,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'fiscal_credit_note';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'fiscal_credit_note',
      'Nota Crédito Electrónica DIAN Carta Oficial',
      'Representación gráfica oficial de nota crédito electrónica con CUDE y QR DIAN',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":12,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Segoe UI'', Arial, sans-serif","font_size_base_pt":9,"primary_color":"#991b1b","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_dian_header","type":"fiscal_header","title":"Cabecera Fiscal Emisor","enabled":true,"order":1},{"id":"sec_dian_cude","type":"fiscal_cufe_box","title":"CUDE y Factura Afectada","enabled":true,"order":2},{"id":"sec_dian_buyer","type":"fiscal_buyer_info","title":"Datos del Adquirente","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Líneas Afectadas","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Totales Ajustados","enabled":true,"order":5},{"id":"sec_dian_qr","type":"fiscal_qr_section","title":"Código QR DIAN","enabled":true,"order":6}],"columns":[{"id":"col_desc","key":"product_name","label":"Concepto / Ítem","enabled":true,"width_percent":50,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_val","key":"total_price","label":"Total Afectado","enabled":true,"width_percent":35,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [kitchen_ticket] Comanda de Cocina Térmica (80mm KDS)
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'kitchen_ticket') THEN
    UPDATE "print_templates"
    SET "name" = 'Comanda de Cocina Térmica (80mm KDS)',
        "description" = 'Ticket para cocina/bar con modificadores, notas de preparación y mesa',
        "definition" = '{"paper":{"format":"thermal_80","width_mm":80,"is_roll":true,"margin_mm":0,"copies":1},"styles":{"font_family":"''Courier New'', Courier, monospace","font_size_base_pt":11,"primary_color":"#000000","header_alignment":"center","compact_mode":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Comanda","enabled":true,"order":1},{"id":"sec_table_info","type":"table_info","title":"Mesa, Mesero y Turno","enabled":true,"order":2},{"id":"sec_items","type":"kitchen_items","title":"Platos y Modificadores","enabled":true,"order":3},{"id":"sec_notes","type":"custom_notes","title":"Observaciones de Cocina","enabled":true,"order":4}],"columns":[{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":25,"align":"center","format":"number"},{"id":"col_desc","key":"product_name","label":"Plato / Preparación","enabled":true,"width_percent":75,"align":"left","format":"text"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'kitchen_ticket';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'kitchen_ticket',
      'Comanda de Cocina Térmica (80mm KDS)',
      'Ticket para cocina/bar con modificadores, notas de preparación y mesa',
      '{"paper":{"format":"thermal_80","width_mm":80,"is_roll":true,"margin_mm":0,"copies":1},"styles":{"font_family":"''Courier New'', Courier, monospace","font_size_base_pt":11,"primary_color":"#000000","header_alignment":"center","compact_mode":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Comanda","enabled":true,"order":1},{"id":"sec_table_info","type":"table_info","title":"Mesa, Mesero y Turno","enabled":true,"order":2},{"id":"sec_items","type":"kitchen_items","title":"Platos y Modificadores","enabled":true,"order":3},{"id":"sec_notes","type":"custom_notes","title":"Observaciones de Cocina","enabled":true,"order":4}],"columns":[{"id":"col_qty","key":"quantity","label":"Cant.","enabled":true,"width_percent":25,"align":"center","format":"number"},{"id":"col_desc","key":"product_name","label":"Plato / Preparación","enabled":true,"width_percent":75,"align":"left","format":"text"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [dispatch_ticket] Tiquete de Despacho Térmico (80mm)
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'dispatch_ticket') THEN
    UPDATE "print_templates"
    SET "name" = 'Tiquete de Despacho Térmico (80mm)',
        "description" = 'Ticket logístico con cliente, dirección y cantidades pedida/despachada por línea; rollo 80mm courier mono',
        "definition" = '{"paper":{"format":"thermal_80","width_mm":80,"is_roll":true,"margin_mm":0,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Courier New'', Courier, monospace","font_size_base_pt":9,"primary_color":"#000000","header_alignment":"center","show_borders":true,"compact_mode":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Despacho","enabled":true,"order":1},{"id":"sec_doc_info","type":"document_info","title":"Datos de la Orden","enabled":true,"order":2},{"id":"sec_customer","type":"customer_info","title":"Cliente y Dirección de Entrega","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Productos a Despachar","enabled":true,"order":4},{"id":"sec_footer","type":"footer","title":"Despachado por","enabled":true,"order":5}],"columns":[{"id":"col_idx","key":"index","label":"#","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_sku","key":"variant_sku","label":"SKU / Código","enabled":true,"width_percent":30,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Descripción","enabled":true,"width_percent":32,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Pedida","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_disp","key":"dispatched_qty","label":"Cant. Despachada","enabled":true,"width_percent":15,"align":"center","format":"number"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'dispatch_ticket';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'dispatch_ticket',
      'Tiquete de Despacho Térmico (80mm)',
      'Ticket logístico con cliente, dirección y cantidades pedida/despachada por línea; rollo 80mm courier mono',
      '{"paper":{"format":"thermal_80","width_mm":80,"is_roll":true,"margin_mm":0,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Courier New'', Courier, monospace","font_size_base_pt":9,"primary_color":"#000000","header_alignment":"center","show_borders":true,"compact_mode":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Despacho","enabled":true,"order":1},{"id":"sec_doc_info","type":"document_info","title":"Datos de la Orden","enabled":true,"order":2},{"id":"sec_customer","type":"customer_info","title":"Cliente y Dirección de Entrega","enabled":true,"order":3},{"id":"sec_items","type":"items_table","title":"Productos a Despachar","enabled":true,"order":4},{"id":"sec_footer","type":"footer","title":"Despachado por","enabled":true,"order":5}],"columns":[{"id":"col_idx","key":"index","label":"#","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_sku","key":"variant_sku","label":"SKU / Código","enabled":true,"width_percent":30,"align":"left","format":"text"},{"id":"col_desc","key":"product_name","label":"Descripción","enabled":true,"width_percent":32,"align":"left","format":"text"},{"id":"col_qty","key":"quantity","label":"Cant. Pedida","enabled":true,"width_percent":15,"align":"center","format":"number"},{"id":"col_disp","key":"dispatched_qty","label":"Cant. Despachada","enabled":true,"width_percent":15,"align":"center","format":"number"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [dispatch_route] Planilla de Ruta DSD Carta
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'dispatch_route') THEN
    UPDATE "print_templates"
    SET "name" = 'Planilla de Ruta DSD Carta',
        "description" = 'Documento operativo de ruta de despacho DSD con vehículo, conductor, transportista y secuencia de paradas',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#0f766e","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Planilla","enabled":true,"order":1},{"id":"sec_route_meta","type":"document_info","title":"Datos de la Ruta","enabled":true,"order":2},{"id":"sec_vehicle","type":"custom_notes","title":"Vehículo y Conductor","enabled":true,"order":3},{"id":"sec_stops","type":"items_table","title":"Paradas","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Recaudo Total","enabled":true,"order":5},{"id":"sec_signatures","type":"signatures_box","title":"Firmas","enabled":true,"order":6}],"columns":[{"id":"col_seq","key":"sequence","label":"#","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_dnum","key":"dispatch_number","label":"Remisión","enabled":true,"width_percent":22,"align":"left","format":"text"},{"id":"col_cust","key":"customer","label":"Cliente","enabled":true,"width_percent":30,"align":"left","format":"text"},{"id":"col_addr","key":"address","label":"Dirección","enabled":true,"width_percent":30,"align":"left","format":"text"},{"id":"col_status","key":"status","label":"Estado","enabled":true,"width_percent":10,"align":"center","format":"text"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'dispatch_route';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'dispatch_route',
      'Planilla de Ruta DSD Carta',
      'Documento operativo de ruta de despacho DSD con vehículo, conductor, transportista y secuencia de paradas',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#0f766e","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Planilla","enabled":true,"order":1},{"id":"sec_route_meta","type":"document_info","title":"Datos de la Ruta","enabled":true,"order":2},{"id":"sec_vehicle","type":"custom_notes","title":"Vehículo y Conductor","enabled":true,"order":3},{"id":"sec_stops","type":"items_table","title":"Paradas","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Recaudo Total","enabled":true,"order":5},{"id":"sec_signatures","type":"signatures_box","title":"Firmas","enabled":true,"order":6}],"columns":[{"id":"col_seq","key":"sequence","label":"#","enabled":true,"width_percent":8,"align":"center","format":"number"},{"id":"col_dnum","key":"dispatch_number","label":"Remisión","enabled":true,"width_percent":22,"align":"left","format":"text"},{"id":"col_cust","key":"customer","label":"Cliente","enabled":true,"width_percent":30,"align":"left","format":"text"},{"id":"col_addr","key":"address","label":"Dirección","enabled":true,"width_percent":30,"align":"left","format":"text"},{"id":"col_status","key":"status","label":"Estado","enabled":true,"width_percent":10,"align":"center","format":"text"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [withholding_practiced] Certificado de Retención Practicada Carta
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'withholding_practiced') THEN
    UPDATE "print_templates"
    SET "name" = 'Certificado de Retención Practicada Carta',
        "description" = 'Comprobante de retención en la fuente que la empresa practica a un tercero',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#1e3a8a","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Certificado","enabled":true,"order":1},{"id":"sec_counterparty","type":"parties_info","title":"Tercero Retenido","enabled":true,"order":2},{"id":"sec_concept","type":"custom_notes","title":"Concepto y Base","enabled":true,"order":3},{"id":"sec_tax","type":"fiscal_tax_breakdown","title":"Detalle de Retención","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Valor Retenido","enabled":true,"order":5}],"columns":[{"id":"col_concept","key":"name","label":"Concepto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_rate","key":"rate","label":"Tarifa %","enabled":true,"width_percent":15,"align":"center","format":"percent"},{"id":"col_base","key":"base_amount","label":"Base","enabled":true,"width_percent":25,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'withholding_practiced';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'withholding_practiced',
      'Certificado de Retención Practicada Carta',
      'Comprobante de retención en la fuente que la empresa practica a un tercero',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#1e3a8a","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Certificado","enabled":true,"order":1},{"id":"sec_counterparty","type":"parties_info","title":"Tercero Retenido","enabled":true,"order":2},{"id":"sec_concept","type":"custom_notes","title":"Concepto y Base","enabled":true,"order":3},{"id":"sec_tax","type":"fiscal_tax_breakdown","title":"Detalle de Retención","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Valor Retenido","enabled":true,"order":5}],"columns":[{"id":"col_concept","key":"name","label":"Concepto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_rate","key":"rate","label":"Tarifa %","enabled":true,"width_percent":15,"align":"center","format":"percent"},{"id":"col_base","key":"base_amount","label":"Base","enabled":true,"width_percent":25,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [withholding_suffered] Certificado de Retención Sufrida Carta
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'withholding_suffered') THEN
    UPDATE "print_templates"
    SET "name" = 'Certificado de Retención Sufrida Carta',
        "description" = 'Comprobante de retención en la fuente que un tercero practicó a la empresa',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#7c2d12","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Certificado","enabled":true,"order":1},{"id":"sec_counterparty","type":"parties_info","title":"Tercero que Retuvo","enabled":true,"order":2},{"id":"sec_concept","type":"custom_notes","title":"Concepto y Base","enabled":true,"order":3},{"id":"sec_tax","type":"fiscal_tax_breakdown","title":"Detalle de Retención","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Valor Sufrido","enabled":true,"order":5}],"columns":[{"id":"col_concept","key":"name","label":"Concepto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_rate","key":"rate","label":"Tarifa %","enabled":true,"width_percent":15,"align":"center","format":"percent"},{"id":"col_base","key":"base_amount","label":"Base","enabled":true,"width_percent":25,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'withholding_suffered';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'withholding_suffered',
      'Certificado de Retención Sufrida Carta',
      'Comprobante de retención en la fuente que un tercero practicó a la empresa',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#7c2d12","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Certificado","enabled":true,"order":1},{"id":"sec_counterparty","type":"parties_info","title":"Tercero que Retuvo","enabled":true,"order":2},{"id":"sec_concept","type":"custom_notes","title":"Concepto y Base","enabled":true,"order":3},{"id":"sec_tax","type":"fiscal_tax_breakdown","title":"Detalle de Retención","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Valor Sufrido","enabled":true,"order":5}],"columns":[{"id":"col_concept","key":"name","label":"Concepto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_rate","key":"rate","label":"Tarifa %","enabled":true,"width_percent":15,"align":"center","format":"percent"},{"id":"col_base","key":"base_amount","label":"Base","enabled":true,"width_percent":25,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

  -- [withholding_employee_certificate] Certificado Laboral de Retención al Empleado
  IF EXISTS (SELECT 1 FROM "print_templates" WHERE "is_system" = true AND "format_type" = 'withholding_employee_certificate') THEN
    UPDATE "print_templates"
    SET "name" = 'Certificado Laboral de Retención al Empleado',
        "description" = 'Comprobante anual de retención en la fuente sobre ingresos laborales',
        "definition" = '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#365314","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Certificado Laboral","enabled":true,"order":1},{"id":"sec_employee","type":"parties_info","title":"Datos del Empleado","enabled":true,"order":2},{"id":"sec_period","type":"custom_notes","title":"Periodo Gravable","enabled":true,"order":3},{"id":"sec_tax","type":"fiscal_tax_breakdown","title":"Detalle de Retención","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Total Retenido al Empleado","enabled":true,"order":5}],"columns":[{"id":"col_concept","key":"name","label":"Concepto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_rate","key":"rate","label":"Tarifa %","enabled":true,"width_percent":15,"align":"center","format":"percent"},{"id":"col_base","key":"base_amount","label":"Base","enabled":true,"width_percent":25,"align":"right","format":"currency"}]}'::jsonb,
        "is_shared" = false,
        "updated_at" = NOW()
    WHERE "is_system" = true AND "format_type" = 'withholding_employee_certificate';
  ELSE
    INSERT INTO "print_templates" (
      "format_type",
      "name",
      "description",
      "definition",
      "is_system",
      "is_shared",
      "organization_id",
      "created_by",
      "created_at",
      "updated_at"
    ) VALUES (
      'withholding_employee_certificate',
      'Certificado Laboral de Retención al Empleado',
      'Comprobante anual de retención en la fuente sobre ingresos laborales',
      '{"paper":{"format":"letter","width_mm":216,"is_roll":false,"margin_mm":15,"copies":1,"orientation":"portrait"},"styles":{"font_family":"''Helvetica Neue'', Arial, sans-serif","font_size_base_pt":10,"primary_color":"#365314","header_alignment":"left","show_borders":true},"sections":[{"id":"sec_header","type":"header","title":"Encabezado Certificado Laboral","enabled":true,"order":1},{"id":"sec_employee","type":"parties_info","title":"Datos del Empleado","enabled":true,"order":2},{"id":"sec_period","type":"custom_notes","title":"Periodo Gravable","enabled":true,"order":3},{"id":"sec_tax","type":"fiscal_tax_breakdown","title":"Detalle de Retención","enabled":true,"order":4},{"id":"sec_totals","type":"totals_summary","title":"Total Retenido al Empleado","enabled":true,"order":5}],"columns":[{"id":"col_concept","key":"name","label":"Concepto","enabled":true,"width_percent":60,"align":"left","format":"text"},{"id":"col_rate","key":"rate","label":"Tarifa %","enabled":true,"width_percent":15,"align":"center","format":"percent"},{"id":"col_base","key":"base_amount","label":"Base","enabled":true,"width_percent":25,"align":"right","format":"currency"}]}'::jsonb,
      true,
      false,
      NULL,
      NULL,
      NOW(),
      NOW()
    );
  END IF;

END $$;
