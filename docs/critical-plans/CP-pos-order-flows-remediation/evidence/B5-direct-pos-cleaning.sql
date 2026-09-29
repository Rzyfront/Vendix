select o.id,o.customer_alias,o.tax_amount,o.grand_total,ts.id as session_id,ts.table_id,ts.paid_at,ts.closed_at,t.status as table_status from orders o join table_sessions ts on ts.order_id=o.id join tables t on t.id=ts.table_id where o.id=1129;
select p.id,p.state,p.amount from payments p where p.order_id=1129;
