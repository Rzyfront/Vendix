# C.3 S1 — lock KDS ERR-07: veredicto UI + prueba API (QA local 2026-09-24)

Runner: boss-e2e · Tienda #10 (Roku) · cuentas seed `mesero.e2e@roku.test` (#241) / `cocina.e2e@roku.test` (#242).

## Fixture (curl, setup oficial)

- Orden mostrador **#1202** (`ORD2609240007`) + fire → ticket **#118** (`pending`, Cocina #1, COGS=0).
  Producto #333 sin receta → botón Iniciar **deshabilitado** en UI ("Falta receta — no se puede iniciar").
- Orden mostrador **#1205** (`ORD2609240010`, producto #429 "Pollo Árabe E2E" variante #471 "No Picante",
  receta activa #9) + fire → ticket **#121** (`pending`, Cocina #1, COGS=0). Botón Iniciar **habilitado**.
- Turno KDS **#46** abierto oficialmente por cocinero #242 en Cocina #1 (HTTP 201; el 409 posterior
  `KDS_SESSION_ALREADY_OPEN` fue mi propio doble-POST, sin efecto).

## API — PROBADO ✅ (mesero, distinto al dueño del turno)

| Sonda | Resultado |
|---|---|
| `POST /store/kitchen-fire/tickets/118/start` | **403 `KDS_STATION_LOCKED`** — "Otro operador tiene esta estación. Pídele que cierre su turno o solicita a un administrador que tome la estación." |
| `POST /store/kitchen-fire/tickets/121/start` | **403 `KDS_STATION_LOCKED`** (mismo copy) |
| Estado posterior | #118 y #121 siguen **`pending`**, `kds_id=1` (listado `GET /tickets?limit=200`) |

Crudo: `/tmp/c3-s1-start-probe.json`, `/tmp/c3-s1b-probe.json`, `/tmp/c3-s1-order.json`, `/tmp/c3-s1b-order.json`.

## UI (mesero, Playwright) — TOAST INALCANZABLE POR DISEÑO ❌→N/A

Recorrido real: login `https://vendix.com` → `/admin/restaurant-ops/kds` → clic **Iniciar** sobre
ticket #11/ORD2609240010 → modal "Verificar ticket para cocinar" (solo `GET .../tickets/121/verification` 200)
→ clic **"Cocinar sin cambios"** → el modal cierra y **NO se dispara ningún POST** (network verificado:
cero llamadas a `tickets/121/start`). En su lugar abre el diálogo de compuerta de turno (ver screenshot):

> **"Sin turno abierto"** — "Para gestionar tickets de esta estación necesitas un turno abierto.
> Pulsa Iniciar turno en la barra superior del tablero."

Tres capas impiden que el mesero llegue al 403 del servidor, todas por diseño:

1. **Gate de cliente QUI-651** (`runMutation`, `kds-board-page.component.ts:1415`): sin `openSession()`
   no hay mutación; abre el aviso y retorna. El mesero nunca tiene sesión.
2. **RBAC**: `GET /store/kds` → 403 (falta `store:kds:read`) y
   `GET /store/kds-sessions/open/1` → 403 `AUTH_PERM_001` → `openSession` nunca se vuelve no-null
   (únicos writers: `kds-stations.service.ts:245/274/333`, todos tras endpoints 403 para mesero).
3. **"Iniciar turno" deshabilitado** para mesero (sin estación seleccionable no hay apertura).

El toast `KDS_STATION_LOCKED` solo es alcanzable en UI por un segundo usuario de cocina no-privilegiado
con turno propio actuando sobre estación ajena fresca — y **el único cocinero de la tienda es #242**
(ya documentado en `C3-station-lock-and-codes-20260923.md`). Crear ese usuario es decisión de seed/datos,
no E2E.

## Consola / red durante el flujo mesero

- **0 excepciones JS.** 6 errores de recurso, todos 403 pre-existentes por rol waiter (ruido, no regresión):
  `subscriptions/current` ×2, `subscriptions/payment-methods`, `weekly-report/latest`, `support/pqr/stats`,
  `store/kds`. Backend confirma `PERMISSION_DENIED` en logs.
- Tras confirmar "Cocinar sin cambios": **cero POST** a kitchen-fire (solo poll de notificaciones).

## Evidencia

- Screenshot: `evidence/C.3-lock-toast.png` — muestra el **diálogo de compuerta "Sin turno abierto"**
  (no existe toast que capturar; el nombre de archivo sigue la receta).
- Limpieza: turno #46 cerrado por API oficial; órdenes #1202/#1205 canceladas `flow/cancel` 200
  (`kitchenDisposition:"waste"`). Ver Survey/S2(b) antes de limpiar (mismo turno).

## Propuesta de cierre S1 (decide dueño/orquestador)

Declarar S1-toast **N/A-por-diseño** (extensión del ajuste explícito de la receta §422):
la UI impide la acción tres capas antes que el servidor — mejor UX que el toast — y código+mensaje+HTTP
quedan probados por curl (aquí + matriz `C3-station-lock-and-codes`). Alternativa: sembrar un segundo
cocinero y re-correr.
