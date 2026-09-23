---
id: H.3
title: "Verificar POS mesa contra Mesas y conservar snapshots fiscales"
phase: H
status: pending
owner: none
updated: 2026-09-22
contracts: [FB-03, FB-66, FB-67, DB-02, DB-13, DB-43, ERR-01, ERR-02]
adrs: [ADR-10]
skills: [vendix-backend, vendix-tax-typing, vendix-prisma-scopes, how-to-test]
---
# H.3 — Verificar POS mesa contra Mesas y conservar snapshots fiscales

- **Skills:** `vendix-backend` (contratos de ambos cobros) · `vendix-tax-typing` (snapshot por tasa) · `vendix-prisma-scopes` (consultas de evidencia con tienda explícita) · `how-to-test` (curl + Playwright MCP, happy/sad/brute-force).
- **Resources:** `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts` (manda `items` durante el cobro) · `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/tables.service.ts` (manda `items` a `add-items`, luego cobra sin `items`) · `apps/backend/src/domains/store/tables/table-sessions.service.ts` · `apps/backend/src/domains/store/payments/payments.service.ts` · `apps/backend/src/domains/store/payments/payments.service.spec.ts` · `curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @evidence/H3-mesas-add-items.request.json "$API/store/table-sessions/$SESSION_ID/add-items"` · Playwright MCP en `https://vendix.com` con `--ignore-https-errors`.
- **Business decision:** los dos recorridos visibles al usuario venden el mismo producto sin impuesto por el mismo total. La diferencia de payload no cambia el tratamiento tributario; una línea antigua con impuesto conserva su desglose, y la ausencia de asignación actual no se clasifica como daño histórico sin evidencia independiente.
- **Why:** un test unitario de `buildPosOrderItem` no prueba la divergencia real: POS manda `items` junto al pago y Mesas los manda antes. La aceptación debe comprobar ambos endpoints y los snapshots persistidos, incluido el cobro de una mesa ya abierta.
- **Output:** matriz de regresión y evidencia E2E de cuatro carriles: POS sin mesa, POS «Consumir en mesa» con `table_id`, POS con `table_session_id` preexistente, y módulo Mesas `add-items` → pago sin `items`; cada uno con producto sin asignación, categoría 0 %, gravado y carrito mixto. Un test de regresión demuestra que una línea gravada ya guardada no se normaliza a cero si el catálogo cambia después.
- **Contracts touched:** FB-03, FB-66, FB-67, DB-02, DB-13, DB-43, ERR-01, ERR-02
- **Data impact:** pruebas y consultas sobre dataset local de seeds, con IDs propios y limpieza controlada. Ningún cambio a producción ni backfill. El antiguo inventario de «ventas IVA cero sin asignación = daño» se elimina porque la premisa contradice ADR-10.
- **Blast radius:** un falso verde puede dejar al cajero bloqueado solo en POS, o permitir un cobro que altere el desglose de líneas viejas. La evidencia debe inspeccionar tanto HTTP como `order_items`, `order_item_taxes`, `orders` y `payments` por tienda.
- **Rollback:** no aplica al paso de verificación. Si cualquier carril falla, H.1/H.2 permanecen pendientes y no se libera la fase H; las filas locales de prueba se limpian sin tocar datos ajenos.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/payments/payments.service.spec.ts apps/backend/src/domains/store/tables/table-sessions.service.spec.ts` — casos taxless nuevos y snapshots gravados previos, verificando importe, `tax_type`, `tax_rate_id` y ausencia de ERR-01.
  - `curl` a `POST /store/table-sessions/:id/add-items` seguido de `POST /store/payments/pos` con `table_session_id` **sin `items`**; repetir con POS `table_id + items` y sesión preexistente `table_session_id + items`. Guardar cuerpos/status únicos bajo `evidence/H3-*.json`.
  - SQL con `orders.store_id=:storeId` y `order_id=:orderId`: comparar `orders.grand_total` con suma de líneas, `order_item_taxes` y pago; confirmar una sola orden/pago y snapshots antiguos intactos. Registrar consulta y resultado en `evidence/H3-snapshots.txt`.
  - Playwright MCP: dos recorridos reales (POS «Consumir en mesa» y módulo Mesas) con el mismo producto sin impuesto; inspeccionar Network para fijar que el primero envía `items` en el cobro y el segundo no; ambos muestran cobro exitoso y total igual. Repetir la matriz de API en dos tiendas seed, una con área fiscal activa y otra inactiva: el resultado taxless no depende de esa configuración.
  - Sad/brute-force en local: doble submit, mesa de otra tienda y línea inválida (`quantity=0`) rechazan tipado y no dejan pago/mesa parcial; no se confunde un error de validación con ERR-01.
- **Acceptance checklist:**
  - [ ] Los cuatro carriles cobran el mismo producto sin impuesto con igual total, independientemente del área fiscal activa.
  - [ ] POS con `table_id + items` y con `table_session_id + items` no devuelve ERR-01; Mesas `add-items` → cobro sin `items` sigue funcionando.
  - [ ] Una línea antigua gravada conserva importe, `tax_rate_id` y `tax_type` aunque el catálogo actual no tenga asignación.
  - [ ] Los carritos gravado, 0 % y mixto no pierden impuestos ni duplican orden/pago.
  - [ ] Happy/sad/brute-force de API y los dos recorridos Playwright quedan documentados en `evidence/`.
  - [ ] No se produjo ningún reporte que presuma «sin asignación = subdeclaración».
- **Status:** pending
