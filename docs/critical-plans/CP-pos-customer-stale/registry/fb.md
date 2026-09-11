# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `POST /store/customers/resolve` | `CreatePosCustomerRequest` | `{customer,was_created,was_updated}` | `pos-customer.service.ts:97` | `none (regression check only)` | Type mismatch | `curl POST resolve | jq keys` vs mapper | [ ] |
| FB-02 | `POST /store/payments/pos` | `CreatePosPaymentDto{customer_id}` | `{order,payment}` | `pos.component.ts:1786` | `none (regression check only)` | Field of less | `curl POST pos | jq .data.order.customer_id` | [ ] |
| FB-03 | `POST /store/orders` | `{customer_id,items}` | `{order}` | `pos.component.ts:2709` | `none (regression check only)` | Field of less | `curl POST orders | jq .data.customer_id` | [ ] |
| FB-04 | `POST /store/invoicing/from-order/:id` | `orderId param` | `{invoice,customer}` | `invoicing.service createFromOrder` | `none (regression check only)` | Optionality mismatch | `curl from-order | jq .data.customer` | [ ] |
| FB-05 | `GET /store/customers?search=&limit=` | `query,limit,page` | `{data[],meta}` | `pos-customer.service.ts:141` | `none (regression check only)` | Field of more | `curl GET customers | jq .data[0]\|keys` | [ ] |
| FB-06 | `GET /store/customers/top?limit=` | `limit` | `{data[]}` | `pos-customer.service.ts:186` | `none (regression check only)` | Type mismatch | `curl GET top | jq length` | [ ] |
| FB-07 | `POST /store/quotations` | `{customer_id,items}` | `{quotation}` | `pos.component.ts:onQuote` | `none (regression check only)` | Field of less | `curl POST quotations | jq .data.customer_id` | [ ] |
| FB-08 | `POST /store/layaways` | `CreateLayawayRequest` | `{layaway}` | `pos.component.ts:onLayaway` | `none (regression check only)` | Field of less | `curl POST layaways | jq .data.customer_id` | [ ] |
