---
id: ADR-02
title: "Cierre con instantánea pendiente y confirmación auditable"
status: accepted
reversibility: costly
updated: 2026-10-06
---
# ADR-02 — Cierre con instantánea pendiente y confirmación auditable

- **Context:** Resumen de efectivo protegido por expected_seen, pero no hay pending gate y reporte pending_collection es vivo y de toda tienda.
- **Decision:** Consultar pendientes por sesión de origen; cerrar efectivo, pendientes y snapshot dentro de transacción bajo lock canónico compartido por escritores. Sólo las órdenes devueltas como pendientes por estado operativo o saldo por cobrar activan confirmación visual y fingerprint/snapshot; la confirmación guarda un motivo de auditoría generado por sistema. Una sesión legacy sin tracking y sin pendientes devueltos cierra sin aviso. Conservar `expected_closing_amount_seen`.
- **Consequences:** Cambian DTO web/móvil y el reporte; todos los escritores de movimientos deben hacer atómica su escritura con el efecto que representan y usar el lock; los fallos no pueden quedar ocultos.
- **Reversibility:** costly — afecta contratos, datos y auditoría.
- **Revisit if:** Producto prohíbe todo cierre con pendientes.
