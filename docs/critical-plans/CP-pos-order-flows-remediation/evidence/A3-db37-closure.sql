-- DB-37 closure: invoices aceptadas vs líneas canceladas después.
-- Expectativa: 0 filas (ninguna invoice 'accepted' con order_item cancelado después de i.updated_at).
-- Solo lectura (SELECT). Fecha: 2026-09-24. Step A.3 CP-pos-order-flows-remediation.

-- Query base (contrato del step):
SELECT i.id FROM invoices i JOIN order_items x ON x.order_id=i.order_id WHERE i.status='accepted' AND x.cancelled_at>i.updated_at;

-- Query ampliada (id+timestamps, solo-lectura; usada porque la base dio 0 filas, para dejar trazabilidad):
SELECT i.id AS invoice_id, i.status, i.updated_at AS invoice_updated_at, x.id AS order_item_id, x.order_id, x.cancelled_at FROM invoices i JOIN order_items x ON x.order_id=i.order_id WHERE i.status='accepted' AND x.cancelled_at>i.updated_at ORDER BY i.id, x.id;
