# Reusable Assets

<!-- [MANDATORY] From Reuse Discovery — one line per asset: `path` — what it provides, or `none — <reason>` if empty. -->

`apps/frontend/src/app/private/modules/store/orders/services/order-detail-sse.service.ts` — Patron EventSource manual con backoff 1s-30s y validacion runtime a replicar.
`apps/backend/src/domains/store/orders/services/order-sse.service.ts` — pushOrderEvent tipado ya usado por los 4 emisores; reutilizar sin cambios de protocolo.
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts:1007` — rowClassFn + flash seen via sessionStorage a reutilizar para resaltar la fila nueva.
`apps/frontend/src/app/core/services/ai-stream.service.ts` — NO reutilizar: es para chunks AI con ai-chunk, no para eventos de dominio.
