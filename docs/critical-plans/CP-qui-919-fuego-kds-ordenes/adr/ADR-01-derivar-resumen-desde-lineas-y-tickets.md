---
id: ADR-01
title: "derivar resumen desde lineas y tickets"
status: proposed
reversibility: costly
updated: 2026-10-06
---
# ADR-01 — derivar resumen desde lineas y tickets

- **Context:** La lista carece de `product_type`, `skip_kds`, `cancelled_at` y tickets; el detalle sí los carga. La regla del cuello de botella no puede salir de `order.state` ni del estado de un ticket aislado.
- **Decision:** Proyectar relaciones mínimas en `findAll`; una utilidad pura del frontend selecciona por ítem la fila KDS en vuelo o la terminal más reciente y agrega por `quantity`. Excluir físicos, `skip_kds` y líneas canceladas. El estado no se persiste. Si queda un ítem sin fire, la acción envía solo sus ids. Si un ticket está cancelado sin reenvío, mostrar atención y llevar al detalle para resolverlo, nunca verde.
- **Consequences:** Lista algo más grande pero una sola consulta paginada; mismo algoritmo para REST inicial e hidratación por id. Hay que probar envíos parciales, reenvíos y cantidad >1.
- **Reversibility:** costly — quitar la proyección devuelve lista ligera, pero elimina el indicador; sin migración.
- **Revisit if:** El backend publica una proyección canónica de cocina para todas las superficies.
