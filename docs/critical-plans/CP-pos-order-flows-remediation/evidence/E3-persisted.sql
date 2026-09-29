SELECT id,state,delivery_type,channel,customer_alias
FROM orders WHERE store_id=10 AND id IN (1147,1148,1149) ORDER BY id;
