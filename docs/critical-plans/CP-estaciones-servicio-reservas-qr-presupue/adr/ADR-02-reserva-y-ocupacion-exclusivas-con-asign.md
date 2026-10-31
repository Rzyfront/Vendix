---
id: ADR-02
title: "Asignación temporal exclusiva"
status: proposed
reversibility: costly
updated: 2026-10-06
---
# ADR-02 — Asignación temporal exclusiva

- **Context:** La validación actual por proveedor tiene ventanas fuera de la transacción y checkout/POS ofrecen entradas alternas.
- **Decision:** Asignar intervalos UTC de estación y proveedor en la misma transacción de la reserva; restricción de exclusión o bloqueo serializable más constraint comprobable. Cualquier escritor pasa por un coordinador común.
- **Consequences:** Requiere migración SQL, pruebas de carrera y reconciliación de datos heredados.
- **Reversibility:** costly — exige migración y actualización de contratos.
- **Revisit if:** Producto define capacidad >1, recursos virtuales o citas sin estación.
