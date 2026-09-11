---
id: A.2
title: "Fix findings 3 y 9: PQR a comportamiento seguro"
phase: A
status: done
owner: none
updated: 2026-09-11
contracts: [FB-03, FB-04, DB-03, DB-04, ERR-04]
adrs: [ADR-05]
skills: [vendix-frontend, vendix-backend, vendix-notifications-system, how-to-dev]
---
# A.2 — Fix findings 3 y 9: PQR a comportamiento seguro (F-003, F-009)

- **Skills:** vendix-frontend, vendix-backend, vendix-notifications-system, how-to-dev
- **Resources:** F-003, F-009, ADR-05, `pqr-detail-page.component.ts`, `pqr.service.ts:242`, `pqr-notifications.listener.ts` (F-006 se corrige en B.2)
- **Business decision:** Directiva de usuario: default interno (F-003) y lo publico solo trackea lo publico (F-009, ADR-05). Ambos son privacidad: van juntos en un mismo cambio PQR.
- **Why:** Fail-open de notificacion + enumeracion cross-tienda en el mismo flujo. El fix restaura los dos gates sin cambiar contratos: mismos endpoints, mismos DTOs.
- **Output:** Defaults revertidos + gate de plataforma en tracking publico + specs existentes en verde. Cierra F-003 y F-009.
- **Contracts touched:** FB-03, FB-04, DB-03, DB-04, ERR-04 — sin cambios de forma, solo de filtro/default (ver registry).
- **Data impact:** none — sin migracion; solo lectura filtrada y defaults de UI.
- **Blast radius:** Flujo PQR (admin + tracking publico). Tiendas que usaban el link publico pierden acceso: comunicar + alternativa en admin.
- **Rollback:** Revert del commit; los datos no cambian.
- **Verification:**
  - UI: composer abre en interno sin aviso; comentario publico exige accion explicita
  - `curl` tracking publico con ticket de tienda → 404; con ticket de plataforma → 200
  - Suites `pqr.service.spec` + listener en verde
- **Acceptance checklist:**
  - [x] Defaults internos restaurados y gate publico reaplicado
  - [x] Matriz curl publico/tienda/plataforma en evidence/ con 404/200 esperados
  - [x] Specs PQR en verde y findings de este step cerrados en sus records
- **Status:** done — verificado y consolidado 2026-09-11
