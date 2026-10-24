---
id: ADR-03
title: "Completar en bloque sin saltar cobro ni efectos"
status: accepted
reversibility: costly
updated: 2026-10-06
---
# ADR-03 — Completar en bloque sin saltar cobro ni efectos

- **Context:** Bulk actual fuerza transiciones y devuelve parcial HTTP 200; no cumple criterio atómico de QUI-920.
- **Decision:** Endpoint de caja sólo para IDs de la sesión y elegibles; preview de saldo, cocina, entrega, stock y versión. Commit todo o nada sobre seam canónico de `finished` en una transacción; ningún pago o entrega sintética. Eventos/outbox sólo tras commit. Si no se logra un unit of work atómico por efectos existentes, no exponer la acción hasta reestructurar el seam.
- **Consequences:** Complejidad alta; nunca escribir state en crudo ni invocar bulk general con todos los IDs.
- **Reversibility:** costly — afecta contratos, datos y auditoría.
- **Revisit if:** Usuario acepta parcial por fila o elimina la acción masiva.
