# Camino de venta — endpoints que nunca bloquea el paywall de plan

PR #1080 («venta blindada»). Como cajero en el POS, o como dueño cobrando una
orden, quiero que la venta nunca se bloquee por el paywall de módulos del plan,
para cobrar y facturar aunque mi plan no incluya contabilidad ni facturación.

**Para probarlo:** pon una tienda Impulsa o Emprendedor con el flag del plan en
`enforce`. Abre `/admin/pos`, elige un cliente, agrega productos y cobra. El
carrito calcula la retención, no aparece el paywall y el cobro termina. Después
ve a `/admin/orders/<id>`, pulsa «Cobrar» en una orden pendiente y luego
«Facturar»: tampoco aparece el paywall.

## Punto único de decisión

`isSaleFlow({ apiPath, uiRoute })` en `plan-modules.ts` (tres copias idénticas:
`libs/shared-types`, `apps/backend/src/common/access`,
`apps/frontend/src/app/shared/constants`). La usan:

- **Guard del backend** (`plan-access.guard.ts`). Si `isSaleFlow` dice que la
  ruta es venta, nunca responde 403. Si el plan no incluye el módulo, deja
  pasar la petición y escribe `ACCESS_AUDIT` con `decision: would_block`,
  `layer: plan` y el `mode` real. En el log, `would_block` junto a `enforce` se
  lee «una venta usó un módulo fuera del plan».
- **Interceptor del frontend** (`subscription-paywall.interceptor.ts`). Ante un
  `PLAN_MODULE_NOT_INCLUDED`, no abre el paywall si el endpoint es de venta
  (`SALE_FLOW_API_PREFIXES`) o si la pantalla tiene una venta en curso
  (`SALE_FLOW_UI_ROUTES`: `/admin/pos`, `/admin/orders/:id`, `/cart`,
  `/checkout`). Solo deja un `console.warn`, porque el backend ya registró el
  rechazo. Esto cubre también un endpoint de venta nuevo que todavía no esté en
  la lista.
- **Tests**: `plan-modules.sale-flow.spec.ts`, `plan-access.guard.spec.ts` y
  `subscription-paywall.plan-sale.spec.ts`.

`SALE_FLOW_API_PREFIXES` entra completo en `PLAN_GATE_EXEMPT_API_PREFIXES`. En
los patrones, `:id` corresponde a un segmento numérico y un `$` final pide la
ruta exacta. Una entrada puede llevar método (`GET /api/...`) y entonces solo
exime ese método. La query y el hash se descartan antes de decidir, así que no
cambian el resultado. Así se exime solo la llamada de venta, no el módulo
entero.

## Endpoints bajo prefijo bloqueable (exentos)

| Llamada | Etapa | ¿Automática? | Origen en el frontend |
|---|---|---|---|
| `POST /api/store/withholding-tax/preview` | impuestos-retenciones | Sí, al cambiar el carrito (debounce de 300 ms, con cliente y base > 0) | `pos-cart.service.ts` → `withholding-tax.service.ts` |
| `GET /api/store/invoicing/pos/orders/:id/fiscal-status` | facturación | Sí, polling después del cobro | `pos-fiscal.service.ts` |
| `POST /api/store/invoicing/pos/orders/:id/emit` | facturación | Clic en «Reintentar» | `pos-fiscal.service.ts` |
| `GET /api/store/invoicing/dian-config/emission-status` | facturación | Sí, al montar el POS, la cuenta dividida y el detalle de orden | `pos-holder-warning.component.ts`, `split-accounts-panel`, `order-details-page` |
| `GET /api/store/invoicing/holder-check` | cliente | Sí, en cada cambio de cliente | `pos-holder-warning.component.ts` → `invoicing.service.ts` |
| `GET /api/store/invoicing/dian-config` (solo `GET` de la lista exacta; crear una configuración sigue bloqueado) | facturación | Sí, al abrir el modal de confirmación | `pos-order-confirmation.component.ts` (`loadDianConfigs`) |
| `GET /api/store/invoicing/uvt-threshold` | facturación | Sí, al montar el detalle de orden | `order-details-page` → `invoicing.service.ts` |
| `GET /api/store/invoicing/:id/notes` | facturación | Sí, al recargar la orden después del cobro | `order-details-page` |
| `POST /api/store/invoicing/orders/:id/emit` | facturación | Clic en «Facturar» | `order-details-page` |
| `GET /api/store/invoicing/:id/pdf` (exacto) | impresión | Clic | `order-details-page` |
| `POST /api/store/invoicing/financial-accounts/:id/emit` | facturación | Clic (cuenta dividida) | `split-accounts-panel` → `invoicing.service.ts` |

