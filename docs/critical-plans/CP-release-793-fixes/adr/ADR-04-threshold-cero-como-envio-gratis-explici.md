---
id: ADR-04
title: "Threshold cero como envio gratis explicito de la tienda"
status: accepted
reversibility: costly
updated: 2026-09-11
---
# ADR-04 — Threshold cero como envio gratis explicito de la tienda

- **Context:** F-008: el gratis con threshold 0 nacia de un accidente (`Decimal` truthy), no de una decision. Directiva de usuario: el envio gratis puede existir como decision de la tienda, pero forzada/explicita.
- **Decision:** Codigo explicito: threshold 0 significa gratis deliberado (comparacion documentada, no truthiness), etiqueta "Envio gratis" visible en el admin, y data-check de filas 0/negativas en prod antes del release.
- **Consequences:** Se preserva el gratis intencional y se elimina el gratis accidental; filas legacy ambiguas quedan inventariadas.
- **Reversibility:** costly — cambia semantica de datos existentes; revertir exige re-clasificar filas.
- **Revisit if:** Se introduce flag dedicado `is_free_shipping` (entonces threshold vuelve a ser solo numerico).
