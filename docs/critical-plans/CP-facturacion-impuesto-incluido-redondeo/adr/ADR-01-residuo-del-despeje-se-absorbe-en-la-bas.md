---
id: ADR-01
title: "Residuo del despeje se absorbe en la base"
status: proposed
reversibility: costly
updated: 2026-09-11
---
# ADR-01 — Residuo del despeje se absorbe en la base

- **Context:** El doble truncado deja `B + Σcuotas` 1–2¢ bajo el bruto ($3.000→2999.99, $5.000→4999.98 con INC 8%). La fase adversarial probó que un loop de igualdad abierto no termina en 7–21% de montos enteros ($17 INC 8%: 1699→1701) y que replicar el loop en motor, espejo y preview diverge por construcción.
- **Decision:** Un solo kernel puro en la hoja `dian-money.util.ts` (ya importada por ambos lados, sin ciclo): búsqueda acotada en centavos que conserva la mayor base con `f(base) ≤ bruto`, con `f` = base + Σ `trunc(base×r)`; `resolveTaxableBase`, `resolveLineTotals` y el espejo de preview como llamadas delgadas. Cota fija pequeña, precondiciones fail-closed (finitud, `bruto=max(0,neto)`, booleano estricto, `rate_basis` normalizada, `tax_type` en whitelist, `price_unit_quantity` entero ≥1) y carve-outs explícitos: líneas AIU-contrato, de base fija y `omit_tax_total` quedan fuera del loop con regresión byte-idéntica. Granularidad canónica: bruto de línea (checkout llama una vez por línea). Escala de catálogo aplicada antes del despeje e invariante del loop.
- **Consequences:** Una sola invariante y un solo dueño; el loop termina por construcción; lo inalcanzable cae en la política de ADR-04 en vez de colgar o sobrecobrar; el preview espeja en centavos con matriz de paridad compartida contra el motor.
- **Reversibility:** costly — revierte la aritmética del motor, su espejo y el preview a la vez, o divergen.
- **Revisit if:** La DIAN exigiera base exacta sin absorción, o el loop no convergiera dentro de la cota para alguna tasa soportada.
