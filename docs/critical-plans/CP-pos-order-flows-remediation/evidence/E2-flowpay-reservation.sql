SELECT o.id,o.state,o.grand_total,o.total_paid,
       (SELECT count(*) FROM payments p WHERE p.order_id=o.id AND p.state='succeeded') AS succeeded_payments,
       (SELECT count(*) FROM stock_reservations r WHERE r.reserved_for_type='order' AND r.reserved_for_id=o.id AND r.status='active') AS active_reservations
FROM orders o WHERE o.store_id=10 AND o.id IN (1140,1142) ORDER BY o.id;
SELECT id,quantity_on_hand,quantity_reserved,quantity_available
FROM stock_levels WHERE product_id=421 ORDER BY id;
SELECT a.resource_id,a.action,a.metadata->>'reservation_count' AS reservation_count
FROM audit_logs a WHERE a.metadata->>'store_id'='10' AND a.resource_id IN (1140,1142)
AND a.action='order.promoted_to_created' ORDER BY a.id;
SELECT i.order_id,count(t.id) AS negative_inventory_transactions
FROM order_items i LEFT JOIN inventory_transactions t ON t.order_item_id=i.id AND t.quantity_change<0
WHERE i.order_id IN (1140,1142) GROUP BY i.order_id ORDER BY i.order_id;
