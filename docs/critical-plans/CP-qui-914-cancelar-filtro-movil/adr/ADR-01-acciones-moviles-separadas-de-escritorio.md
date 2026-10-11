---
id: ADR-01
title: "acciones moviles separadas de escritorio"
status: proposed
reversibility: trivial
updated: 2026-10-06
---
# ADR-01 — acciones moviles separadas de escritorio

- **Context:** `ResponsiveDataViewComponent` pasa el mismo `actions` a tabla y tarjeta. `ItemListComponent` muestra dos acciones directas por defecto; la solicitud del usuario requiere que Imprimir y Cancelar queden accesibles en la tarjeta sin abrir el overflow.
- **Decision:** Añadir entrada opcional `mobileActions` al wrapper, usada solo por `app-item-list`, con fallback a `actions()`, y `mobileDirectActionsCount` con default dos. La lista de órdenes reordena las mismas referencias `TableAction` para móvil: View, Imprimir, Cancelar, y pasa conteo tres para eliminar el overflow de tres puntos solo en estas tarjetas. El escritorio conserva el arreglo original.
- **Consequences:** No se duplica `cancelOrder()` ni `show: can_cancel`; los componentes compartidos ganan entradas aditivas que deben probarse con y sin valor. `rowLabelKey="order_number"` identifica cada acción destructiva al lector de pantalla. Se traduce el label existente a «Cancelar orden» también en escritorio, sin cambiar su handler. Cancelar abre el mismo diálogo y no ejecuta PATCH antes de confirmar. Las otras listas siguen con dos acciones directas.
- **Reversibility:** trivial — quitar el binding y la entrada opcional devuelve el overflow original sin migración.
- **Revisit if:** El sistema de acciones compartidas incorpora prioridad por superficie o un `primaryMobileAction` general documentado.
