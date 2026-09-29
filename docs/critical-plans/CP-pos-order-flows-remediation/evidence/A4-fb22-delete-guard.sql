SELECT o.id,o.state,o.total_paid,
       (SELECT count(*) FROM order_items i WHERE i.order_id=o.id) AS items,
       (SELECT count(*) FROM payments p WHERE p.order_id=o.id) AS payments
FROM orders o WHERE o.store_id=10 AND o.id IN (1130,1136) ORDER BY o.id;
