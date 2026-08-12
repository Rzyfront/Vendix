-- Script para popular data de prueba en los reports de QUI-543 a QUI-551.
-- Ejecutar dentro del contenedor vendix_postgres:
--   docker exec -i vendix_postgres psql -U username -d vendix_db < scripts/seed-test-reports.sql
--
-- Antes de ejecutar, verificar que el store_id=10 (techsolutions) y
-- organization_id=6 existen. Si no, ajustar los IDs.

BEGIN;

-- Limpiar data de prueba previa para idempotencia
DELETE FROM ar_payments WHERE accounts_receivable_id IN
  (SELECT id FROM accounts_receivable WHERE document_number LIKE 'TEST-%');
DELETE FROM accounts_receivable WHERE document_number LIKE 'TEST-%';
DELETE FROM purchase_order_payments WHERE purchase_order_id IN
  (SELECT id FROM purchase_orders WHERE order_number LIKE 'TEST-%');
DELETE FROM purchase_orders WHERE order_number LIKE 'TEST-%';
DELETE FROM expenses WHERE description LIKE 'TEST-%';
DELETE FROM reviews WHERE comment LIKE 'TEST-%';
DELETE FROM sales_order_items WHERE sales_order_id IN
  (SELECT id FROM sales_orders WHERE order_number LIKE 'TEST-%');
DELETE FROM sales_orders WHERE order_number LIKE 'TEST-%';

-- =====================================================
-- QUI-540: Cuentas por cobrar (con buckets de mora)
-- =====================================================
INSERT INTO accounts_receivable
  (store_id, organization_id, customer_id, source_type, document_number,
   original_amount, paid_amount, balance, currency,
   issue_date, due_date, status, days_overdue, created_at)
VALUES
  -- Cliente 4, factura 1: 30 días vencida (31-60 bucket, naranja)
  (10, 6, 4, 'invoice', 'TEST-INV-001', 500000, 0, 500000, 'COP',
   CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '30 days',
   'open', 30, NOW()),
  -- Cliente 4, factura 2: 90+ días (rojo fuerte)
  (10, 6, 4, 'invoice', 'TEST-INV-002', 800000, 0, 800000, 'COP',
   CURRENT_DATE - INTERVAL '150 days', CURRENT_DATE - INTERVAL '90 days',
   'open', 90, NOW()),
  -- Cliente 5, factura 3: 10 días mora (0-30 bucket, amarillo)
  (10, 6, 5, 'invoice', 'TEST-INV-003', 250000, 100000, 150000, 'COP',
   CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE - INTERVAL '10 days',
   'partial', 10, NOW()),
  -- Cliente 6, factura 4: al día (corriente, verde)
  (10, 6, 6, 'invoice', 'TEST-INV-004', 1000000, 0, 1000000, 'COP',
   CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '25 days',
   'open', 0, NOW());

-- =====================================================
-- QUI-542: CxP proveedores (con buckets de mora)
-- =====================================================
INSERT INTO purchase_orders
  (organization_id, supplier_id, location_id, order_number, status,
   order_date, expected_date, received_date,
   subtotal_amount, tax_amount, total_amount, discount_amount,
   shipping_cost, payment_status, payment_due_date,
   supplier_invoice_number, prices_include_tax, created_by_user_id,
   created_at, updated_at)
VALUES
  -- Supplier 1, PO 1: 30 días vencida (amarillo)
  (6, 1, 1, 'TEST-PO-001', 'received', CURRENT_DATE - INTERVAL '60 days',
   CURRENT_DATE - INTERVAL '50 days', CURRENT_DATE - INTERVAL '45 days',
   1000000, 0, 1000000, 0, 0, 'unpaid', CURRENT_DATE - INTERVAL '15 days',
   'FAC-001', false, 16, NOW(), NOW()),
  -- Supplier 2, PO 2: 90+ días (rojo fuerte)
  (6, 2, 1, 'TEST-PO-002', 'received', CURRENT_DATE - INTERVAL '120 days',
   CURRENT_DATE - INTERVAL '100 days', CURRENT_DATE - INTERVAL '95 days',
   500000, 0, 500000, 0, 0, 'partial', CURRENT_DATE - INTERVAL '60 days',
   'FAC-002', false, 16, NOW(), NOW()),
  -- Supplier 3, PO 3: 5 días mora (0-30, verde)
  (6, 3, 1, 'TEST-PO-003', 'received', CURRENT_DATE - INTERVAL '15 days',
   CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '8 days',
   750000, 0, 750000, 0, 0, 'unpaid', CURRENT_DATE - INTERVAL '5 days',
   'FAC-003', false, 16, NOW(), NOW());

