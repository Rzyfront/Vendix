---
id: E.3
title: "Persistir tipo de entrega y canal al crear la orden"
phase: E
status: in-progress
owner: Rawls
updated: 2026-09-20
contracts: [FB-16, DB-04, DB-05]
adrs: [ADR-01]
skills: [vendix-backend, vendix-backend-api, vendix-validation, vendix-error-handling, how-to-test]
---
# E.3 — Persistir tipo de entrega y canal al crear la orden

- **Skills:** `vendix-backend` y `vendix-backend-api` para el `create` de órdenes y su DTO; `vendix-validation` porque el pipe global corre con `forbidNonWhitelisted` y un campo no declarado es un 400, no un campo ignorado; `vendix-error-handling` para que el rechazo de un valor inválido salga tipado; `how-to-test` para el contrato por `curl`.
- **Resources:** `apps/backend/src/domains/store/orders/orders.service.ts:411` (`resolveInitialOrderState`, que sí lee `delivery_type` del DTO) y `:416-448` (el bloque `data` que no lo escribe); `apps/backend/src/domains/store/orders/dto/create-order.dto.ts:204-211` (`delivery_type` declarado con sus cinco valores; **`channel` no está declarado**); `apps/backend/prisma/schema.prisma:1532-1533` (`channel @default(pos)`, `delivery_type @default(direct_delivery)`); `apps/backend/src/main.ts:246` (`forbidNonWhitelisted: true`). ADR-01 fija cuál es el valor correcto de «llevar». Ficha de origen: F-013 en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** Una orden persiste el tipo de entrega y el canal que declaró quien la creó; el default del esquema es un respaldo, no una decisión. El valor de «llevar» lo fija ADR-01 (`direct_delivery`, decidido por el dueño el 2026-09-20). Lo que este paso sí decide y debe quedar escrito: `channel` pasa a ser un campo declarado del DTO con default `pos`, porque hoy no existe y el pipe global convierte en 400 cualquier intento de enviarlo. Si el dueño prefiriera que `channel` siga siendo server-side, la alternativa es rechazarlo explícitamente en vez de ignorarlo — pero entonces el KDS y las analíticas siguen leyendo `pos` para una orden de WhatsApp.
- **Why:** `orders.create` resuelve el estado inicial leyendo `createOrderDto.delivery_type` (`:411-413`, la regla de «domicilio con plato preparado no auto-finaliza») y acto seguido construye el `data` sin escribir ni `delivery_type` ni `channel` (`:416-448`). El DTO acepta el campo y el servicio lo descarta en silencio: toda orden creada por este endpoint nace `pos` / `direct_delivery` por default de esquema, aunque el cliente haya pedido `dine_in` o `home_delivery`. Es la causa aguas arriba de que el KDS no pueda distinguir envío de «para llevar» (lee un dato que nadie grabó) y de que el detalle de orden etiquete un QR de mesa como entrega directa. El docblock del propio DTO agrava la confusión: `create-order.dto.ts:207` afirma que el default no enviado *«se trata como `pickup`»*, cuando el default real del esquema es `direct_delivery` — dos documentos del mismo repo dicen cosas distintas sobre la misma columna.
- **Output:** El `create` persiste `delivery_type` y `channel` del DTO, con los defaults del esquema como respaldo explícito y no implícito. `channel` queda declarado en `CreateOrderDto` con su enum. El docblock de `delivery_type` deja de mentir sobre el default. Queda un test que falla antes del arreglo: crear una orden con `delivery_type: 'dine_in'` y leerla devuelve hoy `direct_delivery`.
- **Contracts touched:** FB-16 (`POST /store/orders` pasa a persistir `delivery_type` y `channel`), DB-04 (invariante: toda orden persiste el `delivery_type` del DTO, no el default del esquema), DB-05 (ninguna orden POS nueva nace `pickup`, por ADR-01).
- **Data impact:** Escribe dos columnas más en cada `orders` creada por este endpoint: `delivery_type` y `channel`. No reescribe ninguna fila existente. **Sin migración**: ambas columnas existen con default (`schema.prisma:1532-1533`) y los enums ya tienen todos sus valores. Las órdenes anteriores conservan sus defaults y no se distinguen de las que sí eligieron ese valor — es un límite conocido, no se repara aquí (el hub lo deja fuera en Non-Goals).
- **Blast radius:** Si el paso escribe un `delivery_type` que el resto del sistema no espera, la orden cambia de carril aguas abajo sin avisar: `dine_in` persistido deja de estar exento del gate de cobro de envío hasta que E.4 lo exima (422 al cobrar, lo nota el mesero), y `home_delivery` persistido activa la exigencia de dirección en la remisión (lo nota el despachador). Si `channel` se declara con un enum incompleto, una orden de WhatsApp o de agente rechaza con 422 de validación en la creación: lo nota quien integre ese canal, de inmediato y en voz alta. El riesgo silencioso es el contrario: dejarlo sin declarar y que siga entrando por default.
- **Rollback:** Revertir el commit del paso. Ninguna fila histórica se tocó. Las órdenes creadas mientras estuvo vivo conservan el valor real que pidieron y siguen siendo coherentes; si el rollback hiciera falta, se identifican por `created_at > :deploy` y por tener `delivery_type` distinto del default. No hay pérdida de datos: revertir deja de escribir, no borra.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/domains/store/orders` — con el test nuevo que falla antes del arreglo.
  - `curl -s -X POST "$API/store/orders" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"delivery_type":"dine_in","channel":"pos","subtotal":10000,"total_amount":10000,"items":[{"product_id":1,"quantity":1,"unit_price":10000,"total_price":10000}]}' | tee evidence/E.3-create-dine-in.json`
  - SQL de DB-04: `SELECT id, delivery_type, channel FROM orders WHERE id=:newId;` → `dine_in` / `pos` → `evidence/E.3-db04-persistido.txt`.
  - Campo no declarado (contrato de validación): `curl -s -X POST "$API/store/orders" … -d '{"canal":"pos", …}'` → 400/422 con `details.validationErrors` → `evidence/E.3-forbid-non-whitelisted.json`.
  - Valor fuera del enum: `curl … -d '{"delivery_type":"takeaway", …}'` → rechazo tipado, nunca 500 → `evidence/E.3-delivery-type-invalido.json`.
  - SQL de DB-05 tras el despliegue: `SELECT count(*) FROM orders WHERE channel='pos' AND delivery_type='pickup' AND created_at > :deploy;` → 0 → `evidence/E.3-db05-sin-pickup.txt`.
- **Acceptance checklist:**
  - [ ] Existe un test que falla antes del arreglo: crear con `dine_in` devolvía `direct_delivery`.
  - [ ] `orders.create` persiste `delivery_type` del DTO y cae al default del esquema solo cuando no viene.
  - [ ] `channel` está declarado en el DTO con su enum y se persiste.
  - [ ] Un canal fuera del enum se rechaza con código tipado y `details.validationErrors`, nunca con 500.
  - [ ] El docblock de `delivery_type` del DTO deja de afirmar un default que el esquema no tiene.
  - [ ] `resolveInitialOrderState` sigue produciendo el mismo estado inicial para los mismos datos.
  - [ ] Una orden creada con `home_delivery` llega al detalle con su etiqueta correcta.
  - [ ] Ninguna orden POS nueva nace con tipo de entrega de recogida diferida.
  - [ ] Ninguna fila histórica de `orders` se reescribe durante el paso.
- **Status:** in-progress — persistencia y 75 tests en 91575a2c7; falta curl/DB.
