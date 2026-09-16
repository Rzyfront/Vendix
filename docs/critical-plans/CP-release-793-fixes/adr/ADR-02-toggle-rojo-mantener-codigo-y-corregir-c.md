---
id: ADR-02
title: "Toggle rojo: mantener codigo y corregir comentario (QUI-801)"
status: accepted
reversibility: trivial
updated: 2026-09-11
---
# ADR-02 — Toggle rojo: mantener codigo y corregir comentario (QUI-801)

- **Context:** F-004: OFF habilitado pinta `danger` en toda la app; el comentario QUI-801 describe lo contrario. QUI-801 pide rojo para visibilidad: el codigo implementa la intencion de producto, el comentario miente.
- **Decision:** Directiva de usuario: mantener el codigo, corregir el comentario para que describa lo implementado (OFF habilitado = danger, disabled = muted) y referenciar QUI-801. Verificacion visual por modulo afectado.
- **Consequences:** Sin cambio de runtime; se elimina la contradiccion que confundiria al proximo lector.
- **Reversibility:** trivial — revertir OFF a muted es una linea si diseno lo pide.
- **Revisit if:** Diseno dictamina que el rojo transversal es regresion visual (entonces OFF vuelve a muted).
