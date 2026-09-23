select count(*) from orders where delivery_type='direct_delivery' and shipping_address_snapshot is not null and state='finished';
