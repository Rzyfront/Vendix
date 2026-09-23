---
id: B.3
title: "`session_paid` en el whitelist SSE y suscripción de la página de mesa"
phase: B
status: in-progress
owner: Mencius
updated: 2026-09-20
contracts: [FB-42, FB-43, FB-45, DB-17]
adrs: [ADR-03]
skills: [vendix-backend, vendix-restaurant-ops, vendix-frontend, vendix-zoneless-signals, how-to-test]
---
# B.3 — `session_paid` en el whitelist SSE y suscripción de la página de mesa

- **Skills:** `vendix-backend` (el whitelist y el snapshot del stream) · `vendix-restaurant-ops` (qué significa una mesa pagada para el mesero) · `vendix-frontend` y `vendix-zoneless-signals` (la unión discriminada de eventos y el estado de la página se llevan por signals; una suscripción nueva exige limpieza en `DestroyRef`) · `how-to-test`. **`[Sin skill — knowledge gap]`** para el propio patrón del SSE de staff con whitelist default-deny: `vendix-notifications-system` cubre el SSE de notificaciones y `vendix-restaurant-table-qr` el del comensal, pero ninguno documenta este stream ni su lista blanca. Haría falta un skill `vendix-staff-sse` con el contrato: whitelist explícita, unión discriminada en el frontend y snapshot inicial coherente con los eventos.
- **Resources:** ADR-03 §Context (*"El evento `session_paid` existe … pero el whitelist default-deny del SSE de staff no lo incluye y ningún cliente lo escucha"*) · `apps/backend/src/domains/store/tables/table-sessions.controller.ts:51-82` (`STAFF_EVENT_WHITELIST`, con `return false` como salida por defecto y sin `session_paid`) · `apps/backend/src/domains/store/tables/table-sessions.service.ts:1628-1654` (`emitSessionPaid`, ya escrito y ya emitiendo) y `:1724` (`listActiveSessions`, el snapshot: hoy sin `paid_at`) · `apps/backend/src/domains/store/tables/tables.service.ts:23-58` y `:766-778` (`FloorMapTable.active_session`, hoy sin `paid_at`) · `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/admin-tables-sse.service.ts:109-170` (la unión `AdminTablesEvent`, sin `session_paid`) · `.../tables/pages/table-session-page/table-session-page.component.ts:134-144` (inyecta el SSE del KDS en `:136`, **no** el de mesas) · registry `registry/fb.md` filas FB-42, FB-43, FB-45 · ficha de origen `F-027` en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** Que una cuenta esté pagada tiene que verse en la mesa **sin recargar**. Es la mitad visible de ADR-03: la proyección de B.1/B.2 escribe el dato, y sin este paso el mesero sigue sin enterarse. No hay alternativa de negocio en disputa; el dueño ya decidió la semántica (pagada y ocupada), aquí solo se transporta.
- **Why:** El evento ya se emite y nadie lo recibe: el whitelist del stream de staff es default-deny y no lista `session_paid`, así que el servidor lo descarta antes de escribirlo al cliente. Aunque pasara, no llegaría a ninguna vista: la unión de eventos del frontend no lo declara y la página de mesa ni siquiera está suscrita a ese stream —inyecta el SSE del KDS—. Y aunque llegara el evento, el snapshot inicial no trae `paid_at`, así que un mesero que abre la pantalla **después** del cobro vería la cuenta sin marcar: el estado en vivo y el estado inicial tienen que contar la misma historia o el arreglo solo funciona para quien ya estaba mirando.
- **Output:** `session_paid` en el whitelist del stream de staff; `paid_at` en el snapshot de sesiones activas y en la sesión activa del mapa de salón; la variante `session_paid` declarada en la unión discriminada del frontend con su forma real; la página de mesa suscrita al stream de mesas y reaccionando al evento marcando la cuenta como pagada sin recargar, con la suscripción liberada al destruir el componente. Indicador visible de cuenta pagada en la página de mesa y en el tile del mapa de salón.
- **Contracts touched:** FB-42 (whitelist del stream y unión del frontend), FB-43 (snapshot de sesiones activas gana `paid_at`), FB-45 (`active_session` del mapa de salón gana `paid_at`; B.4 vuelve al mismo constructor de fila para el mesero), DB-17 (se lee `paid_at`, no se escribe).
- **Data impact:** none — el paso solo lee `table_sessions.paid_at` y lo transporta por SSE y por dos respuestas HTTP. Ninguna escritura, ningún DDL: la columna y su índice `(store_id, paid_at)` ya existen.
- **Blast radius:** El whitelist es un mecanismo de seguridad: añadir un evento amplía lo que sale al cliente, y si la carga del evento lleva más de lo necesario, expone datos de la tienda por un canal que no valida por evento. Una suscripción nueva sin limpieza deja conexiones abiertas por cada visita a la página de mesa y lo nota el servidor antes que el usuario. Si el snapshot y el evento no coinciden en forma, la pantalla parpadea entre pagada y no pagada. Lo ven meseros y encargados en tiempo real.
- **Rollback:** Trivial y por capa: quitar el evento del whitelist lo vuelve a descartar en el servidor; quitar la suscripción del frontend deja el resto intacto. Nada escrito en datos que revertir. Revertir solo la parte de `paid_at` en el snapshot deja el evento en vivo funcionando, con la incoherencia conocida para quien abre la pantalla tarde.
- **Verification:**
  - `curl -skN "https://api.vendix.com/api/store/table-sessions/stream?token=$TOKEN" | head -c 4000 | tee ../evidence/B.3-sse.txt` (cobrar la mesa en otra terminal y confirmar que aparece el evento)
  - `curl -sk -H "Authorization: Bearer $TOKEN" "https://api.vendix.com/api/store/tables/floor-map" | tee ../evidence/B.3-floormap.json | jq '.data[].active_session'` (espera `paid_at` presente)
  - `grep -n "session_paid" apps/backend/src/domains/store/tables/table-sessions.controller.ts apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/admin-tables-sse.service.ts`
  - `grep -n "paid_at" apps/backend/src/domains/store/tables/tables.service.ts apps/backend/src/domains/store/tables/table-sessions.service.ts | tee ../evidence/B.3-snapshot.txt`
  - `npm --prefix apps/backend run test:path -- src/domains/store/tables/table-sessions.controller.spec.ts`
  - `npx --prefix apps/frontend ng test --include='**/admin-tables-sse.service.spec.ts' --watch=false --browsers=ChromeHeadless`
  - Playwright MCP — abrir la página de una mesa, cobrar la orden desde otra pestaña y confirmar que la cuenta se marca pagada sin recargar; repetir recargando la página para validar el snapshot; guardar en `evidence/B.3-e2e-mesa-pagada.md`