Siguen bloqueables, entre otros: el CRUD de `dian-config/:id`,
`withholding-tax/concepts|calculate|stats`, `invoicing/:id/pdf/regenerate`,
`credit-notes` y las pantallas de cada módulo.

La venta no llama nunca a `/accounting`, `/exogenous`, `/taxes/ica`,
`/payroll`, `/reports/payroll` ni `/store/fiscal`. El checkout de la tienda
online (`/api/ecommerce/*`) no pasa por la capa de plan.

## Endpoints de venta fuera de prefijos bloqueables

La capa de plan nunca los evalúa. Los rastrea el test de contrato a modo de
muestra.

| Etapa | Endpoints |
|---|---|
| carrito | `store/products` (`/:id`, `search-selections`), `product-option-groups/for-product/:id`, `orders/:id` (`/items`, `/editor`), `orders/:id/flow/cancel`, `kitchen-fire` (`/preview`), `tables/floor-map`, `table-sessions` (`/:id/add-items`, `/:id/close`), `menus`, `reservations/*`, `service-sessions/*`, `scheduled-orders/availability`, `quotations` |
| cliente | `customers` (`/:id`, `/top`, `/lookup`, `/resolve`, `/:id/price-tier`), `addresses`, `addresses/dian/municipalities`, `customer-queue/*`, `/api/ecommerce/geocoding/forward` |
| descuentos | `promotions/active`, `coupons/validate`, `price-tiers` (`/products/:id/overrides`) |
| impuestos | `store/taxes` (automático al iniciar) |
| medios de pago | `payments/payment-methods`, `payment-methods`, `wallets/:customerId`, `payments/wompi/financial-institutions` |
| cobro | `payments/pos` (`/process-reserved/:id`, `/confirm-wompi-payment/:id`), `payments`, `payments/with-order`, `payments/:id/status` (polling), `orders/:id/flow/pay`, `orders/:id/flow/credit-payment`, `orders/:id/split*`, `layaway`, `hospitality/room-charges` |
| caja y turno | `cash-registers`, `cash-registers/sessions/*` (`active`, `open`, `:id/close`, `cash-summary`, `pending-orders`, `close-report`, `movements`, `suspend`, `report`, `ai-summary`), `orders/bulk/cash-session-{preview,process,finish}` |
| stock | `inventory/stock-levels/sourcing-suggestion`, `inventory/serial-numbers/available`, `uom` |
| impresión | `print-formats/resolve-for-document`, `print-formats/render` |
| consulta automática | `categories`, `brands`, `settings`, `settings/schedule-status` |
| envío | `/api/shipping/{methods,address-scope,calculate,pickup-quote,manual-quote}` |
| después del cobro | `dispatch-notes/from-order/:id`, `dispatch-notes/:id/deliver`, `orders/:id/send-to-dispatch`, `orders/:id/timeline`, `orders/:id/refunds`, `flow/refund/coverage`, `dispatch-notes/by-order/:id` |
| tienda online | `/api/ecommerce/cart/*`, `/api/ecommerce/checkout/*` (`delivery-options`, `address-scope`, `payment-methods`, `coupon-preview`, `prepare-wompi`, `confirm-wompi-payment/:id`, `eligibility`), `/api/ecommerce/invoice-data/:token/*`, `GET /api/store/orders/preview-eta` (`fetch` directo) |

Salvo que se indique otra cosa, las rutas cuelgan de `/api/store/`.

## Cómo se mantiene

- Si la venta empieza a llamar un endpoint nuevo bajo un prefijo bloqueable:
  agrega su prefijo a `SALE_FLOW_API_PREFIXES` en `libs/shared-types/plan-modules.ts`,
  cópialo a las dos réplicas, añade la llamada a `GATED_SALE_CALLS` en
  `plan-modules.sale-flow.spec.ts` y actualiza esta tabla.
- Si una superficie de venta (POS, detalle de orden, cuenta dividida o
  ecommerce) importa algo nuevo de un módulo bloqueable, el test de contrato
  falla hasta que alguien revise sus llamadas y lo registre en
  `REVIEWED_GATED_IMPORTS`.
- Aunque nadie actualice la lista, el interceptor no abre el paywall en una
  pantalla de venta.
