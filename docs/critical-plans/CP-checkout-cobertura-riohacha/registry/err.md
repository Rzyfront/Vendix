# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `ORD_SHIP_NO_ZONE_001` | n/a (cliente) | Respuesta sin despachables en modo domicilio | Estado vacío + `error_message` + toast | "No hay cobertura…" / "No hay envío a domicilio para esta dirección…" | Playwright caso solo-pickup | [ ] |
| ERR-02 | `ECOM_CHECKOUT_ADDR_REQUIRED_001` | n/a (cliente) | Continuar con formulario inválido | Marca campos + mensaje | Formulario de dirección requerido | Playwright formulario incompleto | [ ] |
| ERR-03 | (warn solo-log) Ninguna zona cubre | n/a (server log) | `candidates.length===0` en `resolveZone` | Ninguno visible (hallazgo F-004) | Solo `logger.warn` con tienda y dirección | `docker logs`/CloudWatch tras reproducir | [ ] |
