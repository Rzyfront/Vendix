---
id: B.5
title: "Aviso de mesa que venía de limpieza"
phase: B
status: done
owner: Fabio
updated: 2026-09-23
contracts: [FB-46, DB-21, ERR-39]
adrs: []
skills: [vendix-backend, vendix-restaurant-ops, vendix-error-handling, vendix-frontend, vendix-zoneless-signals, how-to-test]
---
# B.5 — Aviso de mesa que venía de limpieza

- **Skills:** `vendix-backend` (el retorno de apertura gana un campo dentro de la misma transacción) · `vendix-restaurant-ops` (qué significa limpieza en el ciclo de una mesa) · `vendix-error-handling` (es un aviso con respuesta exitosa, no un rechazo: el catálogo y el mapeo de mensajes deben distinguirlo) · `vendix-frontend` y `vendix-zoneless-signals` (el aviso se pinta como toast desde el modal de apertura, sin bloquear el flujo) · `how-to-test`.
- **Resources:** `apps/backend/src/domains/store/tables/table-sessions.service.ts:432-435` (la escritura: `tx.tables.update({ data: { status: 'occupied' } })`, un **setter puro que nunca lee el estado anterior**), `:460` (`openSession` solo comprueba `occupied`, nunca `cleaning`), `:173-179` (`CreatedOpenSession`, hoy sin el campo del estado previo) y `:363-386` (`createOpenSessionInTx`) · `apps/frontend/src/app/private/modules/store/pos/.../pos-open-table-modal` (~`:500`, el consumidor de la apertura) · registry `registry/fb.md` fila FB-46, `registry/db.md` fila DB-21 (invariante: *`cleaning→occupied` avisa, no bloquea*), `registry/err.md` fila ERR-39 (`TABLE_REOPENED_FROM_CLEANING_001`, HTTP 200, AVISO, NO BLOQUEA) · ficha de origen `F-020` en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** Abrir una cuenta sobre una mesa que estaba en limpieza **se permite y se avisa**; no se bloquea. Lo fija la registry como invariante de `tables.status` y ERR-39 lo declara como aviso con respuesta exitosa: el tile sigue clicable. No hay ADR porque no hubo alternativa de negocio en disputa —bloquear dejaría al mesero sin poder sentar a un cliente por un estado que a veces nadie limpia—. Si el dueño quisiera bloquear, sería una decisión nueva y este paso no la anticipa.
- **Why:** La transición de limpieza a ocupada hoy es invisible por construcción: la escritura es un `update` que fija `occupied` sin leer lo que había, así que nadie —ni el servidor ni la pantalla— puede saber que la mesa venía de limpieza. El caso real es un cliente sentado en una mesa que el personal no alcanzó a limpiar: el mesero abre la cuenta, el sistema calla, y el problema aparece cuando llega la comida. El arreglo es barato y no cambia la escritura: leer el estado previo dentro de la misma transacción y devolverlo, para que la pantalla pueda decirlo.
- **Output:** El estado previo de la mesa leído dentro de la transacción de apertura y devuelto en el retorno de creación de sesión; el campo declarado en el contrato de apertura; el código de aviso registrado con su mensaje de frontend; el checkout POS mostrando un toast de advertencia cuando la mesa venía de limpieza, **sin interrumpir** la apertura ni exigir confirmación; el tile de mesa en limpieza sigue siendo clicable. El picker real usa `selectOnly=true`: el POST ocurre al guardar borrador o al cobrar, no al seleccionar.
- **Contracts touched:** FB-46 (el retorno de apertura gana el estado previo), DB-21 (se lee `tables.status` antes de escribirlo; la escritura no cambia), ERR-39 (código de aviso nuevo, con respuesta exitosa).
- **Data impact:** none — `tables.status` se sigue escribiendo exactamente igual que hoy, a ocupada; lo único nuevo es una **lectura** del valor anterior dentro de la misma transacción. Sin DDL, sin columna nueva y sin backfill: el estado previo es un dato de tránsito que viaja en la respuesta, no se persiste. Si el negocio pidiera después un historial de transiciones de mesa, eso sí sería una tabla nueva y queda explícitamente fuera de este plan.
- **Blast radius:** Bajo. El riesgo es de forma, no de datos: añadir un campo al retorno de apertura puede romper un consumidor que valide la forma de la respuesta con lista blanca. El riesgo de producto es el contrario del que parece: si el aviso se implementa como confirmación bloqueante, se convierte en un clic extra en cada apertura y el personal aprende a ignorarlo. Lo nota el mesero en cada apertura de mesa.
- **Rollback:** Trivial: revertir el commit quita el campo del retorno y el toast del modal. Ninguna fila escrita que deshacer, ningún estado de mesa alterado. El código de aviso puede quedarse en el catálogo sin emisor: es deuda de catálogo, no un defecto de runtime.
- **Verification:**
  - `psql "$DATABASE_URL" -c "UPDATE tables SET status='cleaning' WHERE id=$TABLE_ID;"` (preparación del escenario en entorno local, nunca en producción)
  - `curl -sk -o ../evidence/B.5-open-cleaning.json -w '%{http_code}\n' -X POST "https://api.vendix.com/api/store/table-sessions" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"table_id\":$TABLE_ID,\"guest_count\":2}"` (espera 201/200 con el estado previo en el cuerpo, nunca un rechazo)
  - `jq '.data.previous_table_status' ../evidence/B.5-open-cleaning.json` (espera el estado de limpieza)
  - `psql "$DATABASE_URL" -c "SELECT id, status FROM tables WHERE id=$TABLE_ID;"` (espera ocupada: la escritura no cambió)
  - `curl -sk -o ../evidence/B.5-open-libre.json -X POST "https://api.vendix.com/api/store/table-sessions" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"table_id\":$FREE_TABLE_ID,\"guest_count\":2}" && jq '.data.previous_table_status' ../evidence/B.5-open-libre.json` (mesa libre: sin aviso)
  - `grep -n "TABLE_REOPENED_FROM_CLEANING_001" apps/backend/src/common/errors/error-codes.ts apps/frontend/src/app/shared/utils/error-messages.ts`
  - `npm --prefix apps/backend run test:path -- src/domains/store/tables/table-sessions.service.spec.ts`
  - Playwright MCP — abrir una cuenta sobre una mesa en limpieza desde el POS y confirmar que aparece el aviso y que la apertura se completa sin confirmación extra; guardar en `evidence/B.5-e2e-limpieza.md`
