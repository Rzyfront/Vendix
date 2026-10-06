---
id: ADR-03
title: "accion y estado del fuego por superficie"
status: proposed
reversibility: trivial
updated: 2026-10-06
---
# ADR-03 — accion y estado del fuego por superficie

- **Context:** `TableAction` soporta `show`, `disabled`, variante y tooltip; la tarjeta móvil tiene acciones directas limitadas. La paleta actual del detalle no coincide con la pedida en QUI-919 y un `button[disabled]` no recibe foco y su `title` no sirve en táctil.
- **Decision:** Antes de enviar, `flame` es botón con nombre «Enviar a cocina: orden N»; tras envío total el mismo botón enfocable solo muestra un `ToastService.info` al activarse y nunca llama POST. `label` dinámico anuncia estado/progreso al lector; `tooltip` ofrece hover. Mantener el mismo nodo preserva foco y permite teclado/tacto. Mantenerlo visible en desktop y móvil. Colores de fuego: pending ámbar, in_preparation azul/cian, ready/delivered verde; sin enviar neutro y cancelado atención. No usar `disabled` nativo ni solo `title` para el indicador; activar por teclado/tacto muestra el mismo texto mediante toast accesible. No reutilizar clases de badge incompatibles.
- **Consequences:** Las acciones móviles requieren un orden explícito para que fuego y cancelar sigan accesibles. El CSS/markup compartido solo cambia si una prueba demuestra que el tooltip nativo falla.
- **Reversibility:** trivial — retirar acción y presentación; no hay datos nuevos.
- **Revisit if:** `TableAction` recibe una variante oficial de indicador no activable con tooltip accesible.
