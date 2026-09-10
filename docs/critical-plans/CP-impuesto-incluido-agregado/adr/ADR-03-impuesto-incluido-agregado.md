---
id: ADR-03
title: "Alcance solo-producto; catalogo como default, no como switch"
status: accepted
reversibility: trivial
updated: 2026-09-10
---
# ADR-03 — Alcance solo-producto; catálogo como default, no como switch

- **Context:** El usuario decidió el 2026-09-10 (respuesta directa): alcance "Solo producto"; el catálogo NO se convierte en switch de cálculo en este plan.
- **Decision:** Este plan NO cambia el comportamiento de `tax_categories.is_inclusive` como interruptor global: ningún cálculo leerá el flag del catálogo en el momento de la venta. Solo se usa como valor heredado al crear asignaciones (backfill + default de escritura) y como valor mostrado inicial en los chips antes de guardar.
- **Consequences:** Riesgo acotado: productos históricos sin mapa explícito conservan el tratamiento de su catálogo vía backfill (sin sorpresas de totales), y el resto sigue agregado como hoy. El switch global de catálogo queda como trabajo futuro explícito, no como efecto colateral.
- **Reversibility:** trivial — es una decisión de alcance, se revierte abriendo un plan nuevo.
- **Revisit if:** el usuario pide que cambiar el catálogo recalcule ventas futuras automáticamente.
