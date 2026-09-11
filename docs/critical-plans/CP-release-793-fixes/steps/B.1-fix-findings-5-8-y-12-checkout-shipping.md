---
id: B.1
title: "Fix findings 5, 8 y 12: checkout, shipping y footer"
phase: B
status: pending
owner: none
updated: 2026-09-11
contracts: [FB-01, FB-02, FB-06, DB-02, ERR-03]
adrs: [ADR-03, ADR-04]
skills: [vendix-frontend, vendix-backend, how-to-dev]
---
# B.1 — Fix findings 5, 8 y 12: checkout, shipping y footer (F-005, F-008, F-012)

- **Skills:** vendix-frontend, vendix-backend, how-to-dev
- **Resources:** F-005, F-008, F-012, ADR-03, ADR-04, `checkout.component.ts:1766`, `shipping-calculator.service.ts:200`, `ecommerce.component.ts:1565-1610+1790`
- **Business decision:** F-005 solo-comentario (ADR-03, sin tocar logica); F-008 gratis explicito de tienda (ADR-04); F-012 omite footer del save general si `saveFooterOnly()` ok. Comentar en QUI-792.
- **Why:** Los tres tocan el camino feliz de compra/configuracion. Ninguno cambia contratos: comentario, comparacion documentada + etiqueta, y payload condicional.
- **Output:** Comentario reescrito + threshold explicito con etiqueta admin + single-toast + data-check de filas legacy. Cierra F-005, F-008, F-012.
- **Contracts touched:** FB-01, FB-02, FB-06, DB-02, ERR-03 — formas intactas (ver registry).
- **Data impact:** SELECT de inventario en prod para filas threshold<=0 (F-008); sin writes masivos. Resto sin impacto.
- **Blast radius:** Checkout (visualizacion de tarifas), calculo de envio, guardado de ecommerce admin.
- **Rollback:** Revert por commit; el data-check es lectura.
- **Verification:**
  - Playwright/curl: checkout muestra todas las tarifas, sugiere mejor match, permite cambiar sin bloqueo
  - Calculadora con threshold 0/negativo/null: gratis explicito solo donde corresponde + etiqueta en admin
  - Guardar footer: un solo toast; guardar general incluye footer una vez
- **Acceptance checklist:**
  - [ ] Comentario de preseleccion reescrito y seleccion cambiable verificada
  - [ ] Threshold explicito + data-check de prod en evidence/ + etiqueta admin
  - [ ] Doble toast eliminado y findings de este step cerrados en sus records
- **Status:** pending
