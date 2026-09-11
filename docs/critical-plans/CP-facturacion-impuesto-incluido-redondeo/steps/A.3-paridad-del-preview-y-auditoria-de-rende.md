---
id: A.3
title: "Paridad del preview y auditoria de renders"
phase: A
status: in_progress
owner: agent-frontend-renders
updated: 2026-09-11
contracts: [FB-03]
adrs: [ADR-01, ADR-03, ADR-04]
skills: [parallel, agent-teams, vendix-frontend, vendix-zoneless-signals, vendix-currency-formatting, vendix-calculated-pricing]
---
# A.3 — Paridad del preview y auditoria de renders

- **Skills:** parallel, agent-teams, vendix-frontend, vendix-zoneless-signals, vendix-currency-formatting, vendix-calculated-pricing
- **Resources:** `rg -n "lineMath|toFixed|Math.round|Math.floor" apps/frontend/src/app/private/modules/store/invoicing/pages/invoice-create-page/invoice-create-page.component.ts | head -n 25` (workdir repo)
- **Business decision:** El preview espeja el desglose en centavos enteros con la misma cota y fallback ≤bruto, memoizado por línea; los renders usan el snapshot y el display formatea, nunca recalcula.
- **Why:** Va en paralelo con A.2 (archivos disjuntos) porque el usuario ve el preview antes de emitir; la fase adversarial probó que la paridad solo-de-total es falsa y que un loop float congela la pestaña.
- **Output:** `computeLineMath`/`taxBreakdown`/`totals` en centavos con memoización; unidad de tarifa normalizada; agregación multi-línea exacta; POS sin fallback aritmético y con alias de factura; detalle con coerción única y rate normalizado.
- **Contracts touched:** FB-03
- **Data impact:** none — preview en memoria; renders leen snapshot existente.
- **Blast radius:** Formulario, POS-confirmación y detalle; resto del frontend intacto; reglas zoneless/signals respetadas.
- **Rollback:** `git revert` del commit del paso; sin datos afectados.
- **Verification:**
  - Preview $3.000 INC 8%: base 2777.78, impuesto 222.22, total 3000.00
  - Preview $100 IVA 19%: base 84.04, impuesto 15.96 (discriminante)
  - Spec paridad preview==motor en $3.000/$5.000 y multi-línea
- **Acceptance checklist:**
  - [x] Preview en centavos con misma cota y fallback
  - [x] Memoización por línea, costo O(1) por keystroke
  - [x] POS sin fallback float y con alias de factura
  - [x] Detalle con coerción única y rate normalizado
  - [x] Reglas zoneless/signals respetadas
- **Tirilla-scope decision (F-047):** la tirilla nace de la ORDEN (recibo
  pre-fiscal) y SOLO cuando la orden ya tiene factura EMITIDA (no borrador)
  toma desglose + totales de `invoice_taxes` + cabecera de `invoices`
  (`overrideWithInvoiceSnapshot`, nunca lanza: a falta de factura o ante
  error de lectura, filas de orden). Ítems siempre de la orden.
- **Alineación con A.2 (verificada por lectura del diff hermano, sin tocarlo):**
  cota 16 (`INCLUSIVE_ABSORB_MAX_STEPS` == `INCLUSIVE_ABSORB_CAP_CENTS`),
  `is_inclusive === true` estricto, `unclosed_residual_cents` expuesto en
  preview, `INVOICING_CALC_005` (nombre supuesto confirmado) + `CALC_006`
  con copy curada y enumeración de `details` en el banner.
- **Divergencia A.1 a conciliar por A.2:** el caso 3 mixto de
  `tax-inclusive-math.regression.spec.ts` espera base 92592.59 (B0 sin
  absorber); la regla de absorción cierra en 92592.60 con las MISMAS cuotas
  (7407.40/17592.59) y el MISMO total (117592.59). El preview sigue la regla
  (spec A.3 con 92592.60 + nota). Todos los demás esperados A.1 coinciden al
  centavo ($3.000/$5.000/$100/$17/dual/ICA).
- **Verificación hecha en A.3:** paridad aritmética por script node dedicado
  (`/tmp/a3-parity-check.js`, 8 casos OK) + corpus de letras
  (`/tmp/a3-words-check.js`, 19 casos OK incl. ejemplos del docblock del
  backend); `docker logs vendix_backend` sin errores nuevos; `buildcheck.sh
  --watch` RANCIO (ng serve caído, ajeno a este paso — ver bloqueantes).
- **Bloqueantes del paso:** (1) `ng serve` caído (`RANCIO`, bitácora de hace
  33 h): el ciclo OK del frontend queda pendiente de quien levante el watcher
  o del CI; (2) suite Karma no corrida en máquina (presupuesto de memoria del
  skill `buildcheck-dev`); los specs A.3 corren en CI.
  - [x] F-002 — Preview tercera implementacion en floats sin truncado (major)
  - [x] F-011 — Paridad del preview solo de total (major)
  - [x] F-012 — Preview sin truncado ni loop, paridad falsa (blocker)
  - [x] F-015 — Preview suma floats en N lineas vs truncado servidor (minor)
  - [x] F-018 — Decimal como string en el boundary del detalle (major)
  - [x] F-019 — tax_rate crudo muestra fraccion como porcentaje (minor)
  - [x] F-040 — Loop float en preview congela la pestana (major)
  - [x] F-047 — Tirilla POS lee snapshot de orden, no de factura (major)
  - [x] F-048 — Confirmacion POS muestra impuesto float previo (major)
  - [x] F-050 — Fallback con OR recalcula total cero legal (note)
  - [ ] F-051 — Reimpresion pre-fix sin marca de regimen (note) — NO abordado
    en A.3: distinguir pre/post-fix exige un marcador de versión del kernel
    que el snapshot no trae; cualquier heurística (fecha, descuadre) daría
    falsos positivos sobre documentos legales. Se deja al orquestador/B.1.
  - [x] F-052 — Total corregido sin anuncio live-region (note)
  - [x] F-054 — Badge IVA incluido solo via title (note)
  - [x] F-057 — Disclaimer referencia contradice paridad (major)
  - [x] F-058 — Sin ayuda sobre base movida 1c (major)
  - [x] F-066 — Fallback de impresion sin log (minor)
  - [ ] F-002 — Preview tercera implementacion en floats sin truncado (major)
  - [ ] F-011 — Paridad del preview solo de total (major)
  - [ ] F-012 — Preview sin truncado ni loop, paridad falsa (blocker)
  - [ ] F-015 — Preview suma floats en N lineas vs truncado servidor (minor)
  - [ ] F-018 — Decimal como string en el boundary del detalle (major)
  - [ ] F-019 — tax_rate crudo muestra fraccion como porcentaje (minor)
  - [ ] F-040 — Loop float en preview congela la pestana (major)
  - [ ] F-047 — Tirilla POS lee snapshot de orden, no de factura (major)
  - [ ] F-048 — Confirmacion POS muestra impuesto float previo (major)
  - [ ] F-050 — Fallback con OR recalcula total cero legal (note)
  - [ ] F-051 — Reimpresion pre-fix sin marca de regimen (note)
  - [ ] F-052 — Total corregido sin anuncio live-region (note)
  - [ ] F-054 — Badge IVA incluido solo via title (note)
  - [ ] F-057 — Disclaimer referencia contradice paridad (major)
  - [ ] F-058 — Sin ayuda sobre base movida 1c (major)
  - [ ] F-066 — Fallback de impresion sin log (minor)
- **Status:** pending
