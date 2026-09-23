---
id: E.6
title: "Base de la propina coherente entre carriles"
phase: E
status: in-progress
owner: none
updated: 2026-09-20
contracts: [FB-01, FB-03, FB-04, DB-02]
adrs: [ADR-11]
skills: [vendix-backend, vendix-currency-formatting, vendix-accounting-rules, how-to-test]
---
# E.6 — Base de la propina coherente entre carriles

- **Skills:** `vendix-backend` para los tres llamadores y la utilidad compartida; `vendix-currency-formatting` para el redondeo, que hoy entra como función inyectada y debe seguir siendo la misma en los tres; `vendix-accounting-rules` porque la propina es un pasivo de custodia que suma al total sin tocar base gravable ni impuesto, y cualquier cambio de base mueve el asiento; `how-to-test` para fijar la base con un caso de cifras redondas en cada carril.
- **Resources:** `apps/backend/src/common/utils/tip.util.ts` (`resolveTip(input, taxableBase, round)` y su docblock, que afirma que el porcentaje va sobre la base gravable «no sobre el total»); `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:917-921` (llamador 1: pasa `order.subtotal_amount`, **neto**); `apps/backend/src/domains/store/payments/payments.service.ts:3720` y `:3748` (llamador 2, mesa: calcula `newSubtotalGross = subtotal + tax` y lo pasa como base, **bruto**); `:4223-4225` y `:4244-4265` (llamador 3, POS retail: **no llama** a `resolveTip`, reimplementa la regla en línea sobre `calculatedSubtotalGross`). Ficha de origen: F-008 en `docs/critical-plans/CP-pos-order-flows-audit/findings/` (propina sobre bruto en POS vs neto en flow; la base la elige el dueño en un ADR antes de ejecutar).
- **Business decision:** **Decisión del dueño delegada y registrada en ADR-11:** la base única es el subtotal bruto de productos (subtotal + impuesto, sin envío ni propina). El dueño pidió la recomendación el 2026-09-23 y el orquestador eligió la propuesta del plan. La regla vive en un solo lugar y los tres carriles la llaman.
- **Why:** Tres carriles, tres bases. Un 10 % sobre una cuenta de $100.000 + $19.000 de IVA da $10.000 por el detalle de orden y $11.900 por el POS y por la mesa: $1.900 de diferencia sobre la misma venta, sin ningún error visible. Peor que la divergencia numérica es la estructural: el carril de POS retail (`payments.service.ts:4244-4265`) **reimplementa** el cálculo en vez de llamar a la utilidad, así que cualquier arreglo hecho en `tip.util.ts` deja ese carril intacto y la divergencia sobrevive al arreglo. Y el docblock de la propia utilidad contradice a dos de sus tres consumidores, así que quien lea la utilidad para entender la regla se lleva la versión que casi nadie aplica. La propina es dinero de un tercero: la diferencia no la absorbe la tienda, la absorbe el mesero.
- **Output:** (1) Un ADR corto que fija la base elegida, con la cifra del ejemplo y quién decidió. (2) Los tres carriles pasan por `resolveTip` con la misma base: el llamador de POS retail deja de reimplementar y llama a la utilidad. (3) El docblock de `tip.util.ts` dice lo que el código hace. (4) Un test de tabla que fija la cifra esperada para los tres carriles con los mismos números de entrada, de modo que una divergencia futura falle en CI en vez de aparecer en una cuenta.
- **Contracts touched:** FB-01 (`POST /store/payments/pos`, carril retail: la propina deja de calcularse en línea), FB-03 (el mismo endpoint en su forma de mesa, que ya usa bruto), FB-04 (`POST /store/orders/:id/flow/pay`, el carril que hoy usa neto), DB-02 (invariante de `orders`: `grand_total ≥ Σ pagos`; la propina suma al total y no puede desbalancearlo). La propina no tiene código de error propio: no hay fila de `registry/err.md` que tocar, porque el defecto no rechaza nada — calcula distinto.
- **Data impact:** Escribe un valor distinto en las columnas de propina de `orders` y en el monto de `payments` de las ventas **nuevas** que incluyan propina porcentual, en la dirección que fije el ADR. No reescribe ninguna fila histórica: reliquidar propinas ya entregadas al mesero no es reparable por software. **Sin migración**: las columnas existen y solo cambia el valor calculado. La propina sigue fuera de `subtotal_amount` y de `tax_amount` y dentro de `grand_total`: si el paso la moviera de sitio, el asiento contable perdería su contrapartida de pasivo — eso no se toca aquí.
- **Blast radius:** Si la base cambia sin ADR y sin avisar a la tienda, los meseros ven caer (o subir) su propina de un día para otro sin explicación: lo notan el mismo turno. Si el carril retail se migra a la utilidad con el redondeo distinto del que usaba en línea, aparecen diferencias de un peso en el arqueo: lo nota el cajero al cierre de caja y se lee como faltante. Si la propina se recalculara sobre un total que ya la incluye, se compone sobre sí misma y `grand_total` deja de cuadrar con los pagos: lo delata la consulta de DB-02. El radio no sale del dinero de la venta, pero toca las tres pantallas donde se cobra.
- **Rollback:** Revertir el commit del paso y el ADR queda marcado como revertido, no borrado. Las ventas cobradas mientras estuvo vivo conservan su propina calculada con la base nueva y **no se reliquidan**: el dinero ya se entregó. Se identifican por `created_at > :deploy` cruzado con propina distinta de cero. El rollback devuelve la divergencia original, que es un estado conocido y no un estado roto.
- **Verification:**
  - `npx jest --runInBand apps/backend/src/common/utils/tip.util.spec.ts` — tabla de casos con la base elegida, incluido el caso de porcentaje sobre cuenta con impuesto.
  - `npx jest --runInBand apps/backend/src/domains/store/payments` y `npx jest --runInBand apps/backend/src/domains/store/orders/order-flow` — los tres carriles contra la misma tabla de cifras.
  - `grep -rn "resolveTip" apps/backend/src` → exactamente tres llamadores y ninguna reimplementación → `evidence/E.6-llamadores-resolvetip.txt`.
  - `curl -s -X POST "$API/store/payments/pos" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"store_payment_method_id":1,"tip_percentage":10,"items":[{"product_id":1,"quantity":1,"unit_price":100000}]}' | tee evidence/E.6-tip-retail.json`
  - El mismo porcentaje por el carril de mesa y por `flow/pay` sobre una orden equivalente → `evidence/E.6-tip-mesa.json` y `evidence/E.6-tip-flow-pay.json`; las tres cifras de propina deben coincidir.
  - SQL de DB-02: `SELECT p.order_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.state IN ('succeeded','captured') GROUP BY p.order_id, o.grand_total HAVING SUM(p.amount) > o.grand_total + .01;` → 0 filas → `evidence/E.6-db02.txt`.
- **Acceptance checklist:**
  - [x] El dueño eligió la base y la elección está escrita en ADR-11 antes de tocar código.
  - [ ] Los tres carriles calculan la misma propina para los mismos números de entrada.
  - [ ] El carril de POS retail llama a la utilidad compartida y no reimplementa la regla.
  - [ ] Existe un único llamador del redondeo de propina y es el mismo en los tres carriles.
  - [ ] El docblock de la utilidad describe la base que el código realmente usa.
  - [ ] Hay un test de tabla que falla si un carril vuelve a divergir.
  - [ ] La propina sigue sumando al total sin entrar en el subtotal ni en el impuesto.
  - [ ] Ninguna venta queda con pagos por encima de su total tras el cambio.
  - [ ] Ninguna propina histórica se reliquida ni se reescribe.
  - [ ] Un cobro con propina de cero se comporta igual que antes en los tres carriles.
- **Status:** in-progress — ADR-11 aceptado por elección delegada del dueño; código unificado en `evidence/E6-tip-base-code-20260923.md`, Jest 249/249; falta curl/SQL de los tres carriles.
