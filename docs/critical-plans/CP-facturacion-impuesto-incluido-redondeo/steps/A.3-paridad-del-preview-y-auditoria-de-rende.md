---
id: A.3
title: "Paridad del preview y auditoria de renders"
phase: A
status: done
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
- **Output:** `computeLineMath`/`taxBreakdown`/`totals` en centavos con memoización; unidad de tarifa normalizada; agregación multi-línea exacta; POS sin fallback aritmético y con alias de factura; detalle con coerción única y rate normalizado. Tirilla: nace de la orden y solo con factura emitida toma desglose de `invoice_taxes`. Commit 164f96a10. Notas del agente: ver Convergence-Log-A.3 en el log de ejecución.
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
  - [x] F-052 — Total corregido sin anuncio live-region (note)
  - [x] F-054 — Badge IVA incluido solo via title (note)
  - [x] F-057 — Disclaimer referencia contradice paridad (major)
  - [x] F-058 — Sin ayuda sobre base movida 1c (major)
  - [x] F-066 — Fallback de impresion sin log (minor)
- **Status:** done · orquestador · 2026-09-11
