select id,state,delivery_type,shipping_method_id,shipping_address_id,shipping_address_snapshot is not null from orders where id between 1119 and 1121 order by id;
