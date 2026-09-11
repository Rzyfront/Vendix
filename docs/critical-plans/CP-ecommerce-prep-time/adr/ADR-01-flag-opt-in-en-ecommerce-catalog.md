---
id: ADR-01
title: "Flag opt-in en ecommerce.catalog"
status: proposed
reversibility: trivial
updated: 2026-09-11
---
# ADR-01 — Flag opt-in en ecommerce.catalog

- **Context:** La tienda necesita encender o apagar el indicador por tienda. El bloque `ecommerce.catalog` ya agrupa flags de vitrina.
- **Decision:** Agregar `show_preparation_time?: boolean` al DTO, interface, defaults (`false`) y espejo frontend; lectura con `=== true`.
- **Consequences:** Tiendas viejas sin la clave ven la vitrina igual que hoy; el admin nuevo persiste sin migracion.
- **Reversibility:** trivial — quitar el campo devuelve el DTO a su forma anterior sin datos que migrar.
- **Revisit if:** se pide el flag por producto o por categoria en vez de por tienda.
