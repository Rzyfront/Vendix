---
id: B.1
title: "Banner y notificación contextual de contingencia fiscal"
phase: B
status: done
owner: rzy
updated: 2026-09-10
contracts: [ERR-01, ERR-02]
adrs: [ADR-02]
skills: [vendix-frontend, vendix-ui-ux, vendix-zoneless-signals]
---
# B.1 — Banner y notificación contextual de contingencia fiscal

- **Skills:** vendix-frontend, vendix-ui-ux, vendix-zoneless-signals
- **Resources:** apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts
- **Business decision:** Informar con total claridad al cajero si se emitió un ticket de contingencia debido a fallo fiscal o timeout, impidiendo que culpe al subsistema de impresión.
- **Why:** Si el sistema imprime silenciosamente un ticket de venta en lugar de la factura electrónica esperada, el cajero sospecha que la impresora falló o que el software perdió la venta fiscal.
- **Output:** Alerta contextual en el modal y toast de advertencia detallando por qué se imprimió el comprobante de contingencia.
- **Contracts touched:** none — Modificación interna en template y señales de PosOrderConfirmationComponent
- **Data impact:** none — Elementos visuales y de notificación en UI.
- **Blast radius:** Mínimo; confinado exclusivamente a la vista de confirmación del POS.
- **Rollback:** `git checkout HEAD -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts`
- **Verification:**
  - `npm run test -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.spec.ts`
- **Acceptance checklist:**
  - [x] Implementar señal `fiscalFallbackNotice` con mensaje descriptivo de la causa
  - [x] Agregar banner visual de advertencia en el modal cuando ocurra degradación
  - [x] Emitir Toast de advertencia con el motivo específico de contingencia
  - [x] F-004 — Indicador visual en UI mientras la auto-impresion espera a la DIAN (minor)
- **Status:** done
