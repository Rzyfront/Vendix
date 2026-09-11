---
id: A.2
title: "Corregir motor y espejo en paralelo"
phase: A
status: done
owner: none
updated: 2026-09-11
contracts: [DB-01, DB-02, DB-03]
adrs: [ADR-01, ADR-03, ADR-04]
skills: [parallel, agent-teams, vendix-calculated-pricing, vendix-tax-typing, vendix-currency-formatting, vendix-error-handling]
---
# A.2 — Corregir motor y espejo en paralelo

- **Skills:** parallel, agent-teams, vendix-calculated-pricing, vendix-tax-typing, vendix-currency-formatting, vendix-error-handling
- **Resources:** `git rev-parse HEAD` + `git status --short --branch` (checkpoint, sin checkout por restricción); `npx jest src/domains/store/invoicing/services/invoice-calculator.service.spec.ts --runInBand` (workdir `apps/backend`)
- **Business decision:** Kernel único en `dian-money.util.ts` (búsqueda acotada, mejor base con `f ≤ bruto`, jamás overshoot); precondiciones fail-closed; AIU-contrato, base fija y `omit_tax_total` fuera del loop; exhausto a divergencia tipada con 422 pre-numeración; aceptadas intactas. [Critical decision]
- **Why:** Va tras A.1 y en paralelo (agente A: kernel+motor+gate; agente B: espejo+checkout) porque son archivos disjuntos; la fase adversarial probó que replicar el loop a mano diverge y que la igualdad abierta no termina.
- **Output:** Kernel + llamadas delgadas + `unclosed_residual` en el espejo + rama divergencia→throw en `recalculateDocument` + normalizaciones (rate_basis, booleano estricto, tax_type, puq) + granularidad por línea en checkout; scopes disjuntos, commit temprano, revert pareado.
- **Contracts touched:** DB-01, DB-02, DB-03
- **Data impact:** Snapshot futuro con base absorbida; histórico intacto, sin migración ni backfill; retenciones nuevas derivan de la base absorbida (nota contable, no código).
- **Blast radius:** Emisión inclusiva/mixta; exclusivo/agregado/AIU-contrato byte-idénticos; fallback documentado: revert+redeploy, periodo mixto aceptado e identificable por query.
- **Rollback:** `git revert` pareado de ambos SHAs en un solo commit (nunca parcial); latencia de fallback = revert+redeploy por gates; periodo mixto aceptado.
- **Verification:**
  - `npx jest src/domains/store/invoicing/services/invoice-calculator.service.spec.ts --runInBand` en verde (workdir `apps/backend`)
  - `npx jest src/domains/store/taxes/utils/tax-inclusive-math.regression.spec.ts --runInBand` en verde (workdir `apps/backend`)
  - Spec del throw pre-`generateNextNumber` con residual inalcanzable forzado
- **Acceptance checklist:**
  - [ ] $3.000/8% → base 2777.78, cuota 222.22, total 3000.00
  - [ ] $5.000/8% → base 4629.63, cuota 370.37, total 5000.00
  - [ ] $17/8% termina sin colgar ni sobrecobrar
  - [ ] Kernel único en hoja; motor y espejo delgados
  - [ ] Cota fija + precondiciones + carve-outs con regresión
  - [ ] Rama divergencia→throw pre-numeración con spec
  - [ ] Checkout por línea en centavos/Decimal con paridad
  - [ ] Sin `checkout`/`switch`/`reset`/`clean` en el run
  - [x] F-001 — Loop del centavo con segundo dueno en vez de uno (major)
  - [x] F-004 — Dueno unico con dos puertas facade e import directo (minor)
  - [x] F-005 — Posicion del loop frente a AIU y cuotas fijas sin definir (note)
  - [x] F-006 — Loop de igualdad no termina con totales salteados (blocker)
  - [x] F-007 — Lineas multi-inclusivas saltean el objetivo (blocker)
  - [x] F-008 — Loop identico inimplementable entre firmas distintas (major)
  - [x] F-009 — Granularidad por unidad del espejo vs por linea del motor (major)
  - [x] F-010 — Lineas AIU contrato contradicen el loop (major)
  - [x] F-013 — Unidad de tarifa percent vs fraccion ambigua (major)
  - [x] F-014 — is_inclusive omitido hace mixtas dependientes del orden (major)
  - [x] F-021 — Loop falso para AIU contrato, cuotas de fraccion (major)
  - [x] F-024 — Base de retencion crece con la base absorbida (note)
  - [x] F-026 — Divergencia de exhausto muere en warn-only (blocker)
  - [x] F-028 — Espejo sin canal de error para exhausto (major)
  - [x] F-032 — ICA per-mil sin unidad definida en el loop (major)
  - [x] F-033 — Cota y fail-closed del loop sin especificar (major)
  - [x] F-034 — Descuento mayor que precio rompe el cierre (major)
  - [x] F-035 — Tres predicados distintos para is_inclusive (major)
  - [x] F-036 — Numericos invalidos fallan abiertos a cero (major)
  - [x] F-037 — price_unit_quantity basura aceptada en silencio (minor)
  - [x] F-039 — Igualdad inalcanzable en 7-21 porciento de montos (blocker)
  - [x] F-041 — Round-trip string por trunc en el loop caliente (minor)
  - [x] F-042 — Doble resolucion fiscal por linea en checkout (minor)
  - [x] F-043 — Rechazo de exhausto sin archivo dueno (major)
  - [x] F-044 — Sin kill-switch para la aritmetica nueva (major)
  - [x] F-045 — Revert parcial re-diverge motor y espejo (minor)
  - [x] F-060 — Divergencia tipada sin cable bloqueante (blocker)
  - [x] F-061 — Espejo persiste corto sin log en cobro (major)
  - [x] F-062 — Sanitizadores borran evidencia fail-closed (major)
  - [x] F-064 — Centavo absorbido inauditable por tolerancia (major)
  - [x] F-065 — Warn por linea sin agregacion documental (minor)
- **Status:** done · orquestador · 2026-09-11
