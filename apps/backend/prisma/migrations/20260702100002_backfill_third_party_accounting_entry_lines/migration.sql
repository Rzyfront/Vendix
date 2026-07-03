-- =====================================================
-- M2: backfill_third_party_accounting_entry_lines
-- =====================================================
-- DATA IMPACT: ~482 líneas en dev. Por source_type derivable (order, payment,
--              kitchen.fired, purchase_order.received, etc.). NÓMINA EXCLUIDA
--              (forward-fill: las nuevas líneas sí viajan en el payload del evento).
-- Idempotente: WHERE third_party_type IS NULL.
-- Notas de esquema:
--   - orders.customer_id → users.id (no existe tabla customers)
--   - users tiene first_name/last_name/document_number (cédula/NIT)
--   - suppliers existe como tabla propia con tax_id
-- =====================================================

-- ORDER: order_items -> orders -> users (customer)
UPDATE accounting_entry_lines l
SET third_party_id     = o.customer_id,
    third_party_type   = 'customer',
    third_party_name   = TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')),
    third_party_tax_id = u.document_number
FROM accounting_entries e
JOIN orders o ON o.id = e.source_id
LEFT JOIN users u ON u.id = o.customer_id
WHERE l.entry_id = e.id
  AND e.source_type = 'order'
  AND l.third_party_type IS NULL
  AND o.customer_id IS NOT NULL;

-- ORDER.COMPLETED: mismo set, distinto source_type
UPDATE accounting_entry_lines l
SET third_party_id     = o.customer_id,
    third_party_type   = 'customer',
    third_party_name   = TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')),
    third_party_tax_id = u.document_number
FROM accounting_entries e
JOIN orders o ON o.id = e.source_id
LEFT JOIN users u ON u.id = o.customer_id
WHERE l.entry_id = e.id
  AND e.source_type = 'order.completed'
  AND l.third_party_type IS NULL
  AND o.customer_id IS NOT NULL;

-- PAYMENT.RECEIVED: payments -> users (customer) | orders -> users (fallback)
UPDATE accounting_entry_lines l
SET third_party_id     = COALESCE(p.customer_id, o.customer_id),
    third_party_type   = 'customer',
    third_party_name   = TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')),
    third_party_tax_id = u.document_number
FROM accounting_entries e
JOIN payments p ON p.id = e.source_id
LEFT JOIN orders o ON o.id = p.order_id
LEFT JOIN users u ON u.id = COALESCE(p.customer_id, o.customer_id)
WHERE l.entry_id = e.id
  AND e.source_type = 'payment.received'
  AND l.third_party_type IS NULL
  AND COALESCE(p.customer_id, o.customer_id) IS NOT NULL;

-- PURCHASE_ORDER.RECEIVED: purchase_orders -> suppliers
UPDATE accounting_entry_lines l
SET third_party_id     = po.supplier_id,
    third_party_type   = 'supplier',
    third_party_name   = s.name,
    third_party_tax_id = s.tax_id
FROM accounting_entries e
JOIN purchase_orders po ON po.id = e.source_id
LEFT JOIN suppliers s ON s.id = po.supplier_id
WHERE l.entry_id = e.id
  AND e.source_type = 'purchase_order.received'
  AND l.third_party_type IS NULL
  AND po.supplier_id IS NOT NULL;

-- EXPENSE.APPROVED: omitido — expenses no tiene supplier_id directo
-- (la categoría/acreedor se modela por expense_category). Las nuevas líneas
-- SI viajan con third_party en el payload si el emisor lo aporta.

-- CREDIT_SALE.CREATED: omitido — tabla credit_sales no existe en este modelo.
-- Las líneas nuevas SÍ viajan con third_party en el payload del evento.

-- LAYAWAY.PAYMENT / LAYAWAY.CANCELLED: layaway_plans -> users (customer)
UPDATE accounting_entry_lines l
SET third_party_id     = lp.customer_id,
    third_party_type   = 'customer',
    third_party_name   = TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')),
    third_party_tax_id = u.document_number
FROM accounting_entries e
JOIN layaway_plans lp ON lp.id = e.source_id
LEFT JOIN users u ON u.id = lp.customer_id
WHERE l.entry_id = e.id
  AND e.source_type IN ('layaway.payment', 'layaway.cancelled')
  AND l.third_party_type IS NULL
  AND lp.customer_id IS NOT NULL;

-- DISPATCH_ROUTE.CLOSED: dispatch_routes -> no third-party externo (driver es employee)
-- Se omite.

-- NOTA: payroll_run queda EXCLUIDO por diseño (línea de corte documentada al
--       contador — el asiento agregado de nómina no liga a employees individuales).
--       Las NUEVAS líneas de payroll SÍ viajan con third_party en el payload.