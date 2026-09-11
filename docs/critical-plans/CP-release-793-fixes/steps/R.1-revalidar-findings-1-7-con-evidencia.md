---
id: R.1
title: "Revalidar findings 1-7 con evidencia"
phase: R
status: done
owner: none
updated: 2026-09-11
contracts: []
adrs: []
skills: [vendix-frontend, vendix-backend, vendix-zoneless-signals, pr-code-review]
---
# R.1 — Revalidar findings 1-7 con evidencia

- **Skills:** vendix-frontend, vendix-backend, vendix-zoneless-signals, pr-code-review
- **Resources:** PR #793 (base c715d5a, head 0785a42), `git diff origin/main..origin/develop`, archivos del slice en checkout local
- **Business decision:** Ningun fix arranca sobre un falso positivo. Ronda 0 del orquestador ya confirmo F-001/F-002/F-003/F-004/F-005; este step la hace repetible y cierra F-006/F-007.
- **Why:** Los findings nacieron de 4 revisiones delegadas; el Evidence Gate exige que cada uno tenga comando de verificacion y salida guardada antes de codificar.
- **Output:** `evidence/r1-<n>.md` por finding (comando + salida + veredicto confirma/descarta) y findings actualizados.
- **Contracts touched:** none — revalidacion de solo lectura, cero cambios de runtime.
- **Data impact:** none — solo lectura.
- **Blast radius:** Ninguno (no se modifica codigo).
- **Rollback:** N/A — no hay cambios.
- **Verification:**
  - `node -e` transpile con el TS del repo sobre invoice-detail y invoice-create-page: 0 errores tras A.1; hoy 11 (F-001)
  - `git diff origin/main..origin/develop -- pqr-detail-page.component.ts | grep -E '^[-+].*signal\('` muestra el flip (F-003)
  - `grep -rn "'abandoned'" apps/backend/src --include='*.ts' | grep -v spec` sin escritores (F-002)
  - `sed -n '40p' toggle.component.ts` + `sed -n '1766p' checkout.component.ts` (F-004/F-005)
  - `sed -n '296,302p;243,254p' pqr-notifications.listener.ts` vs seed de roles (F-006)
  - `rg -n "toLocaleString" pos-sale-ticket.provider.ts` vs `money()` del mapper (F-007)
- **Acceptance checklist:**
  - [x] F-001 — Backticks sin escapar rompen ng build (blocker)
  - [x] F-002 — Metrica de abandonados lee cero estructural (major)
  - [x] F-003 — Default de comentario PQR paso a publico fail-open (major)
  - [x] F-004 — Toggle OFF habilitado pinta rojo en toda la app (major)
  - [x] F-005 — Checkout preselecciona primera tarifa contra comentario (minor)
  - [x] F-006 — Listener PQR no matchea roles canonicos (minor)
  - [x] F-007 — Tirilla POS sin 2 decimales pineados (minor)
  - [x] Cada finding conserva evidencia en evidence/ o se marca Descartado con autorizador
- **Status:** done — oleada 1 cerrada 2026-09-11
