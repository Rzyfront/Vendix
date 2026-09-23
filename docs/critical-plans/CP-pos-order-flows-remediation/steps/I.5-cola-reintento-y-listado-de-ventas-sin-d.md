---
id: I.5
title: "Cola, reintento y listado de ventas sin documento fiscal"
phase: I
status: in-progress
owner: none
updated: 2026-09-20
contracts: [DB-40, DB-41]
adrs: []
skills: [vendix-fiscal-scope, vendix-backend, vendix-prisma-scopes, vendix-frontend-standard-module, how-to-test]
---
# I.5 — Cola, reintento y listado de ventas sin documento fiscal

- **Skills:** `vendix-fiscal-scope` (los eventos fiscales se leen por entidad fiscal, no por tienda a secas) · `vendix-backend` (el listado se construye sobre el servicio de auditoría fiscal existente) · `vendix-prisma-scopes` (`fiscal_operation_events` es un modelo con scope fiscal y `invoice_retry_queue` no tiene getter en el servicio de tienda) · `vendix-frontend-standard-module` (la superficie agregada es un listado admin estándar, no una pantalla nueva desde cero) · `how-to-test` (curl del listado y recorrido de la pantalla). El trabajo de migración que este paso **no** ejecuta deberá invocar `vendix-prisma-migrations` cuando se abra.
- **Resources:** `apps/backend/src/domains/store/invoicing/pos/pos-fiscal-emission.service.ts:578-596` (el docblock que declara el reintento pendiente y por qué) · `:620-648` (la constancia que ya se escribe, con el pedido como recurso) · `:209-242` (`getStatusForOrder`, que ya lee la constancia antes de responder) · `apps/backend/src/domains/store/invoicing/pos/pos-sale-completed.listener.ts:48` (el `logger.warn` del listener) · `apps/backend/src/domains/fiscal-operations/services/fiscal-audit.service.ts:63-90` (`list` con filtro por `event_type` y por entidad) · `apps/backend/src/domains/fiscal-operations/store-fiscal.controller.ts:77-88` (`GET /store/fiscal/history`, ya publicado y con permiso propio) · `apps/backend/prisma/schema.prisma:8828-8848` (`invoice_retry_queue.invoice_id` es `Int` NOT NULL con FK a `invoices`) · ficha de origen `F-018` (parcialmente cerrada por `50ec1582a`).
- **Business decision:** la parte **descubrible** se cierra aquí y la parte que exige DDL **no se ejecuta en este plan**. El listado de ventas cobradas sin documento fiscal se construye reutilizando la consulta de historial fiscal que ya existe, filtrando por el tipo de evento que el servicio ya escribe: eso no necesita ninguna columna nueva. La cola con reintento automático sí la necesita —`invoice_retry_queue` está llaveada por factura y una venta descubierta no tiene factura que encolar—, así que queda acotada, documentada y derivada a un trabajo con ADR propio, con dueño, en vez de improvisar una migración dentro de un plan que declaró cero migraciones.
- **Why:** la pérdida silenciosa ya se cerró: la venta sin documento deja constancia persistente y la UI dejó de decir «Emitiendo…» para siempre. Lo que sigue abierto es que nadie **descubre** el hueco sin abrir la orden una por una, y que el reintento no existe. El primer frente es más barato de lo que la ficha supone: el servicio de auditoría fiscal ya sabe listar y filtrar por tipo de evento, así que la superficie agregada es una consulta parametrizada y una pantalla, no una tabla nueva. El segundo frente es el que topa con el esquema y no se fuerza.
- **Output:** dos artefactos. **Uno de código:** el listado agregado de ventas cobradas sin documento fiscal, sobre la consulta de historial ya publicada, con su pantalla admin y su enlace a la orden; y el `logger.warn` del listener elevado a una señal que la pantalla pueda contar. **Uno de decisión:** un documento de alcance bajo `evidence/` que deja escrito qué exige exactamente la cola con reintento —`invoice_retry_queue.invoice_id` nullable más un `order_id`, con sus consumidores enumerados—, por qué no entra aquí, y qué debe contener el ADR que la autorice. El reintento automático **no se implementa**.
- **Contracts touched:** DB-40, DB-41
- **Data impact:** none — el listado es de **solo lectura** sobre filas que el carril de emisión ya escribe, y el documento de alcance no toca la base. **Sin migración en este paso:** `invoice_retry_queue` no cambia y ninguna fila se inserta en ella, exactamente como hoy. El invariante que se verifica es que cada venta descubierta deje una y solo una fila de constancia.
- **Blast radius:** el módulo fiscal del panel y la operación del contador. Si el listado filtra mal —por tienda en vez de por entidad fiscal, o por un tipo de evento equivocado— muestra ventas que no corresponden o esconde las que sí, y el contador declara sobre una foto falsa. Si el permiso del endpoint se reutiliza mal, una tienda podría ver eventos de otra. El carril de emisión no se toca, así que ninguna venta cambia de conducta.
- **Rollback:** revertir el commit del listado y de la pantalla. La constancia por-orden sigue escribiéndose y consultándose como hoy, y el documento de alcance sobrevive al revert porque no es código: es la entrada del trabajo siguiente.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/invoicing/pos/pos-fiscal-emission.service.spec.ts` — una venta descubierta deja exactamente una fila de constancia, y dos fallos de la misma venta no la duplican
  - `curl -s "$API/store/fiscal/history?event_type=pos_sale_without_fiscal_document&limit=50" -H "Authorization: Bearer $TOKEN" -o evidence/I5-listado.json` → 200 con las ventas descubiertas y su `resource_id`
  - `curl -s "$API/store/fiscal/history?event_type=pos_sale_without_fiscal_document" -H "Authorization: Bearer $TOKEN_OTRA_TIENDA" -o evidence/I5-aislamiento.json` → cero filas de la tienda ajena
  - SQL de solo lectura: `SELECT resource_id, count(*) FROM fiscal_operation_events WHERE event_type = 'pos_sale_without_fiscal_document' GROUP BY 1 HAVING count(*) <> 1;` = 0 filas → `evidence/I5-constancia-unica.txt`
  - SQL de solo lectura: `SELECT count(*) FROM invoice_retry_queue;` idéntico antes y después de una venta descubierta → `evidence/I5-cola-sin-crecer.txt`
  - Playwright MCP contra `vendix.com`: abrir el listado, confirmar que la venta descubierta aparece y enlaza a su orden → `evidence/I5-listado.png`
- **Acceptance checklist:**
  - [x] El listado agregado muestra las ventas cobradas sin documento fiscal, con enlace a la orden, sin abrir órdenes una por una
  - [x] El listado se alimenta de la consulta de historial fiscal existente: no se crea tabla, columna ni endpoint paralelo
  - [x] El filtro respeta la entidad fiscal y el aislamiento entre tiendas: una tienda no ve las ventas de otra
  - [x] Cada venta descubierta deja exactamente una fila de constancia, y un segundo fallo por este productor no la duplica
  - [x] La tabla de reintentos no gana filas ni columnas en este paso
  - [x] El listener de venta cobrada registra error con enlace a la orden en vez del warn genérico
  - [x] El documento de alcance nombra el cambio de esquema exacto, sus consumidores y qué debe decidir el ADR que lo autorice
  - [ ] El reintento automático queda explícitamente fuera, y el documento dice quién lo asume
- **Status:** in-progress · Fabio · 2026-09-23 · productor idempotente por advisory lock `d539c2533` (20 tests), listado/aislamiento `78a1c8a5e` (32 tests). API QA #401/#402 separó tiendas y dejó cola 2→2. Playwright `evidence/I5-ui-list.md`: constancia tienda #3 en listado, enlace a orden #1110, API cross-store aislada; mobile corregido en `a4ea58be5`. `evidence/I5-pagination-27.md`: 27 eventos QA, API páginas 25+2+0, UI página 2 con dos filas, fixtures eliminados y cola 2→2. Pendiente fallo POS real→evento y dueño/ADR del reintento automático; sin índice único no se promete unicidad contra escritores ajenos. Aislamiento tienda vs entidad compartida corregido en `evidence/I5-store-history-isolation-20260923.md`, Jest 13/13.
