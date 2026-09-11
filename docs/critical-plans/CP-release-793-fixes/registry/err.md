# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `INVOICING_CALC_005/006` | 422 | Aritmetica no cerrable pre-numeracion | Banner con blockers + detalle | Copy nuevo del PR | Spec matriz + `extractArithmeticBlockers` | [x] |
| ERR-02 | `INVOICING_STATUS_001` | 409 | Doble emision concurrente de nota | Toast de error limpio | Error de estado documentado | Doble `issueNote` concurrente en staging | [x] |
| ERR-03 | Shipping validation | 400 | Threshold/costo invalido | Error visible, no 0 silencioso | Mensaje de campo | DTO basura → 400 igual que antes | [x] |
| ERR-04 | PQR notify failure | 200+warn | Aviso a solicitante falla | Log warn, comentario guardado | Toast de guardado ok | Forzar fallo SMTP en staging | [x] |
