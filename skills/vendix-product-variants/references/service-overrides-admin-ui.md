# Service variant overrides, admin UI and existing data

## Service Variant Overrides

Service variants may override parent service values:

- `price_override`
- `cost_price`
- `profit_margin`
- `is_on_sale`
- `sale_price`
- `service_duration_minutes`
- `service_pricing_type`
- `buffer_minutes`
- `preparation_time_minutes`
- `attributes`
- `image_id`

Null service override fields mean inherit from the parent product.

Booking and availability flows must use the selected `product_variant_id` to resolve effective duration and buffer:

```ts
const duration =
  variant?.service_duration_minutes ??
  product.service_duration_minutes ??
  60;

const buffer =
  variant?.buffer_minutes ??
  product.buffer_minutes ??
  0;
```

## Admin UI Rules

Admin product forms must adapt the variant editor by product type and tracking mode:

| Situation | UI behavior |
| --- | --- |
| Physical product with stock | Show SKU, attributes, price, image, and stock controls per variant |
| Physical product without stock | Show SKU, attributes, price, and image; do not require stock |
| Service with booking | Show service option fields: duration, buffer, preparation time, pricing type, price, and image |
| Service without booking | Show service option fields that affect sale/fulfillment; do not show stock requirements |

Do not force variant stock totals to be greater than zero when product tracking is disabled.

## Existing Data Behavior

- Existing physical variants remain valid.
- Existing service products without variants remain valid and inherit product-level booking values.
- Existing service variants with null service override fields inherit parent product values.
- Existing variants with `stock_quantity = 0` must not be treated as unavailable unless effective tracking is enabled.

