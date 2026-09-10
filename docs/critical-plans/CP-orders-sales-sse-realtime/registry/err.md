# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `STORE_CONTEXT_001` | 403 | SSE sin store_id en contexto | No abre stream, lista queda en REST | `Store context required` | `curl stream sin JWT → 401/403` | [ ] |
| ERR-02 | `AUTH_001` | 401 | ?token= ausente o invalido | idle silencioso, reintento manual | `No se pudo conectar en vivo` | `curl stream?token=bad → 401` | [ ] |
| ERR-03 | `ORDERS_404` | 404 | GET /:id de created ya borrada | Descarta evento, restaura totalItems | `sin toast, log debug` | `GET /store/orders/999999 → 404` | [ ] |
