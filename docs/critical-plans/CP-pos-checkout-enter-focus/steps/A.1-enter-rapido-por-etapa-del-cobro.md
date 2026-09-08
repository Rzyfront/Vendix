---
id: A.1
title: "Enter rapido por etapa del cobro"
phase: A
status: pending
owner: none
updated: 2026-09-08
contracts: []
adrs: []
skills: []
---
# A.1 — Enter rapido por etapa del cobro

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-angular-forms
- **Resources:** `npx tsc --noEmit --skipLibCheck --target es2022 --moduleResolution bundler --module esnext apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.ts` · specs del shell con el runner del repo
- **Business decision:** Toda etapa preseleccionada del cobro (consumo/entrega, anónima, contado, efectivo, total) se recorre con Enter; un Enter nunca confirma sin gate ni dispara dos submits.
- **Why:** Es el núcleo del pedido y va primero porque A.2 (foco) asume que el modal ya se opera por teclado; sin esto el cajero sigue atado al mouse en el cobro.
- **Output:** Shell enfoca el panel activo al abrir; Enter en SELECT no avanza; collector confirma/avanza su propio Enter en inputs sin duplicar con el shell.
- **Contracts touched:** none — frontend-only, sin contrato frontend↔backend tocado.
- **Data impact:** none — no se crea ni muta dato; solo navegación y confirmación por teclado bajo los gates existentes.
- **Blast radius:** Cobro POS por teclado; un error duplica cobros o salta validación — lo detectan los specs del shell y el recorrido manual.
- **Rollback:** `git revert` del commit del run (checkpoint `checkpoint/parallel-pos-enter`).
- **Verification:**
  - Specs del shell en verde (casos Enter existentes + nuevos).
  - Recorrido manual https://vendix.com: cobro con defaults solo con Enter hasta Cobrar.
- **Acceptance checklist:**
  - [ ] Al abrir el modal, el foco entra al panel activo (primer Enter avanza Consumo)
  - [ ] Enter sobre SELECT no avanza el wizard
  - [ ] Enter en efectivo/total confirma sin clic y sin doble submit
  - [ ] Enter con gate cerrado destella en vez de avanzar
  - [ ] Specs del shell en verde
- **Status:** pending
