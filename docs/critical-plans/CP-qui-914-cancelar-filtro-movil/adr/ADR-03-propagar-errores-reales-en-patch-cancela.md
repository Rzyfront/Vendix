---
id: ADR-03
title: "propagar errores reales en patch cancelar"
status: proposed
reversibility: costly
updated: 2026-10-06
---
# ADR-03 — propagar errores reales en patch cancelar

- **Context:** `OrdersController.update()` captura errores no tipados y retorna `responseService.error()`. En esta ruta puede dar HTTP 200 con `success:false`; `StoreOrdersService.updateOrderStatus()` y `cancelOrder()` siguen la vía de éxito de `HttpClient`.
- **Decision:** Si `updateOrderDto.state === 'cancelled'`, relanzar un error no tipado para que `AllExceptionsFilter` emita HTTP 500 `SYS_INTERNAL_001`. Mantener el relanzamiento existente de `VendixHttpException` y el comportamiento previo de otras ediciones. No agregar lógica para interpretar `success:false` en Angular.
- **Consequences:** El contrato HTTP cambia para el fallo inesperado al cancelar. El cliente recibe la vía de error y evita un toast de éxito falso. Se necesita spec de controller y comprobación E2E con rechazo tipado.
- **Reversibility:** costly — volver al catch anterior reintroduce una señal falsa en una acción destructiva; no hay migración de datos.
- **Revisit if:** Se corrige centralmente el contrato HTTP de todos los controllers y se prueba que ninguna ruta retorna HTTP 200 ante `success:false`.
