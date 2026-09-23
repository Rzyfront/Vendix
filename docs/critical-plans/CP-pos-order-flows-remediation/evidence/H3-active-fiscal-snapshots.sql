-- Local H.3 store 3; fiscal_status.invoicing=LOCKED. Subscription restored to expired after QA.
select o.id,o.store_id,o.subtotal_amount,o.tax_amount,o.grand_total,
       count(distinct oi.id) as item_count,count(oit.id) as tax_snapshot_count,
       count(distinct p.id) as payment_count,coalesce(max(p.state::text),'-') as payment_state,
       coalesce(max(ts.table_id::text),'-') as table_id
from orders o left join order_items oi on oi.order_id=o.id
left join order_item_taxes oit on oit.order_item_id=oi.id
left join payments p on p.order_id=o.id
left join table_sessions ts on ts.order_id=o.id
where o.id in (1110,1111) and o.store_id=3 group by o.id order by o.id;
select settings#>>'{fiscal_status,invoicing,state}' from store_settings where store_id=3;
select state from store_subscriptions where id=4 and store_id=3;