-- =====================================================
-- QUI-544: Expenses (gastos)
-- =====================================================
INSERT INTO expenses
  (store_id, organization_id, category_id, amount, currency,
   description, expense_date, state, created_by_user_id, created_at)
VALUES
  (10, 6, 1, 150000, 'COP', 'TEST-Arriendo mensual', CURRENT_DATE - INTERVAL '5 days',
   'paid', 16, NOW()),
  (10, 6, 2, 85000, 'COP', 'TEST-Servicios públicos', CURRENT_DATE - INTERVAL '10 days',
   'approved', 16, NOW()),
  (10, 6, 3, 200000, 'COP', 'TEST-Material de oficina', CURRENT_DATE - INTERVAL '2 days',
   'paid', 16, NOW()),
  (10, 6, 1, 95000, 'COP', 'TEST-Mantenimiento', CURRENT_DATE - INTERVAL '15 days',
   'pending', 16, NOW());

-- =====================================================
-- QUI-548: Reseñas por producto
-- =====================================================
INSERT INTO reviews
  (store_id, product_id, user_id, rating, title, comment, state,
   verified_purchase, helpful_count, created_at)
VALUES
  (10, 1, 4, 5, 'TEST-Excelente producto', 'TEST-Me encantó, lo recomiendo',
   'approved', true, 12, NOW() - INTERVAL '10 days'),
  (10, 1, 5, 4, 'TEST-Bueno', 'TEST-Buen producto pero caro', 'approved',
   true, 5, NOW() - INTERVAL '5 days'),
  (10, 2, 4, 3, 'TEST-Regular', 'TEST-Esperaba más', 'approved',
   false, 2, NOW() - INTERVAL '3 days'),
  (10, 2, 6, 2, 'TEST-Defectuoso', 'TEST-Llegó roto', 'pending',
   true, 0, NOW() - INTERVAL '1 day'),
  (10, 3, 5, 5, 'TEST-Increíble', 'TEST-El mejor producto', 'approved',
   true, 8, NOW() - INTERVAL '7 days');

-- =====================================================
-- QUI-551: Ventas por vendedor (sales_orders con created_by_user_id)
-- =====================================================
INSERT INTO sales_orders
  (organization_id, customer_id, order_number, status,
   shipping_address_id, created_by_user_id, approved_by_user_id,
   created_at, updated_at)
VALUES
  (6, 4, 'TEST-SO-001', 'received', NULL, 16, 16, NOW(), NOW()),
  (6, 5, 'TEST-SO-002', 'received', NULL, 16, 16, NOW(), NOW()),
  (6, 4, 'TEST-SO-003', 'received', NULL, 17, 17, NOW(), NOW()),
  (6, 6, 'TEST-SO-004', 'received', NULL, 17, 17, NOW(), NOW()),
  (6, 5, 'TEST-SO-005', 'received', NULL, 18, 18, NOW(), NOW());

-- Items de las sales_orders (el total se suma aquí)
INSERT INTO sales_order_items
  (sales_order_id, product_id, product_variant_id, quantity,
   unit_price, discount, total_price, cost_price)
VALUES
  (1, 1, NULL, 2, 5000, 0, 10000, 3000),
  (1, 2, NULL, 1, 8000, 0, 8000, 4000),
  (2, 3, NULL, 3, 4000, 0, 12000, 2500),
  (3, 1, NULL, 1, 5000, 0, 5000, 3000),
  (4, 2, NULL, 2, 8000, 0, 16000, 4000),
  (5, 3, NULL, 1, 4000, 0, 4000, 2500);

