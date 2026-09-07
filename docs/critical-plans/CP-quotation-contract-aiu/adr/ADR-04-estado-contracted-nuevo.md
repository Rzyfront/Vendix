---
id: ADR-04
title: "Estado contracted nuevo sin reusar converted"
status: proposed
reversibility: costly
updated: 2026-09-06
---
# ADR-04 — Estado contracted nuevo sin reusar converted

- **Context:** `converted` hoy significa "se volvio orden de venta" y alimenta reportes de conversion. Reusarlo para contratos contaminaria esas metricas.
- **Decision:** Nuevo valor de estado (`contracted`) via `ALTER TYPE ... ADD VALUE` en migracion propia. `accepted->converted` queda reservado a venta; `accepted->contracted` marca contrato creado.
- **Consequences:** Reportes actuales intactos. La migracion de enum sigue el patron del repo en archivo propio.
- **Reversibility:** costly — retirar un valor de enum usado exige migracion de datos.
- **Revisit if:** Se decide unificar metricas de conversion venta+contrato con definicion firmada.
