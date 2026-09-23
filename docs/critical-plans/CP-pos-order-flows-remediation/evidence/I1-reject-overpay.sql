-- Local QA order1113/store10 after POST flow/pay: remains one succeeded payment.
select o.id,o.store_id,o.state,o.grand_total,count(p.id) as payments,
       sum(p.amount)::numeric(12,2) as paid
from orders o left join payments p on p.order_id=o.id
where o.id=1113 and o.store_id=10 group by o.id;
