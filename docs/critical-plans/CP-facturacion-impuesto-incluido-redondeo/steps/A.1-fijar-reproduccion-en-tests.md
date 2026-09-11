---
id: A.1
title: "Fijar reproduccion en tests"
phase: A
status: done
owner: none
updated: 2026-09-11
contracts: []
adrs: [ADR-01]
skills: [vendix-calculated-pricing, vendix-tax-typing, vendix-currency-formatting]
---
# A.1 — Fijar reproduccion en tests

- **Skills:** vendix-calculated-pricing, vendix-tax-typing, vendix-currency-formatting
- **Resources:** `npx jest src/domains/store/taxes/utils/tax-inclusive-math.regression.spec.ts --runInBand` (workdir `apps/backend`)
- **Business decision:** El total cobrado (precio publicado) es la verdad comercial; base + impuestos truncados no pueden redefinir el total ni las letras. [Critical decision]
- **Why:** Va primero porque el fix no es aprobable sin una reproducción que hoy dé 2999.99/4999.98 y tras el fix dé 3000.00/5000.00; la fase adversarial agregó los casos que discriminan (multi-tasa, ICA, descuentos, inválidos).
- **Output:** Matriz A.6 + spec del motor extendidas y en rojo: $3.000/$5.000 INC 8%, $17 INC 8% (terminación), 19+8 y 19+5, ICA por mil inclusivo, $100 IVA 19% (discriminante), discount==/>gross, NaN/''/Infinity/locale, flags string, paridad multi-línea y mixta, paridad checkout-vs-motor qty>1.
- **Contracts touched:** none — solo specs, sin delta de contrato.
- **Data impact:** none — sin mutación de datos, solo archivos de test.
- **Blast radius:** Specs del dominio: si un esperado vigente cambia fuera de los casos del bug, el paso se detiene (gate de no-regresión del usuario).
- **Rollback:** Revert del commit del paso (`git revert`); sin datos afectados.
- **Verification:**
  - `npx jest src/domains/store/taxes/utils/tax-inclusive-math.regression.spec.ts --runInBand` falla solo en los casos nuevos (workdir `apps/backend`)
- **Acceptance checklist:**
  - [x] Caso $3.000 INC 8% da 2999.99 hoy y espera 3000.00
  - [x] Caso $5.000 INC 8% da 4999.98 hoy y espera 5000.00
  - [x] Casos $17, 19+8, ICA por mil y descuentos en rojo
  - [x] Casos inválidos/stringy y paridad en rojo
  - [x] Ningún esperado vigente fue reescrito
- **Status:** done · orquestador · 2026-09-11 · evidence/A.1-regression-spec.log + evidence/A.1-calculator-spec.log (16+20 fallos nuevos, 16+95 vigentes en verde) + commit 65364f31e
