-- Local QA after B.2 canonical table-payment writer; store 10 only.
select o.id,o.store_id,o.tax_amount,o.grand_total,
       count(distinct oi.id) as items,count(oit.id) as tax_rows,
       count(distinct p.id) as payments,max(p.state::text) as payment_state,
       s.id as session_id,(s.paid_at is not null) as marked_paid,
       (s.closed_at is null) as remains_open,t.status as table_status
from orders o join table_sessions s on s.order_id=o.id join tables t on t.id=s.table_id
left join order_items oi on oi.order_id=o.id
left join order_item_taxes oit on oit.order_item_id=oi.id
left join payments p on p.order_id=o.id
where o.id=1112 and o.store_id=10 group by o.id,s.id,t.status;
