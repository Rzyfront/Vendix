-- Local QA after owner DELETE and mesero forbidden DELETE; order1113/store10 survives.
select o.id,o.state,count(p.id) as payment_count from orders o
left join payments p on p.order_id=o.id where o.id=1113 and o.store_id=10 group by o.id;
