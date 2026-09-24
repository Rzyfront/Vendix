-- Local dev only: claimable POS order with a legitimate 3000 partial payment.
with o as (
  insert into orders(store_id,order_number,state,channel,delivery_type,customer_alias,
                     subtotal_amount,tax_amount,grand_total,currency,total_paid,remaining_balance)
  values (10,'QA-I1-PARTIAL-20260923-02','created','pos','direct_delivery',
          'QA I1 abono parcial',10000,0,10000,'COP',3000,7000)
  returning id
), i as (
  insert into order_items(order_id,product_id,product_name,quantity,unit_price,total_price,tax_amount_item)
  select id,425,'Test de servicio',1,10000,10000,0 from o returning id
), p as (
  insert into payments(order_id,store_payment_method_id,amount,currency,state,paid_at,transaction_id)
  select id,5,3000,'COP','succeeded',now(),'QA-I1-PARTIAL-20260923-02' from o returning id
)
select o.id as order_id,i.id as item_id,p.id as payment_id from o cross join i cross join p;
