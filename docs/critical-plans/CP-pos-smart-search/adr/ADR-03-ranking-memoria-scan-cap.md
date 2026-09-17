---
id: ADR-03
title: "Ranking en memoria con scan-cap y fail-open (Fase A)"
status: proposed
reversibility: trivial
updated: 2026-09-17
---
# ADR-03 — Ranking en memoria con scan-cap y fail-open (Fase A)

- **Context:** Rankear exige ordenar antes de paginar. Opciones: re-rank de página (barato, orden global mal) o 2 queries con cap (correcto, 2× scan). El repo ya resolvió esto con resolveBestSellingPageIds + BEST_SELLING_SCAN_CAP + degradación fail-open.
- **Decision:** Misma forma que resolveBestSellingPageIds, select más ancho (nunca "verbatim"): gate `search && !barcode` (todos los callers, F-001); score primario + featured boost + best_selling suprimido con search; two-tier (producto, luego variantes top-K); skip-count si ≤cap; caché Redis id-list TTL 30-60s; slice clampado a @Max; degrade (cap o throw) → orderBy + warn + counter + meta.search. SMART_SEARCH_SCAN_CAP=2000 co-ubicado con BEST_SELLING (5000) y justificado; flag Fase A gateado por tamaño de catálogo.
- **Consequences:** Orden global correcto por construcción; sobre el cap se pierde ranking pero no resultados, con señal (chip UI + alerta). findIds hereda el where (mismo conjunto) sin verse afectado por el orden.
- **Reversibility:** trivial — rama nueva en findAll tras flag L2 obligatorio (A.0); off restaura orderBy en siguiente request (≤TTL).
- **Revisit if:** p95 supera 300ms en staging con catálogos reales; entonces bajar el cap o adelantar Fase B.
