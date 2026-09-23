-- Local QA-only orders in store 10; four payment paths for taxless product 425.
select o.id,o.store_id,o.subtotal_amount,o.tax_amount,o.grand_total,
       (select count(*) from order_items oi where oi.order_id=o.id) as item_count,
       (select count(*) from order_item_taxes oit join order_items oi on oi.id=oit.order_item_id where oi.order_id=o.id) as tax_snapshot_count,
       (select count(*) from payments p where p.order_id=o.id) as payment_count,
       coalesce((select string_agg(p.state::text,',') from payments p where p.order_id=o.id),'-') as payment_states,
       coalesce((select ts.table_id::text from table_sessions ts where ts.order_id=o.id),'-') as table_id
from orders o where o.id in (1100,1101,1102,1103) and o.store_id=10 order by o.id;
select count(*) as tax_assignments_product_425 from product_tax_assignments where product_id=425;
select settings#>>'{pos,tax_line_gate}' as legacy_tax_line_gate from store_settings where store_id=10;
