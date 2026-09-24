-- Local dev fixtures for cash versus bank-transfer cancellation.
with o as (
 insert into orders(store_id,order_number,state,channel,delivery_type,customer_alias,subtotal_amount,tax_amount,grand_total,currency,total_paid,remaining_balance)
 values
 (10,'QA-I2-CASH-20260923-01','created','pos','direct_delivery','QA I2 efectivo',10000,0,10000,'COP',10000,0),
 (10,'QA-I2-BANK-20260923-01','created','pos','direct_delivery','QA I2 transferencia',10000,0,10000,'COP',10000,0)
 returning id,order_number
), i as (
 insert into order_items(order_id,product_id,product_name,quantity,unit_price,total_price,tax_amount_item)
 select id,425,'Test de servicio',1,10000,10000,0 from o returning id,order_id
), p as (
 insert into payments(order_id,store_payment_method_id,amount,currency,state,paid_at,transaction_id)
 select id,case when order_number like '%CASH%' then 5 else 8 end,10000,'COP','succeeded',now(),order_number from o returning id,order_id
)
select o.id,o.order_number,i.id as item_id,p.id as payment_id from o join i on i.order_id=o.id join p on p.order_id=o.id order by o.id;
