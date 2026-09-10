# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `POST /store/payments/pos` (charge draft, whatsapp-born) | `CreatePosPaymentDto` + `order_id` | `{ success, order }` | POS charge screen | + missing-shipping error at charge | Blocks real charges if over-broad | curl charge w/o shipping → code; with → ok | [ ] |
| FB-02 | webhook approve (Wompi) → internal send | n/a (event) | invoice `sent/failed` + order flag | panel fiscal flag | + auto-send call, non-blocking | Throwing into payment path | sandbox approve → sent; DIAN down → flag, payment ok | [ ] |
| FB-03 | `POST /ecommerce/checkout` + `Idempotency-Key` | `CheckoutDto` | `{ order_id, invoice_id, ... }` | storefront submit | + header; replay returns first result | Wrong scope blocks distinct purchases | double-POST same key → one order | [ ] |
