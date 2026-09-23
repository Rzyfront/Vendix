select o.id,o.store_id,o.state,o.grand_total,o.tax_amount,(select count(*) from payments p where p.order_id=o.id and p.state='succeeded') as paid_count,coalesce(ts.id,0) as session_id,coalesce(ts.table_id,0) as table_id,(select count(*) from order_item_taxes oit join order_items oi on oi.id=oit.order_item_id where oi.order_id=o.id) as tax_rows from orders o left join table_sessions ts on ts.order_id=o.id where o.id in (1110,1111,1127,1128) order by o.id;
select id,state from store_subscriptions where id=4;
select count(*) from product_tax_assignments where product_id=426;
