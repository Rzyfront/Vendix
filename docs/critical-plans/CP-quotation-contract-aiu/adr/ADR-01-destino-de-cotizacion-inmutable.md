---
id: ADR-01
title: "Destino de cotizacion inmutable y bloqueante"
status: accepted
reversibility: one-way
updated: 2026-09-06
---
# ADR-01 — Destino de cotizacion inmutable y bloqueante

- **Context:** La cotizacion gana `destination` (`sale`|`contract`|`other`). Las estructuras de cobro son distintas: un contrato AIU no cabe en una orden de venta.
- **Decision:** `destination` se fija al crear y jamas se edita. El bloqueo vive en backend: `sale` solo admite `convertToOrder`, `contract` solo admite crear contrato. La UI solo refleja el bloqueo.
- **Consequences:** Imposible la doble conversion por cambio de destino. Corregir un destino mal marcado exige cancelar y recrear la cotizacion.
- **Reversibility:** one-way door — permitir edicion reabriria el riesgo de doble ingreso que este plan existe para cerrar.
- **Revisit if:** Aparece un caso de negocio que exija reclasificar sin cancelar, con regla fiscal firmada por el dueno.
