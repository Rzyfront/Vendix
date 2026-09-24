SELECT o.id,o.delivery_type,o.shipping_method_id,o.shipping_address_id,
       o.shipping_address_snapshot IS NOT NULL AS has_snapshot,
       o.state,o.total_paid,o.grand_total
FROM orders o WHERE o.store_id=10 AND o.id=1119;
SELECT d.id,d.order_id,d.status,d.customer_address IS NOT NULL AS has_address
FROM dispatch_notes d WHERE d.id=226 AND d.store_id=10;
