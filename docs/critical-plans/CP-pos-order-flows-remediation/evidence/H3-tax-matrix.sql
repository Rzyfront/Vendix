-- Local QA-only store 10 tax matrix (product 425 no assignment; 2470 explicit 0%; 2471 IVA 19%).
select o.id,o.subtotal_amount,o.tax_amount,o.grand_total,count(distinct oi.id) as items,
       count(oit.id) as tax_rows,
       coalesce(string_agg(distinct oit.tax_rate_id::text || ':' || oit.tax_type::text || ':' || oit.tax_rate::text || ':' || oit.tax_amount::text,','),'-') as tax_snapshots,
       count(distinct pay.id) as payments,coalesce(max(pay.state::text),'-') as payment_state
from orders o left join order_items oi on oi.order_id=o.id
left join order_item_taxes oit on oit.order_item_id=oi.id
left join payments pay on pay.order_id=o.id
where o.id in (1106,1107,1108,1109) and o.store_id=10
group by o.id order by o.id;
select o.id,oi.product_id,oi.total_price,oi.tax_amount_item,
       coalesce(oit.tax_rate_id::text,'-'),coalesce(oit.tax_type::text,'-'),coalesce(oit.tax_amount::text,'-')
from orders o join order_items oi on oi.order_id=o.id
left join order_item_taxes oit on oit.order_item_id=oi.id
where o.id in (1108,1109) and o.store_id=10 order by o.id,oi.product_id;
