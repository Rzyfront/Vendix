---
id: ADR-04
title: "Residual inalcanzable closest-below con codigo"
status: proposed
reversibility: costly
updated: 2026-09-11
---
# ADR-04 — Residual inalcanzable closest-below con codigo

- **Context:** Algunas combinaciones (multi-tasa inclusiva, descuentos que dejan brutos no representables) no admiten cierre exacto: `f(base)` salta el bruto por escalón. Las opciones son persistir el corto en silencio, sobrecobrar 1¢ o bloquear.
- **Decision:** Al agotar la cota se persiste la mejor base con `f ≤ bruto` (closest-below, jamás overshoot) y se emite divergencia tipada que bloquea con 422 antes de numerar (cableada en `recalculateDocument` + gate en `invoice-flow` para drafts previos); el espejo expone `unclosed_residual` y checkout/POS lo bloquean antes de capturar. El frontend suma la rama del código a `ERROR_MESSAGES` y enumera `details.blockers[]`.
- **Consequences:** Ningún documento nace descuadrado en silencio ni sobrecobra; los casos exóticos fallan fuerte y visible en vez de quemar consecutivo en DIAN; ERR-02 se redacta como bloqueo post-numeración salvo el pre-chequeo aritmético que B.1 agrega.
- **Reversibility:** costly — cambia el contrato de errores de emisión.
- **Revisit if:** La DIAN publicara regla de reparto distinta para el escalón, o el usuario prefiriera absorber el escalón en un ajuste declarado en vez de bloquear.
