---
id: ADR-06
title: "La entrega del mesero se enruta por el seam de orden, no por el de cocina"
status: accepted
reversibility: trivial
updated: 2026-09-23
---
# ADR-06 — La entrega del mesero se enruta por el seam de orden, no por el de cocina

- **Context:** El dueño reporta que «a veces» un mesero no puede entregar un plato. La página de mesa **ya** entrega por el seam de orden en el caso general (`deliverTableSessionItem` → `tablesService.markItemDelivered` → `table-sessions.service.ts:2100` → `deliverOrderItem`). Solo se desvía al carril de cocina la rama `is_takeaway === true && needsKitchen(item)`, y esa rama concentra tres causas de fallo: el endpoint de marcar entregado exige turno de estación y falla con `KDS_STATION_LOCKED` si el cocinero tiene un turno activo (heartbeat < 5 min, `kitchen-fire.service.ts:2611`); la compuerta takeaway-only rechaza tickets que no son de llevar (`:2656-2668`); y el `updateMany` marca el ticket **completo**, no la línea (`:2695-2720`), de modo que un ticket mixto entrega platos que no salieron. El «a veces» es exactamente eso: depende de si el cocinero tiene turno abierto y de cómo se agrupó el ticket.
- **Decision:** Esa rama deja de desviarse: toda entrega desde la mesa pasa por `deliverOrderItem`, que opera por ítem, no exige turno de estación y sincroniza hacia `kitchen_ticket_items`. No se relaja la compuerta takeaway-only ni se le conceden permisos de KDS al mesero. **El cambio es una condición, no un cableado nuevo**: la rama destino, su spinner y su toast ya están escritos y en uso.
- **Consequences:** Los tres bugs se cierran con un cambio de destino en el frontend y cero cambios de contrato en backend, lo que hace la verificación barata y el rollback inmediato. La dirección de sincronización se invierte respecto de hoy — la orden manda y la cocina refleja —, que es la dirección correcta: la orden es lo que se cobra. Los tres códigos de error implicados siguen existiendo para el KDS, y se les da mensaje accionable en vez de eliminarlos. Quedan por reconciliar los caminos huérfanos que escriben `delivered_at` sin pasar por ningún seam (revert de ticket, despacho, bulk).
- **Reversibility:** trivial — es una condición en el frontend; el endpoint de cocina permanece intacto.
- **Revisit if:** aparece un flujo donde el mesero deba entregar un ticket entero deliberadamente (por ejemplo una bandeja completa), que sería una acción nueva sobre el seam de orden, no un retorno al de cocina.

- **Owner approval:** 2026-09-23 — el dueño autorizó expresamente las cuatro propuestas ADR-05/06/07/08 para completar el plan.
