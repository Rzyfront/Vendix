-- Local dev baseline BEFORE I.1; historical fixtures are not a release regression.
select p.order_id,o.store_id,o.created_at,sum(p.amount)::numeric(12,2) as paid,o.grand_total
from payments p join orders o on o.id=p.order_id
where p.state in ('succeeded','captured')
group by p.order_id,o.store_id,o.created_at,o.grand_total
having sum(p.amount)>o.grand_total+0.01
order by p.order_id;
