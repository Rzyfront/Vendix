---
id: D.4
title: "Modal de destino del plato y recálculo de propina"
phase: D
status: pending
owner: none
updated: 2026-09-20
contracts: [FB-25, FB-26, FB-27, FB-28, DB-02, DB-44, ERR-15, ERR-42]
adrs: [ADR-08, ADR-02]
skills: [vendix-frontend-modal, vendix-zoneless-signals, vendix-currency-formatting, vendix-restaurant-ops, how-to-test]
---
# D.4 — Modal de destino del plato y recálculo de propina

- **Skills:** `vendix-frontend-modal` (API de `app-modal`, visibilidad por modelo, slots, cierre seguro) · `vendix-zoneless-signals` (señales del modal, `input()`/`output()`, sin `EventEmitter`) · `vendix-currency-formatting` (mostrar el total y la propina resultantes con el pipe propio, nunca `$` en duro) · `vendix-restaurant-ops` (semántica del destino sobre un plato preparado) · `how-to-test` (recorrido Playwright MCP). Para la política de propina no hay skill: `[Sin skill — knowledge gap]` — haría falta `vendix-order-tip-policy`, que fije cuándo `tip_amount` se recalcula desde `tip_type`/`tip_value` y cuándo queda congelado. Depende de **D.3** (el vocabulario que el modal envía) y de **D.2** (la semántica real de cada destino).
- **Resources:** ADR-08 («el `confirm()` nativo actual no puede ofrecer esta elección; se reemplaza por un modal con las dos opciones explícitas») · ADR-02 (post-cobro se bloquea y se deriva al reembolso) · `apps/frontend/.../orders/pages/order-details/order-details-page.component.ts:4112-4185` (`reverseDeliveredItem`: diálogo de motivo y luego `confirm()` nativo en `:4147-4151`, «Aceptar = restock / Cancelar = waste») · `apps/frontend/.../restaurant-ops/tables/services/tables.service.ts` y `apps/frontend/.../orders/services/orders.service.ts:190-196` (el cuerpo enviado hoy es solo el motivo) · `apps/backend/.../order-flow/order-flow.service.ts:2437-2472` y `:2243-2262` (recálculo: arrastra `tip_amount` tal cual) · `apps/backend/prisma/schema.prisma:1556-1572` (`tip_amount`, `tip_type` `percentage|fixed`, `tip_value`, `tip_waiter_id`).
- **Business decision:** ADR-08 exige que el operador **elija** el destino del plato y que ese costo no llegue a la cuenta del cliente. Este paso fija tres reglas de superficie. Primera: la elección se hace en un modal con las dos opciones nombradas y explicadas, no en un `confirm()` del navegador; el destino seguro (desechar) es el preseleccionado. Segunda: el modal envía el destino al backend en el vocabulario unificado de D.3 — el backend deja de adivinarlo. Tercera: cuando la propina de la orden es **porcentual**, al excluir la línea del total se recalcula desde `tip_type`/`tip_value` sobre el subtotal vivo; cuando es **fija**, se respeta el monto que el cliente decidió. Post-cobro no hay elección posible: la acción se oculta y el rechazo lleva al reembolso.
- **Why:** hoy la elección se hace con un `confirm()` nativo cuyo texto obliga a leer una equivalencia arbitraria — «Aceptar = reingresar al stock, Cancelar = registrar como merma» — sobre un diálogo que no se puede estilar, no es accesible, no dice qué pasa con el dinero y confunde «Cancelar» con abortar la operación. Peor: lo que el operador elige ahí viaja como `destination`, pero en el carril de cancelación por línea el frontend manda **solo el motivo**, así que el backend decide por su cuenta y reusar y desechar quedan indistinguibles. Y hay un agujero de dinero propio de este paso: el recálculo del total arrastra `tip_amount` sin tocarlo (`:2455` y `:2249`), de modo que una propina guardada como porcentaje del subtotal se queda congelada en el monto viejo — el cliente termina pagando propina sobre un plato que no se comió, y el descuadre es tan silencioso como el de cualquier otra línea de esta auditoría.
- **Output:** un modal de destino reutilizable por los dos carriles (detalle de orden y mesa) con motivo obligatorio, las dos opciones explícitas con su consecuencia escrita, desechar preseleccionado y vista previa del nuevo total y de la nueva propina; los servicios del frontend enviando motivo **y** destino; el recálculo del backend recalculando la propina porcentual y dejando intacta la fija; el `confirm()` nativo eliminado de ese flujo.
- **Contracts touched:** FB-25 y FB-26 (el cuerpo lleva el destino del modal), FB-27 (reversa de entrega con destino explícito), FB-28 (mismo modal desde mesa), DB-02 (`subtotal_amount` / `tax_amount` / `grand_total` recalculados, ahora con la propina coherente), DB-44 (auditoría con motivo y destino), ERR-15 (post-cobro deriva al reembolso), ERR-42 (cuerpo inválido da 422 legible).
- **Data impact:** escribe `orders.tip_amount` cuando la propina es porcentual, además del recálculo de totales que el flujo ya hacía, y la fila de auditoría de la cancelación. **Sin migraciones:** `tip_type`, `tip_value` y `tip_amount` ya existen en `orders`. No toca órdenes históricas: solo las que se cancelan después del despliegue.
- **Blast radius:** detalle de orden, página de mesa y el monto que el cliente paga. Si la propina se recalcula cuando el cliente la había fijado a mano, se le cobra distinto de lo que aceptó; si no se recalcula cuando era porcentual, se le cobra de más. Si el modal queda tapado por el shell, el operador no puede cancelar nada. Quien lo nota: el cliente en la cuenta y el mesero en la pantalla. Señales: propina que no guarda proporción con el subtotal tras una cancelación, o `grand_total` que no cuadra con la suma de sus componentes.
- **Rollback:** reversible en código (restaurar el flujo anterior y dejar de recalcular la propina), pero los montos de propina ya recalculados **quedan escritos**; se corrigen orden por orden. El modal en sí es rollback trivial. Decide el dueño junto con D.2, porque comparten el mismo despliegue.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — un caso por tipo de propina: porcentual recalcula, fija no se mueve.
  - `npx jest --runInBand apps/frontend/src/app/private/modules/store/orders` — el componente envía motivo y destino.
  - `grep -n "confirm(" apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` — sin el `confirm()` nativo del flujo de reversa.
  - `curl -s -X POST "$API/store/orders/$OID/flow/items/$IID/cancel-delivered" -H "Authorization: Bearer $TOKEN" -d '{"reason":"cayo una mosca","destination":"waste"}' -o evidence/D.4-cancel-waste.json -w '%{http_code}\n'`
  - `psql "$DB" -c "SELECT subtotal_amount, tax_amount, tip_type, tip_value, tip_amount, grand_total FROM orders WHERE id=$OID" > evidence/D.4-propina-porcentual.txt` — la propina guarda la proporción del nuevo subtotal.
  - `psql "$DB" -c "SELECT tip_amount FROM orders WHERE id=$OID_FIJA" > evidence/D.4-propina-fija.txt` — idéntica antes y después.
  - `curl -s -X POST "$API/store/orders/$OID_COBRADA/flow/items/$IID/cancel-delivered" -H "Authorization: Bearer $TOKEN" -d '{"reason":"prueba post cobro","destination":"waste"}' -o evidence/D.4-post-cobro.json -w '%{http_code}\n'` → 409 derivando al reembolso.
  - Playwright MCP: abrir el modal desde el detalle de orden y desde la mesa, verificar foco, cierre con Escape y que no queda tapado por el shell; capturas a `evidence/D.4-modal/`.
- **Acceptance checklist:**
  - [ ] El flujo de cancelación usa el modal de la aplicación; no queda ningún `confirm()` nativo en ese camino.
  - [ ] El modal nombra las dos opciones con su consecuencia y trae desechar preseleccionado.
  - [ ] El modal muestra el nuevo total y la nueva propina antes de confirmar.
  - [ ] Los dos carriles envían motivo y destino en el cuerpo; el backend deja de derivar el destino por su cuenta.
  - [ ] Una propina porcentual se recalcula sobre el subtotal vivo tras excluir la línea cancelada.
  - [ ] Una propina fija conserva su monto exacto tras la cancelación.
  - [ ] El total resultante iguala subtotal más impuesto más envío más propina menos descuento, sin residuo.
  - [ ] Sobre una orden ya cobrada la acción no se ofrece, y forzada por API responde con el rechazo que deriva al reembolso.
  - [ ] El modal es operable con teclado y no queda tapado por el shell en el detalle de orden ni en la mesa.
  - [ ] F-001 — AUDIT F-031 - propina porcentual sobre un plato cancelado (major)
- **Status:** pending
