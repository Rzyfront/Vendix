SELECT s.id AS session_id,s.paid_at,s.closed_at,o.id AS order_id,o.state,
       o.grand_total,o.total_paid,
       (SELECT count(*) FROM payments p WHERE p.order_id=o.id AND p.state='succeeded') AS succeeded_payments
FROM table_sessions s JOIN orders o ON o.id=s.order_id
WHERE s.store_id=10 AND s.id=113;
