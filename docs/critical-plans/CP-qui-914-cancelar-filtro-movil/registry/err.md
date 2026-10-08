# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `ORD_CANCEL_STOCK_COMMITTED_001` | 409 | Inventario/entrega comprometidos al confirmar | `cancelOrder()` muestra error, no marca fila cancelada | `extractApiErrorMessage(error)` | Fixture dev bloqueado + intento controlado de PATCH | [ ] |
| ERR-02 | `ORD_CANCEL_OPEN_TABLE_001` | 409 | Mesa abierta al confirmar | Error existente y recarga manual si cambió estado | `extractApiErrorMessage(error)` | Fixture de mesa abierta; comprobar ausencia de cambio | [ ] |
| ERR-03 | `ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001` | 409 | Pago con reversa parcial pendiente | Error existente, no cancela ni oculta tarjeta | `extractApiErrorMessage(error)` | Spec backend existente + UI con error simulado | [ ] |
| ERR-04 | `403` por `store:orders:update` | 403 | Usuario sin permiso intenta PATCH | Error existente; no dar éxito visual | `extractApiErrorMessage(error)` | `curl -i -X PATCH -H "Authorization: Bearer $READ_ONLY_JWT" -H 'Content-Type: application/json' -d '{"state":"cancelled"}' "$API/store/orders/$ORDER_ID"` | [ ] |
| ERR-05 | `ORD_CANCEL_CREDIT_NOTE_REQUIRED_001` | 409 | Factura electrónica aceptada sin nota crédito aceptada | Toast de error; orden intacta | `extractApiErrorMessage(error)` | Fixture fiscal dev o spec de `order-flow.service.ts` | [ ] |
| ERR-06 | `TABLE_SESSION_ADD_ITEMS_INVALID` | 422 | Platos avanzados sin `kitchenDisposition` en la cancelación | Toast de error; orden intacta | `extractApiErrorMessage(error)` | Fixture de KDS dev o spec de `order-flow.service.ts` | [ ] |
| ERR-07 | `SYS_INTERNAL_001` | 500 | Error inesperado del PATCH de cancelación | Toast de error, nunca éxito | `extractApiErrorMessage(error)` | Spec controller: error no tipado se relanza; comprobar filtro global en integración | [ ] |
