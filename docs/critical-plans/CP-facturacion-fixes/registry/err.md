# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `INVOICING_NUMBER_001` (new, if needed) | 409/422 | numbering fails at send | Blocks send, keeps draft, shows retry | "No se pudo numerar; reintenta" | force generator failure in sandbox | [ ] |
| ERR-02 | `ORD_SHIP_CHARGE_001` (new) | 422 | charge/invoice of physical whatsapp order without method+rate | Blocks charge, names missing shipping step | "Elige el método de envío antes de cobrar" | curl charge w/o shipping | [ ] |
| ERR-03 | existing emission codes | as today | auto-send/webhook failure | Order flagged; panel shows fiscal state | existing messages | DIAN-down sandbox probe | [ ] |
| ERR-04 | `ORD_SHIP_CHARGE_001` | 422 | charge of physical order without method+rate | Blocks charge, names missing shipping step | "Elige el método de envío antes de cobrar" | curl charge w/o shipping | [ ] |
| ERR-05 | `ECOM_CHECKOUT_006` | 409 | second submit while first in flight | Client retries same key | "Checkout already in progress…, retry shortly" | parallel double-POST probe | [ ] |