- **Acceptance checklist:**
  - [x] El estado previo de la mesa se lee dentro de la misma transacción que la apertura
  - [x] La escritura del estado de mesa no cambia: sigue fijando ocupada
  - [x] El retorno de creación de sesión incluye el estado previo
  - [x] El contrato de apertura declara el campo nuevo
  - [x] Abrir sobre una mesa en limpieza devuelve respuesta exitosa, nunca un rechazo
  - [x] El tile de una mesa en limpieza sigue siendo clicable
  - [x] El checkout POS muestra un aviso tras apertura exitosa cuando la mesa venía de limpieza, tanto al guardar borrador como al cobrar
  - [x] El aviso no interrumpe el flujo ni exige confirmación adicional
  - [x] Abrir sobre una mesa libre no muestra ningún aviso
  - [x] El código de aviso está registrado con su mensaje de frontend
  - [x] No se añade columna, migración ni historial de transiciones de mesa
  - [x] Hay un test que cubre los dos caminos: mesa en limpieza y mesa libre
  - [x] Las filas FB-46, DB-21 y ERR-39 quedan marcadas con su evidencia enlazada
- **Status:** done · Fabio · 2026-09-23 · backend/modal/contrato en `c72634710`, `640ba2bcc`, `627ab494a`; cobro POS en `a1531ae4c` y borrador real en `5bfeabed6`. Playwright: cobro mesa #19 en limpieza 201 + toast; borrador mesa #23 en limpieza 201 + toast, mesa #24 libre 201 sin aviso. `evidence/B5-direct-pos-cleaning.md`, `evidence/B5-draft-checkout.md`. La apertura real de borrador sucede en el shell, no en el picker `selectOnly`.
