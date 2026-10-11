# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `KITCHEN_FIRE_ORDER_NOT_FOUND` | 404 | Fire de orden inexistente/ajena | No éxito; refrescar fila | Mensaje API | Curl con id ajeno | [ ] |
| ERR-02 | `KITCHEN_FIRE_ITEM_NOT_FOUND` | 404 | Item ajeno/no pertenece | No éxito; refrescar | Mensaje API | Curl id de otra orden | [ ] |
| ERR-03 | `SYS_VALIDATION_001` | 400 | DTO vacío o ids vacíos | Botón no envía; error si se fuerza | Mensaje API | Curl body vacío o `[]` | [ ] |
| ERR-04 | `KITCHEN_FIRE_ALL_ALREADY_CONSUMED` | 409 | Doble envío concurrente | No éxito; rehidratar indicador | Mensaje API | Dos POST simultáneos y uno secuencial en dev | [ ] |
| ERR-05 | `KITCHEN_FIRE_NO_DEFAULT_KDS` | 422 | Sin estación default activa | No éxito; aviso accionable | Mensaje API | Fixture sin KDS default | [ ] |
| ERR-06 | `INV_STOCK_INSUFFICIENT_LINES` | 409 | Insumos rastreados insuficientes | No éxito; sin ticket | Resumen de líneas API | Fixture stock insuficiente | [ ] |
| ERR-07 | `RESTAURANT_NOT_ENABLED` | 422 | Tienda sin industria restaurant | Icono oculto; backend rechaza | Mensaje API | Curl tienda retail dev | [ ] |
| ERR-08 | `403` permiso create/read | 403 | Usuario sin permiso intenta fire o lectura | Ocultar/deshabilitar; no éxito | Mensaje API | Curl usuario solo lectura | [ ] |
| ERR-09 | `SYS_INTERNAL_001` | 500 | Fallo inesperado de lectura/fire | Error, nunca éxito | Mensaje genérico + id solicitud | Spec de throw y HTTP real | [ ] |
| ERR-10 | SSE desconectado | N/A | Red/stream cae | Reconectar y rehidratar al abrir | Estado obsoleto, reconexión y refresco | Playwright offline/online | [ ] |
| ERR-11 | `KITCHEN_FIRE_NOT_ELIGIBLE_001` | 409 | `skip_kds` o orden terminal en POST | No éxito; rehidratar | Razón concreta de inelegibilidad | Curl dev con ambos casos | [ ] |
| ERR-12 | `ORD_FIND_001` | 404 | GET id tras borrado/cambio de tenant | Quitar estado obsoleto, no éxito | Aviso de fila no disponible | Curl GET ajeno y SSE+404 | [ ] |
| ERR-13 | Impresión de comanda fallida | N/A | Render/impresora tras fire confirmado | Avisar éxito de fire y guiar a detalle | «Ya enviada; abre detalle e imprime comanda» | Simular gateway nulo tras POST | [ ] |
