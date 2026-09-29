SELECT t.id AS table_id, t.status, s.id AS session_id, s.order_id,
       o.order_number, o.customer_alias, o.subtotal_amount,
       o.tax_amount, o.grand_total, count(oi.id) AS item_count
FROM tables t JOIN table_sessions s ON s.table_id=t.id
JOIN orders o ON o.id=s.order_id
LEFT JOIN order_items oi ON oi.order_id=o.id
WHERE t.store_id=10 AND t.id IN (23,24)
GROUP BY t.id,t.status,s.id,s.order_id,o.order_number,o.customer_alias,
         o.subtotal_amount,o.tax_amount,o.grand_total ORDER BY t.id;
SELECT count(*) AS open_session_status_mismatch FROM tables t
JOIN table_sessions s ON s.table_id=t.id AND s.closed_at IS NULL
WHERE t.store_id=10 AND t.status<>'occupied';
