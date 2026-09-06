---
id: A.2
title: "Gating por industria construction"
phase: A
status: done
owner: agent-4
updated: 2026-09-06
contracts: [FB-02, ERR-03]
adrs: [ADR-02]
skills: [vendix-panel-ui, vendix-permissions, vendix-frontend]
---
# A.2 — Gating por industria construction

- **Skills:** vendix-panel-ui, vendix-permissions, vendix-frontend
- **Resources:** apps/frontend/src/app/shared/constants/industry-modules.constant.ts:113, menu/filter services, backend guards de quotations/contracts
- **Business decision:** Contratos y destino contrato solo para stores con industria `construction` (ADR-02).
- **Why:** El flujo AIU es regimen especial; mostrarlo a retail/restaurant ensena a ignorar el menu y abre errores fiscales.
- **Output:** Modulo contratos oculto sin `construction`; backend 403 sin la industria aunque se manipule la UI.
- **Contracts touched:** FB-02, ERR-03
- **Data impact:** none — solo visibilidad y autorizacion, cero filas mutadas.
- **Blast radius:** Menu y guards. Si el gating falla por exceso, constructoras no ven el flujo; por defecto, industrias ajenas lo ven.
- **Rollback:** Revertir lista de ocultos y guard; cambio de configuracion sin migracion.
- **Verification:**
  - Store sin `construction` no lista modulo contratos y `POST` devuelve 403
  - Store `construction` ve modulo y opera normal
- **Acceptance checklist:**
  - [x] Sin industria no hay menu ni API de contratos (403 verificado)
  - [x] Con `construction` el flujo completo es visible
  - [x] Multi-industria conserva el modulo por semantica OR
- **Status:** done (evidencia en evidence/A.2-gating-evidence.md)
