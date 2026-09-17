---
id: ADR-09
title: "DTO hardening + search overrides sort_by"
status: proposed
reversibility: trivial
updated: 2026-09-17
---
# ADR-09 — DTO hardening + search overrides sort_by

- **Context:** ProductQueryDto sin cotas (page/limit, search, booleanos con coerción rota, numéricos vacíos→0, ids[] semántica libre) convierte input trivial en 5xx o envoltorios contradictorios; sort_by sin RELEVANCE choca con ranking server-side.
- **Decision:** ProductQueryDto: `@Min(1)` page/limit (+`@Max` que talla bulk `/ids`: bound solo con search o bulk vía /ids), `@MaxLength(200)`+trim+empty→undefined en search (overlong→400 SYS_VALIDATION_001), migrar `pos_optimized` (mínimo) al patrón `@Transform` raw obj[key], empty→undefined en numéricos + `@Min(1)` en ids FK, pin `ids=[]`→undefined + `@ArrayMaxSize`. CatalogQueryDto: `@MaxLength(200)`+trim en search + validación x-store-id (entero positivo; missing→404/400 en service). `search` presente overridea `sort_by` (documentado, sin nuevo enum). Token-cap en helper con wrappers nombrados (interno 6 / público 4).
- **Consequences:** Frontera explícita fail-fast; catálogo clamp 200 client-side para no 400 por tipeo; bulk preservado.
- **Reversibility:** trivial — DTO-only, revert por campo.
- **Revisit if:** 400 legítimos por MaxLength superan umbral; entonces subir a 300 o truncar.
