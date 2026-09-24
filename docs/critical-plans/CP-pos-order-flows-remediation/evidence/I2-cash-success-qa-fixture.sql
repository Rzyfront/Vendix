-- Local dev fixture: paid cash order, service line, cancellable before fulfillment.
with o as (
 insert into orders(store_id,order_number,state,channel,delivery_type,customer_alias,subtotal_amount,tax_amount,grand_total,currency,total_paid,remaining_balance)
 values (10,'QA-I2-CASH-OPEN-20260923-01','created','pos','direct_delivery','QA I2 efectivo caja abierta',10000,0,10000,'COP',10000,0)
 returning id
), i as (
 insert into order_items(order_id,product_id,product_name,quantity,unit_price,total_price,tax_amount_item)
 select id,425,'Test de servicio',1,10000,10000,0 from o returning id
), p as (
 insert into payments(order_id,store_payment_method_id,amount,currency,state,paid_at,transaction_id)
 select id,5,10000,'COP','succeeded',now(),'QA-I2-CASH-OPEN-20260923-01' from o returning id
)
select o.id,i.id,p.id from o cross join i cross join p;
