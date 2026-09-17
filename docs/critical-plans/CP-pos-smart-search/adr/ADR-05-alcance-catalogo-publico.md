---
id: ADR-05
title: "Alcance incluye catálogo público con safeguards"
status: proposed
reversibility: trivial
updated: 2026-09-17
---
# ADR-05 — Alcance incluye catálogo público con safeguards

- **Context:** El usuario eligió alcance total incluyendo /ecommerce/catalog (pregunta Alcance, 2026-09-17). Es superficie pública sin auth con OR defectuoso propio en catalog.service.ts:97-102.
- **Decision:** Incluir FB-12 con: (1) mismo helper tokenizado (sin duplicar lógica), (2) tope de tokens más bajo (4) y limit ya paginado, (3) sin scoring semántico ni fuzzy caro, (4) verificación de latencia p95 en staging antes de merge. Ajustes (FB-10) y traslados (FB-11) también entran con L1+L2, sin L3 (conteo físico no admite parecido).
- **Consequences:** Un solo motor de normalización para 4 superficies. Riesgo público acotado por topes y medición previa. Más specs que actualizar (catalog.service.spec).
- **Reversibility:** trivial — cada superficie conserva su rama legacy tras flag; revert por superficie.
- **Revisit if:** p95 público supera el presupuesto o aparecen patrones de abuso; entonces rate-limit o exclusión del catálogo.
