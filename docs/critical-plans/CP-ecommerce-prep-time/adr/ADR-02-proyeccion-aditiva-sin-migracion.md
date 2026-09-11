---
id: ADR-02
title: "Proyeccion aditiva sin migracion"
status: proposed
reversibility: trivial
updated: 2026-09-11
---
# ADR-02 — Proyeccion aditiva sin migracion

- **Context:** `preparation_time_minutes` ya existe en producto y variante; el listado no lo proyecta a nivel producto.
- **Decision:** Proyectar el campo en listado y detalle como aditivo (`number | null`), sin filtrar ni renombrar nada; sin migracion.
- **Consequences:** Clientes viejos ignoran la clave nueva; el flag solo gobierna display, nunca disponibilidad ni precio.
- **Reversibility:** trivial — revertir el mapper devuelve la respuesta historica exacta.
- **Revisit if:** se requiere ocultar el dato del payload cuando el flag esta apagado por privacidad.
