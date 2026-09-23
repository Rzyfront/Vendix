select o.id,o.customer_alias,o.customer_id,o.state,o.grand_total,p.id as payment_id,p.state as payment_state from orders o join payments p on p.order_id=o.id where o.id=1130;
