SELECT o.id,o.state,o.order_number,o.grand_total,
       (SELECT count(*) FROM payments p WHERE p.order_id=o.id) AS payment_count,
       (SELECT count(*) FROM stock_reservations sr WHERE sr.reserved_for_type='order' AND sr.reserved_for_id=o.id AND sr.status='active') AS active_reservations,
       (SELECT count(*) FROM table_sessions s WHERE s.order_id=o.id AND s.closed_at IS NULL) AS open_sessions
FROM orders o WHERE o.store_id=10 AND o.id=1135;
SELECT count(*) AS open_sessions_to_cancelled_orders FROM table_sessions s
JOIN orders o ON o.id=s.order_id
WHERE s.closed_at IS NULL AND o.state='cancelled' AND o.store_id=10;
