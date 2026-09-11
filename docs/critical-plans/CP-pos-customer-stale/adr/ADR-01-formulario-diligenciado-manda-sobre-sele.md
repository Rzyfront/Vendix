---
id: ADR-01
title: "Formulario diligenciado manda sobre seleccion previa"
status: proposed
reversibility: costly
updated: 2026-09-11
---
# ADR-01 — Formulario diligenciado manda sobre seleccion previa

- **Context:** `resolveIfNeeded()` retorna `of(true)` si hay seleccionado, ignorando el form. El flujo real es seleccionar-A y luego diligenciar-B.
- **Decision:** Short-circuit solo si hay seleccionado Y el form está vacío; con email, documento o nombre se llama a `POST /store/customers/resolve` y se emite el resultado.
- **Consequences:** A-luego-B vende a B; A sin ediciones sigue vendiendo a A; el tab crear no necesita limpiar selección al abrir.
- **Reversibility:** costly — revertir reabre el bug fiscal y exige nueva regresión completa.
- **Revisit if:** El negocio exige confirmación explícita antes de reemplazar A por B.