- **Acceptance checklist:**
  - [x] El evento de cuenta pagada está en el whitelist del stream de staff
  - [x] El whitelist conserva su salida por defecto en denegar: ningún evento nuevo pasa por accidente
  - [x] La carga del evento lleva solo lo necesario para pintar el estado, sin datos ajenos a la sesión
  - [x] La unión discriminada del frontend declara la variante con la forma real que emite el servidor
  - [x] La página de mesa se suscribe al stream de mesas, no solo al del KDS
  - [x] La suscripción se libera al destruir el componente
  - [x] La cuenta se marca pagada en vivo, sin recargar
  - [x] El snapshot inicial del stream incluye la marca de pago
  - [x] La sesión activa del mapa de salón incluye la marca de pago
  - [x] Abrir la pantalla después del cobro muestra el mismo estado que verla en vivo
  - [x] Hay un test del whitelist que falla si el evento se quita de la lista
  - [ ] FB-42/FB-43/FB-45 verificados; DB-17 global sigue abierto por sesiones históricas sin `paid_at`
- **Status:** in-progress · Fabio · 2026-09-23 · SSE/snapshots/página `1316bfae5`, tile `86138fbd5`. `evidence/B3-live-paid.md`: Playwright página sesión #113 muestra Pagada sin reload tras POST 201/pago #828 y sigue pagada tras reload; stream emitió `session_paid`. Backend whitelist 1/1, frontend SSE 2/2, watcher OK. DB-17 no cierra: 13 sesiones antiguas pagadas tienen `paid_at=NULL` (`evidence/B3-legacy-paid-at.txt`); se pidió decisión sobre backfill idempotente.
