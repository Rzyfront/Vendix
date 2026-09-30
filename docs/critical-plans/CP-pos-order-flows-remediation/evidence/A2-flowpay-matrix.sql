SELECT o.id,o.state,o.delivery_type,o.shipping_method_id,o.grand_total,o.total_paid,o.remaining_balance,
       (SELECT count(*) FROM payments p WHERE p.order_id=o.id AND p.state='succeeded') AS succeeded_payments
FROM orders o WHERE o.store_id=10 AND o.id IN (1141,1144,1146) ORDER BY o.id;
SELECT id,table_id,order_id,paid_at,closed_at FROM table_sessions
WHERE store_id=10 AND id=117;
