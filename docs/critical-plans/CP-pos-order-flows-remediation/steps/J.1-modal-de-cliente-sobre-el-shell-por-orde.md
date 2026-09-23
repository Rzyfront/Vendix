---
id: J.1
title: "Modal de cliente sobre el shell por orden del DOM"
phase: J
status: pending
owner: none
updated: 2026-09-22
contracts: []
adrs: []
skills: [vendix-frontend, vendix-frontend-modal, how-to-test]
---
# J.1 — Modal de cliente sobre el shell por orden del DOM

- **Skills:** Reordenamiento de template Angular sin cambiar z-index ni stacking contexts; recorrido Playwright del checkout con cliente a crédito.
- **Resources:** `apps/frontend/src/app/private/modules/store/pos/pos.component.ts:515` (`<app-pos-customer-modal>`), `:529` (`<app-pos-checkout-shell>`), `:624` (layaway), `:657` (order-payment) y `:681-686` (`.pos-container` sin stacking context) · `apps/frontend/src/app/shared/components/modal/modal.component.ts:275-287` (`z-[9999]` hardcodeado sin override) · `payment-collector.component.ts:641-646` (emite `requestCustomer` sin cerrar el shell) · precedente `pop.component.ts:207-213` · ficha de origen: F-025 en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** Se arregla el orden del template, no el sistema de capas: el modal de cliente se mueve después de los tres modales que lo tapan, replicando el fix de `pop.component.ts`. No se migra a CDK Overlay ni se normaliza la escala global de z-index (ver Non-Goals del hub).
- **Why:** Pedir cliente desde el checkout (modo crédito) abre el modal debajo del shell: el cajero ve el shell inerte y cree que el POS se colgó. Es orden del DOM entre dos `position: fixed` con z-index empatado, no un stacking context; mover el nodo en el template lo corrige sin tocar ningún contrato.
- **Output:** `pos.component.ts` con `<app-pos-customer-modal>` después de checkout-shell, layaway y order-payment; recorrido Playwright que pide cliente desde el checkout y lo ve encima.
- **Contracts touched:** none — reordenamiento de nodos en un template; ningún endpoint, DTO ni evento cambia.
- **Data impact:** none — cero escrituras; el paso mueve un nodo del DOM y no toca estado persistente.
- **Blast radius:** Si el reorden rompe una dependencia de orden (query de contenido, foco inicial), el modal de cliente deja de abrirse o pierde el foco.
- **Rollback:** Revertir el commit del paso; el template vuelve a su orden anterior sin estado que deshacer.
- **Verification:**
  - `npx playwright test` (recorrido: checkout → modo crédito → pedir cliente → el modal queda visible y con foco) + `grep -n "app-pos-customer-modal\|app-pos-checkout-shell\|layaway\|order-payment" apps/frontend/src/app/private/modules/store/pos/pos.component.ts`
- **Acceptance checklist:**
  - [ ] `<app-pos-customer-modal>` aparece después de checkout-shell, layaway y order-payment en el template.
  - [ ] Ningún `z-index`, clase de posicionamiento ni stacking context cambió en este paso.
  - [ ] Pedir cliente desde el checkout muestra el modal encima del shell, operable con teclado.
  - [ ] El shell conserva su estado al cerrar el modal de cliente (no se pierde el cobro en curso).
  - [ ] Los pares layaway y order-payment quedan verificados: el modal de cliente los cubre a ambos.
  - [ ] F-004 — AUDIT F-025 - modal de cliente bajo el shell por orden del DOM (major)
- **Status:** pending
