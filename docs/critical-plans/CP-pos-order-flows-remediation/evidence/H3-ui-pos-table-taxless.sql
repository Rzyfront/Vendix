select o.id,o.order_number,o.state,o.channel,o.delivery_type,o.customer_alias,o.subtotal_amount,o.tax_amount,o.grand_total,o.total_paid,o.remaining_balance,ts.id as session_id,ts.table_id,ts.paid_at,ts.closed_at,t.status as table_status from orders o join table_sessions ts on ts.order_id=o.id join tables t on t.id=ts.table_id where o.id=1124;
select id,order_id,product_id,product_name,quantity,tax_amount_item from order_items where order_id=1124;
select id,order_id,state,amount from payments where order_id=1124;
select count(*) as tax_assignments from product_tax_assignments where product_id=302;
select count(*) as line_tax_rows from order_item_taxes where order_item_id in (select id from order_items where order_id=1124);
