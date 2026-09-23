SELECT s.id AS session_id,o.id AS order_id,o.state,o.total_paid,o.grand_total
FROM table_sessions s JOIN orders o ON o.id=s.order_id
WHERE s.store_id=10 AND s.paid_at IS NULL
  AND o.total_paid>=o.grand_total AND o.grand_total>0
ORDER BY s.id;
