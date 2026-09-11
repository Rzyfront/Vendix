---
id: R.2
title: "Revalidar findings 8-15 y validacion normativa DIAN"
phase: R
status: done
owner: none
updated: 2026-09-11
contracts: []
adrs: [ADR-06]
skills: [vendix-backend, vendix-tax-typing, vendix-frontend, pr-code-review]
---
# R.2 — Revalidar findings 8-15 y validacion normativa DIAN

- **Skills:** vendix-backend, vendix-tax-typing, vendix-frontend, pr-code-review
- **Resources:** Mismos que R.1 + `credit-notes.service.ts:339-356`, `ubl-common.builder.ts`, specs `credit-notes.*.spec.ts`, anexo tecnico DIAN vigente para NC/ND
- **Business decision:** F-010 es critico-normativo por directiva de usuario: no se reescribe ni un byte fiscal sin validar UBL, totales vs lineas y derivacion por kernel. El veredicto de R.2 cierra ADR-06 (proposed → accepted).
- **Why:** F-008/F-009 tocan dinero y privacidad sobre datos existentes; F-010 toca documentacion fiscal que orienta futuras emisiones. Todo debe quedar ratificado con evidencia.
- **Output:** `evidence/r2-<n>.md` por finding + `evidence/r2-dian-ncnd.md` (matriz normativa) y ADR-06 cerrado.
- **Contracts touched:** none — revalidacion de solo lectura, cero cambios de runtime.
- **Data impact:** none — solo lectura (el data-check de prod de F-008 es SELECT de inventario).
- **Blast radius:** Ninguno (no se modifica codigo).
- **Rollback:** N/A — no hay cambios.
- **Verification:**
  - `SELECT id FROM shipping_rates WHERE free_shipping_threshold <= 0 AND is_active` en prod-replica (F-008, inventario)
  - `git diff origin/main..origin/develop -- pqr.service.ts | sed -n '1,40p'` confirma gate eliminado (F-009)
  - Traza completa NC parcial: `buildNotePayload` → `POST :id/issue` → `derivePartialNoteLinesViaKernel` → UBL, con spec en verde (F-010)
  - `rg -c "invoice-tax-catalog.service.ts" apps/backend/src` vacio + `rg -n "toPercent" apps/frontend` localiza el real (F-011)
  - Head de ecommerce.component.ts L1565-1610 + 1790 (F-012), diff de los 3 archivos prep-min (F-013)
  - `sed -n '280,295p' add-rate-wizard-modal` y `sed -n '180,190p' pqr-submit.component.ts` (F-014/F-015)
- **Acceptance checklist:**
  - [x] F-008 — Threshold cero cambia envio gratis en filas existentes (minor)
  - [x] F-009 — Tracking publico sirve PQRs de tiendas enumerables (major)
  - [x] F-010 — Header de notas contradice derivacion por kernel (major)
  - [x] F-011 — normalizeRatePercent cita espejo inexistente (minor)
  - [x] F-012 — Footer se guarda dos veces con doble toast (minor)
  - [x] F-013 — Prep-min inconsistente entre vitrinas (minor)
  - [x] F-014 — base_cost con OR-cero enmascara NaN (minor)
  - [x] F-015 — parseInt sobre ids tipados string (minor)
  - [x] Matriz normativa DIAN en evidence/ y ADR-06 en accepted con el contrato validado
- **Status:** done — oleada 1 cerrada 2026-09-11
