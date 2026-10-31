---
id: ADR-04
title: "Presupuesto aplicado a propuestas versionadas"
status: proposed
reversibility: costly
updated: 2026-10-06
---
# ADR-04 — Presupuesto aplicado a propuestas versionadas

- **Context:** Órdenes tienen varios escritores y aceptar cotización lo hace personal, no el cliente.
- **Decision:** Guardar presupuesto aprobado y propuesta con versión de orden, líneas y total final; ninguna adición que lo supere modifica orden/stock/cuenta antes de aprobación explícita. Guard único en todos los escritores.
- **Consequences:** Más estados y eventos; rechazos, expiración y carreras deben ser idempotentes.
- **Reversibility:** costly — exige migración y actualización de contratos.
- **Revisit if:** El negocio decide que el límite es aviso y no control de cobro.
