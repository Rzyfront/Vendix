# D.1 — pruebas de control sobre reversa BOM (sin cambio final al servicio)

QA local 2026-09-23. El arnés `order-flow.service.spec.ts` cubre `kitchenDisposition` `reuse`, `waste`, ausente ante ticket avanzado, ticket `pending` y línea sin consumo. El caso `reuse` usa tres consumos de hojas distintos (`701/-2.5`, `702` variante `91/-1.25`, `703/-4`) y espera exactamente tres devoluciones `+2.5/+1.25/+4`, ubicación resuelta con variante, `movement_type=return` y sin `order_item_id` en la devolución. Los valores esperados están escritos como constantes del test, no derivados del mock del servicio.

| Control | Mutación TEMPORAL en `OrderFlowService.cancelOrder` | Resultado del test focalizado |
| --- | --- | --- |
| Baseline | ninguna | **1 passed** |
| Signo | `Math.abs(ct.quantity_change)` → `ct.quantity_change` | **1 failed**: esperaba `quantity_change=+2.5`, recibió `-2.5` |
| Variante | `getDefaultLocationForProduct(ct.product_id, ct.product_variant_id ?? undefined)` → segundo argumento `undefined` | **1 failed**: lookup inesperado `702/undefined` en vez de variante `91` |
| Restaurado | diff del archivo de servicio = **0** | OrderFlow **122/122** + CancellationPolicy **46/46** = **168/168 passed** |

Cada mutación se revirtió inmediatamente antes de continuar; `git diff --exit-code` sobre `order-flow.service.ts` fue 0. Logs crudos locales: `/tmp/d1-baseline-reuse.log`, `/tmp/d1-mutant-sign.log`, `/tmp/d1-mutant-variant.log`, `/tmp/d1-restored-green.log`. Las dos rojas prueban que el test **no** pasa por tautología; no se dejó código mutado ni se tocó base de datos.
