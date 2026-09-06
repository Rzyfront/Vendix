---
id: ADR-03
title: "Snapshot congelado contrato-factura"
status: proposed
reversibility: costly
updated: 2026-09-06
---
# ADR-03 — Snapshot congelado contrato-factura

- **Context:** Entre cotizar y emitir pueden pasar dias y el perfil o el contrato pueden cambiar. El documento fiscal debe reproducirse igual un ano despues.
- **Decision:** El contrato copia totales, A/I/U, regimen, objeto y version de perfil. La factura AIU copia desde el contrato, nunca por referencia viva. Igual que `invoice_profile_versions.config`.
- **Consequences:** Cambios posteriores no alteran documentos emitidos. Mas columnas JSON, auditoria simple.
- **Reversibility:** costly — volver a referencia viva rompe la reproducibilidad fiscal.
- **Revisit if:** El tamano de snapshots degrada reportes y se propone compresion con prueba de reproduccion.
