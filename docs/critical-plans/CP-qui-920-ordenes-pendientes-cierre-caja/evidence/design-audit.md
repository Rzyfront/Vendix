# Auditoría adversarial de diseño — ronda 1

La investigación de caja, órdenes y UI revisó trece perspectivas. Los cinco hallazgos F-001..F-005 se cerraron como **correcciones del plan**, no como código probado. Después de implementar, repetir 13 perspectivas y dos rondas limpias.

| Perspectiva | Comprobación de diseño |
|---|---|
| 1 Arquitectura | Separación sesión origen/caja de cobro; endpoint de lote específico |
| 2 Implementación | Bulk general fuerza y responde parcial; F-002 |
| 3 Contratos | Web/móvil comparten POST, móvil sin expected_seen; F-005 |
| 4 Datos | Efectivo fuera de transacción y atribución nullable; F-001 |
| 5 Errores | 409 stale efectivo/pendientes y 403/404 tenant |
| 6 Seguridad | Sesión y orden del mismo store, permisos de cierre/lote |
| 7 Validación | IDs, fingerprint, motivo y saldo verificados en backend |
| 8 Carga | Listado paginado e índice por sesión/estado |
| 9 Estrategia | Migración aditiva, piloto web/móvil y rollback |
| 10 UX | Ver más vs Ver orden; F-003 |
| 11 Accesibilidad | Nombre de diálogo y foco; F-004 |
| 12 Comprensión | Completar no equivale a cobrar/entregar, copy explícito |
| 13 Observabilidad | Snapshot, actor, motivo, IDs y eventos post-commit |

El usuario solicitó ejecutar el plan; A.1 adoptó las recomendaciones documentadas en `evidence/business-analysis.md`.

## Reconocimiento de implementación — 2026-10-06

Lectura de `SessionsService.closeSession` confirma que movimientos, efectivo esperado y `summary` se calculan antes de la transacción; la transacción sólo hace CAS de `status='open'`, crea `closing_balance` y relee la sesión. El stale de `expected_closing_amount_seen` también se evalúa antes de la transacción. F-001 requiere resolver esta carrera en código.

Los escritores no comparten hoy una transacción/lock canónico: `MovementsService.createManualMovement`, `recordSaleMovement`, varios refunds/compensaciones, `CashSettlementService` para COD y la creación del cierre escriben por seams distintos. Los cobros POS pueden crear el movimiento después del pago y capturar/loggear el error; `split-account-payment.service.ts` sí bloquea la sesión con `FOR UPDATE`, pero ese bloqueo no es universal. Por eso un lock solo en el cierre no asegura que un pago confirmado tenga movimiento antes del snapshot; F-006 queda blocker.

Las órdenes no tienen `origin_cash_session_id`. `PaymentsService.createOrUpdateOrderFromPos` es un seam POS de creación; el editor actualiza una orden existente y debe preservar origen. `TableSessionsService` crea borradores de mesa antes del pago; QR público no tiene cajero. Ecommerce permanece sin sesión POS. El primer movimiento `sale` registra cobro, que puede ocurrir en sesión B para una orden abierta en A; no es evidencia suficiente para backfill de origen. Legacy se mantiene nullable; la API debe exponer que el tracking no está habilitado para esas sesiones sin inventar atribuciones. F-007 permanece blocker hasta verificar atribución de nuevas órdenes y compatibilidad legacy.


## Ajuste de integración de B.2

La ruta propuesta inicialmente bajo `SessionsController` obligaba a que `CashRegistersModule` importara `OrdersModule`; este último ya importa `CashRegistersModule`, creando un ciclo de módulos. Para preservar el límite de dominios, el preview y su ejecución se exponen en `OrdersBulkController` bajo `/store/orders/bulk/cash-session-preview` y `/store/orders/bulk/cash-session-finish`, con el permiso nombrado `store:cash_registers:close_session` validado explícitamente. `registry/fb.md` refleja estas rutas implementables.
