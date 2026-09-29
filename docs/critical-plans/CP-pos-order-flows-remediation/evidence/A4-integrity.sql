-- Local QA-only orders in store 10.
select o.id,o.state,
       (select count(*) from payments p where p.order_id=o.id) as payment_count,
       (select count(*) from stock_reservations sr where sr.reserved_for_type='order' and sr.reserved_for_id=o.id and sr.status='active') as active_reservations,
       coalesce((select s.id::text from table_sessions s where s.order_id=o.id and s.closed_at is null),'-') as open_table_session
from orders o where o.id in (1104,1105) and o.store_id=10 order by o.id;
select count(*) as open_sessions_to_cancelled_orders from table_sessions s
join orders o on o.id=s.order_id where s.closed_at is null and o.state='cancelled' and o.store_id=10;
