-- Local dev QA fixtures only, store 10; do not run in production.
with p as (
  insert into products (store_id,name,slug,base_price,track_inventory,product_type,is_sellable)
  values (10,'QA H3 servicio IVA 0%','qa-h3-servicio-iva-0-20260923',10000,false,'service',true),
         (10,'QA H3 servicio IVA 19%','qa-h3-servicio-iva-19-20260923',10000,false,'service',true)
  returning id,slug
)
insert into product_tax_assignments(product_id,tax_category_id,is_inclusive)
select id,case when slug like '%iva-0-%' then 91 else 89 end,false from p
returning product_id,tax_category_id;
