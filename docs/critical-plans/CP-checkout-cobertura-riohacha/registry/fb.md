# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `POST /shipping/calculate?store_id=10` | `{address:{city,region,zip,…},items:[…]}` | `[{id,method_type,cost,zone_id,is_fallback}]` | `cart.service:getShippingEstimates()` → `fetchShipping` | Ninguno (lectura) | Zona sin tarifa domicilio deja lista vacía | Repetir request anotado en prod y local | [ ] |
| FB-02 | `GET /ecommerce/checkout/payment-methods?shipping_type=` | `shipping_type` del método elegido | Métodos filtrados por modo | `checkout.component.ts:selectShippingMethod` | Ninguno | Sin opción elegida no se cargan métodos de pago | Flujo Playwright domicilio 2 tarifas | [ ] |
| FB-03 | Domain config `customConfig.ecommerce.checkout` | — | `{require_registration,whatsapp_checkout,require_payment_receipt?,…}` | `checkout.service.ts:getRequirePaymentReceipt()` | Ninguno | Flag ausente ⇒ opcional (diseñado así) | `curl` settings con flag on/off | [ ] |
| FB-04 | `POST /ecommerce/checkout` | `CheckoutDto` + archivo opcional | `{order_id,order_number,total,state}` | `checkout.component.ts:placeOrder()` | Ninguno | Backend rechaza sin comprobante si flag on | Checkout transferencia con/sin archivo y flag on/off | [ ] |
