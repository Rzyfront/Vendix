## Context

El comerciante pide elegir la tarifa de envío en el paso Pago, junto al total, en vez de en el paso 1: el total a pagar depende de la tarifa elegida y quiere verlo recalcularse al elegir. Hoy la lista vive en el paso 1 (`payment-list`, línea 326) y el paso Pago solo resume la elección con botón para volver. El cambio reubica únicamente la UI de elección; la cotización, la detección de cobertura y la auto-selección con tarifa única se quedan donde están.

## General Objective

La tarifa de envío se elige en el paso Pago junto al total, que se recalcula al elegir, sin romper cobertura, auto-selección ni flujo de pago.

## Specific Objectives

1. El paso Pago muestra las tarjetas de tarifa (mismo diseño `payment-card`) cuando hay 2+ opciones a domicilio, y elegir una recarga métodos de pago, ETA y total visible.
2. El paso 1 avanza con dirección válida + cobertura aunque la tarifa aún no esté elegida; el avance del paso Pago exige tarifa elegida en modo domicilio.
3. Con tarifa única sigue autoseleccionada; sin cobertura el paso 1 conserva su estado vacío y el paso Pago no ofrece lista.
4. El flujo de recoger en tienda queda intacto (sin lista de tarifas en Pago).

## Approach Chosen

Mover solo la UI de elección al `delivery-summary` del paso Pago; la cotización en paso 1, `shippableOptions`, cobertura `none`, auto-selección single-only y `selectShippingMethod` (que ya recarga métodos, ETA y costo) se reutilizan sin cambios de lógica. Gana porque el diff es mínimo (HTML + gates), no duplica cotizaciones ni mueve estados de carga/vacío, y el total ya reacciona a `shipping_cost()`.

## Alternatives Considered

- Mover cotización + elección al paso Pago (cotizar al entrar): se rechaza porque duplica estados de carga/vacío en otro paso, retrasa la detección de sin-cobertura y genera churn de recotización al entrar/salir.
- Duplicar la lista en ambos pasos: se rechaza porque dos fuentes de elección divergen (elegir en una desincroniza la otra) y duplica mantenimiento.

## Critical Files

- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.html` — reubicar lista de tarifas (línea 326) al `delivery-summary` del paso Pago (línea 641) y ajustar gate del Continuar (línea 1061).
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts` — relajar avance de paso 1 sin elección y exigir elección en avance de Pago (`nextStep`).

## Reusable Assets

- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts:1814` — `selectShippingMethod(option, cost)` ya fija costo y recarga métodos de pago + ETA; la lista reubicada lo reutiliza tal cual.
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts:1381` — `shippableOptions()` como fuente de la lista en su nueva ubicación.
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.html:326-336` — tarjetas `payment-card` existentes; se trasladan, no se rediseñan.
- Total del Resumen lateral que ya reacciona a `shipping_cost()` mediante `currency` pipe.

## Steps

1. Reubicar tarjetas de tarifa al `delivery-summary` del paso Pago
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-ecommerce-checkout, vendix-currency-formatting
   Resources: none
   Business decision: La elección explícita de tarifa vive junto al total en el paso Pago; en paso 1 solo queda modo de entrega + estado de cobertura.
   Why: Va primero porque define el DOM que los gates del paso 2 referencian; sin la lista en Pago no hay qué exigir.
   Output: Bloque de tarjetas de tarifa dentro del `delivery-summary` (modo domicilio, 2+ opciones), reutilizando clases `payment-list`/`payment-card` y `(click)="selectShippingMethod(option, option.cost)"`; el resumen del paso Pago muestra la tarifa elegida y el total se recalcula.
   Verification: `docker logs vendix_frontend --tail 30` muestra `Compiled successfully` sin errores del componente; snapshot del paso Pago contiene las tarjetas.

2. Re-cablear gates de avance entre pasos
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-ecommerce-checkout
   Resources: none
   Business decision: Avanzar del paso 1 exige dirección válida + cobertura (no elección); avanzar del paso Pago exige tarifa elegida en domicilio; recoger no exige nada.
   Why: Va después de la UI porque los gates protegen el nuevo orden (elegir tarde, pagar después); invertir el orden dejaría avances sin tarifa posible.
   Output: `nextStep` permite paso 1→Pago sin `selected_shipping_option_id` (manteniendo mensaje si no hay cobertura) y bloquea Pago→Confirmar con "Por favor selecciona una opción de envío" si falta elección; `disabled` del Continuar actualizado en ambos pasos.
   Verification: Probe `npx tsc --noEmit --skipLibCheck --target es2022 --moduleResolution bundler --module esnext apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts` sin errores en archivos tocados.

3. E2E del nuevo orden en vhost local
   Skills: vendix-ecommerce-checkout, vendix-zoneless-signals
   Resources: `agent-browser open https://roku-shop.vendix.com --ignore-https-errors` (fallback según `how-to-test`; cuenta customer de pruebas de la tienda 10)
   Business decision: Toda tarifa listada debe ser elegible y recalcular el total visible antes de pagar; ninguna queda preseleccionada con 2+.
   Why: Cierra porque solo el navegador prueba la integración lista→total→métodos→avance que los pasos 1-2 no pueden probar aislados.
   Verification: En el paso Pago se ven ambas tarifas sin preselección; elegir una actualiza total y métodos; Continuar sin elegir bloquea con mensaje; con 1 tarifa autocontinúa; recoger no muestra lista.

## End-to-End Verification

1. Flujo agent-browser en `https://roku-shop.vendix.com` (customer de prueba tienda 10): domicilio Riohacha → paso Pago lista 2 tarifas → elegir actualiza total y métodos → Continuar avanza a Confirmar.
2. Mismo flujo sin elegir tarifa: Continuar bloquea con "Por favor selecciona una opción de envío" y no avanza.
3. `curl -s -X POST 'http://localhost:3000/api/shipping/calculate?store_id=10'` con payload Riohacha sigue devolviendo las opciones domicilio (contrato intacto, sin cambios backend).

## Knowledge Gaps

None.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
