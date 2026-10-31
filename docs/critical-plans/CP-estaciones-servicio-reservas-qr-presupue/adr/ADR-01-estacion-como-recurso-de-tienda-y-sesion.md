---
id: ADR-01
title: "Estación por tienda y sesión separada"
status: proposed
reversibility: costly
updated: 2026-10-06
---
# ADR-01 — Estación por tienda y sesión separada

- **Context:** La mesa restaurante y el turno KDS modelan otras operaciones.
- **Decision:** Crear estación física por tienda y sesión de servicio ligada opcionalmente a reserva y a una sola orden; capacidades de servicio y proveedor son M:N.
- **Consequences:** Nuevas tablas y UI, sin reutilizar permisos de mesas.
- **Reversibility:** costly — exige migración y actualización de contratos.
- **Revisit if:** La operación requiere una estación fija por proveedor o capacidad múltiple.
