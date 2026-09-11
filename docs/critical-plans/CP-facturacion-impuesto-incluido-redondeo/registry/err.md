# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `INVOICING_CALC_002` (familia) | 422 | cuerpo referencia entidad de otro tenant / documento inválido antes de numerar | bloquea emitir, muestra error | mensaje del código (no genérico) | spec que provoca divergencia y observa 422 con código | [ ] |
| ERR-02 | Prevalidador `HEADER_LINE_EXTENSION_MISMATCH` | 422 (bloqueo previo a DIAN) | cabecera ≠ Σ líneas o línea ≠ precio×cantidad | bloquea transmitir, sin quemar consecutivo | detalle del prevalidador | factura prueba inclusiva pasa el prevalidador tras el fix | [ ] |
| ERR-03 | Rechazo DIAN (regla aritmética FAU02/FAV06) | estado `rejected` en `dian_status` | XML con totales que la DIAN recomputa distintos | muestra estado rechazado, permite corregir | estado + motivo DIAN | `dian-totals.validator.spec.ts` en verde; prueba $3.000 aceptada en test-set | [ ] |
