---
id: A.1
title: "Reproducir stale y fijar inventario"
phase: A
status: pending
owner: none
updated: 2026-09-11
contracts: []
adrs: []
skills: [vendix-frontend, vendix-zoneless-signals, parallel, agent-teams]
---
# A.1 — Reproducir stale y fijar inventario

- **Skills:** vendix-frontend, vendix-zoneless-signals, parallel, agent-teams
- **Resources:** `git rev-parse HEAD` + `git status --short` (anchor 7e2dd0e limpio, sin checkout)
- **Business decision:** Ningún fix sin repro registrado; el bug fiscal se demuestra antes de tocar código.
- **Why:** Va primero porque todo el diseño depende de confirmar que el stale nace en el selector y no en el backend.
- **Output:** `evidence/repro-a-luego-b.md` con pasos y `inventory/` cerrado contra la causa raíz.
- **Contracts touched:** none — paso solo de lectura y reproducción en dev.
- **Data impact:** none — read-only, ventas de prueba en dev si se ejecutan.
- **Blast radius:** Si se omite, el fix ataca el lugar equivocado y la factura sigue saliendo a A.
- **Rollback:** `git revert` no aplica; no hay cambios de código en este paso.
- **Verification:**
  - `grep -n "if (this.selectedCustomer" apps/frontend/src/app/private/modules/store/pos/components/pos-customer-selector/pos-customer-selector.component.ts`
- **Acceptance checklist:**
  - [ ] Early-return 390-393 citado con file:line en la evidencia
  - [ ] Traza seleccionar-A-crear-B-Siguiente-Pagar registrada
  - [ ] `inventory/files.md` sin wildcards y verificado
  - [ ] `inventory/assets.md` con reutilizables o razón
  - [ ] Rama sigue en develop sin checkout durante el paso
- **Status:** pending
