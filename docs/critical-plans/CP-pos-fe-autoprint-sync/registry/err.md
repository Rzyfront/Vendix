# Error Code Registry
| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|----------------|--------------|--------|
| ERR-01 | FE_EMISSION_FAILED_FALLBACK | 200 (state: failed) | La DIAN rechaza o la prevalidación bloquea la emisión | Imprime ticket contingencia y muestra banner/toast explicativo | No se pudo emitir factura electrónica (motivo). Se imprimió ticket de contingencia. | Provocar fallo fiscal (ej. sin NIT cliente) y verificar alerta y ticket | [x] |
| ERR-02 | FE_EMISSION_TIMEOUT_FALLBACK | none (timeout cliente) | Sondeo fiscal supera 10s sin respuesta definitiva de DIAN | Imprime ticket contingencia y advierte demora en UI | La DIAN tardó demasiado en responder. Se imprimió ticket de venta de respaldo. | Simular delay > 10s en backend y observar timeout | [x] |
| ERR-03 | INVOICING_FIND_003 | 404 | Pedido no existe o pertenece a otro tenant | Muestra toast de error y no emite ni imprime | No se encontró el pedido en esta tienda. | Petición con orderId inexistente | [x] |