-- =====================================================
-- QUI-541 + QUI-549: Ventas por canal y Top clientes
-- (orders con diferentes channels y completed_at reciente)
-- =====================================================
-- Primero verificar si hay orders existentes para esos clientes
-- Si no hay, crear algunos con diferentes canales
DO $$
DECLARE
  v_order_id INT;
  v_customer_id INT;
  v_channel order_channel_enum;
  v_count INT := 0;
BEGIN
  FOR i IN 1..20 LOOP
    -- Cliente varía entre 4, 5, 6 (los del seed)
    v_customer_id := 4 + (i % 3);
    -- Canal varía
    CASE (i % 4)
      WHEN 0 THEN v_channel := 'pos'::order_channel_enum;
      WHEN 1 THEN v_channel := 'ecommerce'::order_channel_enum;
      WHEN 2 THEN v_channel := 'agent'::order_channel_enum;
      WHEN 3 THEN v_channel := 'whatsapp'::order_channel_enum;
    END CASE;

    INSERT INTO orders
      (store_id, customer_id, order_number, channel, state, currency,
       subtotal_amount, discount_amount, tax_amount, shipping_cost,
       grand_total, total_paid, remaining_balance, placed_at,
       completed_at, created_at, updated_at)
    VALUES
      (10, v_customer_id, 'TEST-ORD-' || i, v_channel, 'delivered',
       'COP', 50000 + (i * 1000), 0, 0, 0, 50000 + (i * 1000),
       50000 + (i * 1000), 0, NOW() - (i * INTERVAL '1 day'),
       NOW() - (i * INTERVAL '1 day') + INTERVAL '2 hours',
       NOW() - (i * INTERVAL '1 day'), NOW())
    RETURNING id INTO v_order_id;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Inserted % orders', v_count;
END $$;

-- =====================================================
-- QUI-539: Cartera clientes aging (días sin comprar)
-- Las orders recién creadas ya cubren esto, pero aseguremos que
-- el cliente 4 tiene al menos una orden "vieja" (>90 días)
-- =====================================================
INSERT INTO orders
  (store_id, customer_id, order_number, channel, state, currency,
   subtotal_amount, discount_amount, tax_amount, shipping_cost,
   grand_total, total_paid, remaining_balance, placed_at,
   completed_at, created_at, updated_at)
VALUES
  (10, 4, 'TEST-OLD-001', 'pos', 'delivered', 'COP',
   100000, 0, 0, 0, 100000, 100000, 0,
   NOW() - INTERVAL '120 days',
   NOW() - INTERVAL '120 days' + INTERVAL '1 hour',
   NOW() - INTERVAL '120 days', NOW()),
  (10, 5, 'TEST-OLD-002', 'pos', 'delivered', 'COP',
   50000, 0, 0, 0, 50000, 50000, 0,
   NOW() - INTERVAL '150 days',
   NOW() - INTERVAL '150 days' + INTERVAL '1 hour',
   NOW() - INTERVAL '150 days', NOW());

COMMIT;

-- Verificación rápida
SELECT 'accounts_receivable' AS tabla, COUNT(*) FROM accounts_receivable WHERE document_number LIKE 'TEST-%'
UNION ALL
SELECT 'purchase_orders', COUNT(*) FROM purchase_orders WHERE order_number LIKE 'TEST-%'
UNION ALL
SELECT 'expenses', COUNT(*) FROM expenses WHERE description LIKE 'TEST-%'
UNION ALL
SELECT 'reviews', COUNT(*) FROM reviews WHERE comment LIKE 'TEST-%'
UNION ALL
SELECT 'sales_orders', COUNT(*) FROM sales_orders WHERE order_number LIKE 'TEST-%'
UNION ALL
SELECT 'orders', COUNT(*) FROM orders WHERE order_number LIKE 'TEST-%';
