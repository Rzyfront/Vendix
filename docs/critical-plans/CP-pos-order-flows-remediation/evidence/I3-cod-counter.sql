-- Local QA POS counter COD order1115/store10.
select o.id,o.state,o.grand_total,o.total_paid,o.remaining_balance,p.id,p.state,p.amount
from orders o join payments p on p.order_id=o.id where o.id=1115 and o.store_id=10;
select count(*) as inventory_transactions from inventory_transactions it
join order_items oi on oi.id=it.order_item_id where oi.order_id=1115;
