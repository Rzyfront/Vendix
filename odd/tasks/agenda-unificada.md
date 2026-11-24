# Agenda unificada: Programación, Agenda, Hotelería y Reportes

Objetivo: que cada negocio vea lo que tiene programado en un solo lugar (Órdenes → Programación y Agenda), que Hotelería tenga una sola puerta de entrada para sus reservas (Recepción), que la limpieza se asigne al cerrar el checkout y que los reportes vivan en Reportes y analíticas, filtrados por industria.
Decisión de Rafael: `~/.openclaw/tmp/vendix-agenda/DECISION-RAFAEL-2026-11-23.md` + requisito de prestadores (`REQUISITO-F1-PRESTADORES-2026-11-23.md`). Análisis previo: `analisis-agenda-unificada.md`.
Rama F1: `feat/agenda-unificada-f1` desde `origin/develop` 25c8b7802. Una rama/PR por fase.
Runner: backend `cd apps/backend && npx jest -c jest.isolated.config.js --runInBand <spec>`; frontend `cd apps/frontend && npx ng test --include <spec> --watch=false --browsers=ChromeHeadless` (cada spec nuevo entra en la lista Karma de `.github/workflows/ci.yml`). Un spec por invocación.
Skills: `vendix-frontend`, `vendix-ui-ux`, `vendix-frontend-data-display`, `vendix-frontend-routing`, `vendix-panel-ui`, `vendix-backend`, `vendix-date-timezone`.
Fuera de alcance: centralizar tareas (limpieza, CRM…) en un solo lugar.

Rutas: FE = `apps/frontend/src/app/`, BE = `apps/backend/src/`, PRISMA = `apps/backend/prisma/schema.prisma`.

## Decisiones abiertas (producto, no las decido yo)

- **D1 — Nombre del rol de limpieza (F3).** Ya existe el rol de sistema `housekeeper` (BE `common/constants/lodging-roles.constant.ts:12`, sembrado en `prisma/seeds/permissions-roles.seed.ts:5117`, la UI lo llama «Camarera»). Propuesta: mostrarlo como **«Camarera(o) de piso»** (texto neutro y conocido en Colombia) sin cambiar la clave interna. Alternativa: «Housekeeping».
- **D2 — ¿Llegadas se fusiona con Reservas en Recepción (F2)?** Las dos muestran reservas de hotel; Llegadas es el filtro «llegan hoy» con check-in. Propuesta: no fusionar en F2 (Reservas = lista completa paginada; Llegadas = operación del día) y revisarlo con uso real.
- **D3 — KPIs de la antigua pantalla Reservas (F1).** «Reservas de hoy / Pendientes / Confirmadas / Tasa de cancelación» y el panel «Reservas de hoy» no pasaron a Programación (la decisión pide una tabla). ¿Se agregan como tarjetas de Programación?
- **D4 — Arrastrar para reprogramar en la Agenda (F1).** El calendario viejo de Reservas y la agenda de pedidos permitían arrastrar. En F1 se reprograma desde el detalle (reserva) o con «Reprogramar» (pedido). ¿Se pide drag & drop en la Agenda?
- **D5 — Restaurante y reservas de mesa.** `orders_reservations` es solo `service`; un restaurante no ve sus `bookings.table_id` en Programación. ¿Se habilita la fuente de reservas para restaurante filtrada a mesas?

## F1 — Programación + Agenda en Órdenes (implementada en este PR)

### Historia de usuario
Como dueño o administrador de una tienda de servicios o de un restaurante en el panel (escritorio o celular), quiero ver en Órdenes → Programación una sola tabla con mis reservas de servicio y mis pedidos programados, y en Órdenes → Agenda un solo calendario con ambos, con los mismos filtros (tipo, personal/prestador, estado, fecha, búsqueda), para saber qué tengo que atender sin saltar entre «Reservas» y «Pedidos programados», y seguir configurando a mis prestadores y su disponibilidad desde ahí.

**Pasos para probar (humanos, en pantalla):**
1. Inicia sesión como `owner@techsolutions.co` en una tienda con industria servicio (y restaurante, con Configuración → Pedidos programados activo) en `https://vendix.com`.
2. Abre Órdenes. Ves «Programación» y «Agenda»; ya no ves «Reservas» ni «Pedidos programados».
3. En Programación ves reservas y pedidos desde hoy, en orden de hora. Filtra por Tipo, Estado, Personal y Fecha en «Opciones»; busca por número o cliente; cambia de página.
4. Toca una reserva: se abre su detalle de siempre (confirmar, check-in, iniciar, completar, re-agendar, notas, anticipo). Toca un pedido: se abre su detalle (enviar a cocina, ver orden). «Reprogramar» de un pedido ofrece solo franjas con cupo.
5. En la cabecera toca «Equipo de servicio» o «Disponibilidad»: llegas a las pantallas de siempre de Reservas.
6. Abre Agenda: semana actual (celular: día). Cambia a Mes y toca un día: abre ese día. En «Opciones» filtra Personal = un prestador: lo que queda fuera de su horario aparece sombreado, y un día con excepción dice «No disponible: <motivo>».
7. Entra por un enlace viejo `/admin/reservations` o `/admin/scheduled-orders`: llegas a Programación.

**Criterios de aceptación:**
- [x] Una tabla con ambas fuentes, clasificadas por tipo, paginada en servidor, con filtros múltiples (tipo, personal, estado, rango de fechas, búsqueda).
- [x] Un calendario mes/semana/día con ambas fuentes y los mismos filtros, en la zona horaria de la tienda.
- [x] Las acciones de cada fila abren el flujo propio de su módulo; no se reimplementa ninguna regla de negocio.
- [x] Una fuente aparece solo si su industria, su permiso de lectura y (pedidos) el ajuste de la tienda la habilitan. Una tienda retail no ve las entradas.
- [x] La configuración de prestadores y de Reservas sigue alcanzable desde Programación y Agenda (lista ruta por ruta abajo).
- [x] Con filtro de prestador, la Agenda respeta su disponibilidad: horario, bloqueos y excepciones.
- [x] No quedan calendarios duplicados en el menú: el de Reservas y la agenda de pedidos solo se alcanzan por redirect a Programación.

### Specs
**Contexto:** Reservas (`bookings`) y Pedidos programados (`order_fulfillment_schedules`) tenían cada uno su entrada de menú, su calendario hecho a mano, su leyenda y su cálculo de fechas (análisis §2.2).
**Decisiones que aplica:** Programación reemplaza «Reservas» y «Pedidos programados»; Agenda es el único calendario; configuración de reservas accesible desde ambas; disponibilidad del prestador gobierna la Agenda; ninguna configuración se pierde.
**Enfoque:** endpoint de solo lectura `GET /store/scheduling/{sources,events,calendar}` con un adaptador por fuente que normaliza a `SchedulingEvent` (tipo, inicio/fin UTC + fecha/hora locales, estado nativo + grupo común, personal, cliente, referencia). La tabla mezcla las fuentes en servidor (cada una cuenta y devuelve sus primeras `page*limit` filas; ventana máxima 5 000). Alternativa descartada: endpoint por fuente desde el front (paginación mezclada imposible sin traer todo).
**Sin migraciones.** Contratos existentes intactos (aditivo).

**Backend (nuevo, `BE/domains/store/scheduling/`):**
- `scheduling.types.ts` — evento común, grupos de estado, fuentes (`module_key`, permiso).
- `sources/booking-scheduling.source.ts` — `bookings`: filtro/orden/`count` en base, `provider_id` = personal, fecha+`HH:MM` locales → UTC con la zona de la tienda; reserva nocturna termina al día siguiente.
- `sources/scheduled-order-scheduling.source.ts` — `order_fulfillment_schedules`: reutiliza `deriveFulfillmentDisplayStatus` y `kitchenPendingItemsWhere` (`BE/domains/store/scheduled-orders/scheduled-orders.service.ts:91,147`) con un `groupBy` por rango (sin N+1); tope de lectura 2 000 con `truncated`.
- `sources/provider-availability.ts` — horario por día de los prestadores filtrados: `provider_schedules` activos + `provider_exceptions` del rango (2 consultas), mismas reglas que `BE/domains/store/reservations/providers/provider-availability.service.ts:211-226`.
- `scheduling.service.ts` — habilitación por fuente: `industryAllowsKey(module_key)` + permiso del contexto + `scheduled_orders.enabled`; si falta, la fuente se omite (sin 403).
- `scheduling.controller.ts` — `@Permissions('store:reservations:read','store:scheduled_orders:read')` (cualquiera); sin `@IndustryModule` porque la industria se evalúa por fuente.
- `BE/domains/store/store.module.ts:48,153` — registra `SchedulingModule`.

**Frontend (nuevo, `FE/private/modules/store/scheduling/`):** `pages/scheduling-list-page` (tabla `app-responsive-data-view` + `app-options-dropdown` + `app-pagination`), `pages/scheduling-agenda-page`, `components/event-calendar` (rejilla propia mes/semana/día; sin librerías), `components/scheduling-record-host` (abre `booking-detail-modal`, `reservation-form-modal`, `schedule-detail-modal`), `components/scheduled-order-reschedule-modal` (franjas de `/scheduled-orders/availability`), `utils/` (cálculo del calendario, filtros, accesos).

**Menú, permisos, módulos e industrias:**
- `FE/private/layouts/store-admin/store-admin-menu-items.ts` (Órdenes) — quita «Reservas» y «Pedidos programados»; agrega «Programación» y «Agenda» con `panelUiAnyOf: ['orders_reservations','orders_scheduled']`. «Solicitudes de pago», «Equipo de Servicio» y «Estaciones de Servicio» siguen.
- `FE/shared/components/sidebar/sidebar.component.ts` — campo nuevo `panelUiAnyOf`.
- `FE/core/services/menu-filter.service.ts` — caso 1b: la entrada se ve si al menos una key pasa sola todas las capas (panel usuario/tienda, industria, plan) y `orders_scheduled` exige `scheduledOrdersEnabled`. **No hay key nueva:** se habilita con las de siempre (`orders_reservations` = servicio; `orders_scheduled` = restaurante/manufactura + ajuste), así que planes, roles y `MODULE_INDUSTRIES` (BE y FE) no cambian.
- `FE/routes/private/store_admin.routes.ts` — `orders/scheduling` y `orders/agenda` (antes de `orders/:id`); `reservations` `''` → redirect `/admin/orders/scheduling`. `FE/private/modules/store/scheduled-orders/scheduled-orders.routes.ts` — `''` → mismo redirect. Subrutas intactas.
- `FE/core/services/breadcrumb.service.ts` — migas de las dos rutas.

### Lista de verificación: configuración de Reservas que sigue alcanzable (ruta por ruta)

| Pantalla / acción de Reservas | Ruta | Cómo se llega ahora |
|---|---|---|
| Equipo de servicio (prestadores, horarios semanales, excepciones/bloqueos, servicios por prestador) | `/admin/reservations/schedules` | Menú Órdenes → Equipo de Servicio; botón de cabecera en Programación y Agenda; Opciones |
| Disponibilidad de proveedores | `/admin/reservations/availability` | Botón de cabecera en Programación y Agenda; Opciones |
| Cola de atención | `/admin/reservations/queue` | Opciones en Programación y Agenda (antes solo por URL) |
| Solicitudes de reagenda | `/admin/reservations/reschedule-requests` | Opciones en Programación y Agenda |
| Solicitudes de pago | `/admin/reservations/payment-requests` | Menú Órdenes (sin cambio); Opciones |
| Horario del negocio | `/admin/reservations/business-hours` | Opciones (antes solo por URL) |
| Recordatorios de servicio | `/admin/reservations/reminders` | Opciones (industria servicio) |
| Estaciones de servicio / sesión | `/admin/services/stations` | Menú Órdenes (sin cambio); Opciones (industria servicio) |
| Exportar reporte de reservas | modal `report-export-modal` | Opciones → «Exportar reservas» en Programación |
| Nueva reserva / Llegada sin reserva | modal `reservation-form-modal` | Botón «Nueva reserva» en Programación y Agenda |
| Bloquear horario | `/admin/reservations/schedules` | Igual que Equipo de servicio |
| Detalle: confirmar, cancelar, no asistió, check-in, llegando/atendiendo, iniciar, completar, re-agendar, notas, anticipo, cobro para reservar, atender consulta | modal `booking-detail-modal` | Clic en la fila o en el evento |
| Pedidos: producción del día / insumos | `/admin/scheduled-orders/day`, `/production` | Opciones (pedidos activos) |
| Pedido: detalle, enviar a cocina, ver orden | modal `schedule-detail-modal` | Clic en la fila o en el evento; «Ver orden» |
| Pedido: reprogramar | `PATCH /store/scheduled-orders/:id/reschedule` | «Reprogramar» (solo franjas con cupo) |
| Enlaces viejos | `/admin/reservations`, `/admin/scheduled-orders` | Redirect a Programación |

Lo que no pasó (ver D3/D4): tarjetas de KPIs y panel «Reservas de hoy» de la pantalla vieja; arrastrar para reprogramar.

### Tasks
- [x] T1 — Endpoint agregado + adaptadores · Verify: `scheduling.service.spec.ts`, `booking-scheduling.source.spec.ts`, `scheduled-order-scheduling.source.spec.ts`
- [x] T2 — Disponibilidad del prestador · Verify: `provider-availability.spec.ts`, `scheduling.service.spec.ts` (filtro por prestador)
- [x] T3 — Pantallas Programación y Agenda + calendario · Verify: `scheduling-calendar.util.spec.ts`, `scheduling-pages.component.spec.ts`
- [x] T4 — Menú, filtro por industria, redirects · Verify: `menu-filter.service.spec.ts`, `store-admin-menu-items.spec.ts`, `route-gate-coverage.spec.ts`, `store-admin-rutas-routes.spec.ts`
- [ ] T5 — QA visual con Playwright contra el vhost (escritorio y 375 px) · pendiente: no corrí docker ni el vhost en esta sesión.

**Riesgos:** (1) La tabla mezcla fuentes en memoria hasta 5 000 filas por página pedida: si alguien navega muy lejos sin fechas recibe 422 con un mensaje; (2) el estado de los pedidos se deriva en lectura, así que el filtro de estado de pedidos se aplica en memoria sobre el rango (tope 2 000, se avisa con `truncated`); (3) quien tenía la pantalla Reservas como inicio pierde KPIs (D3); (4) `/store/scheduling` no lleva `@IndustryModule`: el aislamiento por industria lo hace el servicio por fuente (cubierto por specs); los datos siempre van por el Prisma de tienda.

## F2 — Recepción con «Reservas» principal + «Llegadas» segunda; sale el módulo Reservas de hotel

- **Alcance:** la lista de reservas de hotel (hoy `FE/private/modules/store/hospitality/reservations/pages/reservations-page/reservations-page.component.ts`, paginada en servidor, filtros estado/fechas) pasa a ser la primera pestaña de Recepción; Llegadas segunda; Salidas y En casa después. Se quita la entrada «Reservas de hotel» del menú.
- **Archivos:** menú `FE/private/layouts/store-admin/store-admin-menu-items.ts:136-140`; rutas `FE/routes/private/store_admin.routes.ts:1286` (`hospitality/reservations` → redirect `front-desk?tab=reservations`, mismo patrón que los reportes en `:1334`); Recepción `FE/.../hospitality/reservations/pages/front-desk-page/front-desk-page.component.ts:52` (tipo de pestaña), `:166-168` (tabs en sticky header), `:364` (pestaña inicial), `:586` (`onTab`); pestañas con `?tab=` copiadas de `FE/.../hospitality/reports/pages/reports-page/`. Catálogo: `FE/shared/constants/store-module-catalog.constant.ts:147` (`hospitality_reservations` → `/admin/hospitality/front-desk`).
- **Backend:** nada nuevo (reutiliza `/store/hospitality/reservations` y `/front-desk`).
- **Permisos/módulos:** misma key `hospitality_reservations`; la entrada Recepción ya la usa.
- **Migraciones:** ninguna.
- **Tests:** spec de Recepción (pestaña por defecto = Reservas, `?tab=` deep-link), `store-admin-menu-items.spec.ts`, `route-gate-coverage.spec.ts`.
- **Riesgos:** usuarios con el enlace viejo (redirect); reutilizar el modal de detalle con su paso `cancel` (ampliar `DetailStep`). Decisión abierta D2.

## F3 — Limpieza sugerida al cerrar el checkout + rol fijo de limpieza

- **Alcance:** al terminar el check-out, el sistema ofrece crear la tarea «Limpieza de salida» de esa habitación y asignarla, con las personas del rol de limpieza primero en la lista recomendada.
- **Archivos:** check-out `BE/domains/store/hospitality/reservations/check-out/check-out.service.ts:103` (ya marca la habitación sucia, `:294-295`); tareas `BE/domains/store/hospitality/housekeeping/housekeeping-tasks.service.ts:226` (`create`), `:278` (`assign`), `:410` (`staff`: hoy solo `HOUSEKEEPING_ASSIGNEE_ROLES`, `:22`); rol `BE/common/constants/lodging-roles.constant.ts:12` (`housekeeper` ya es rol de sistema). FE: modal de check-out en Recepción (`reservation-detail-modal`, paso `check_out`) → paso final «Asignar limpieza».
- **Backend:** devolver en `staff()` primero el rol de limpieza y después el resto del personal activo (aditivo); `checkOut` devuelve `unit_id` y la sugerencia (sin crear la tarea sola). Sin endpoint nuevo si `POST /housekeeping/tasks` acepta `assigned_user_id`.
- **Permisos:** quien hace check-out necesita `store:lodging:housekeeping:operate` para asignar (el recepcionista hoy solo tiene `read`: decidir si se agrega a su lista D10).
- **Migraciones:** ninguna (el rol existe en el seed; solo cambia la etiqueta visible, D1).
- **Tests:** `housekeeping-tasks.service.spec.ts` (orden de la lista), `check-out.service` (sugerencia), spec del modal.
- **Riesgos:** permiso del recepcionista; no duplicar tareas (`@@unique([store_id, unit_id, task_date, type])`, PRISMA:2784).

## F4 — Reportes de hotel a Reportes y analíticas + reportes por industria

- **Alcance:** los reportes de hotel (rendimiento, pickup, cancelaciones, auditoría nocturna, FONTUR, servicios exentos) salen de Hotelería y aparecen como categoría «Hotelería» en Reportes; la página de Reportes muestra solo categorías de las industrias activas de la tienda.
- **Archivos:** catálogo `FE/private/modules/store/reports/config/report-registry.ts:11` (`REPORT_CATEGORIES`, ya soporta `panelUiKey` en `dispatch`) y `:26`; página `FE/private/modules/store/hospitality/reports/pages/reports-page/`; menú Hotelería `store-admin-menu-items.ts:162-166` (quitar) y Reportes `:639`; controladores `BE/domains/store/hospitality/reservations/reports/*.controller.ts` (se reutilizan; ya llevan `@IndustryModule('hospitality_reservations')`).
- **Industria:** nueva key `reports_hospitality` en `MODULE_INDUSTRIES` (BE `common/access/module-industries.ts` y copia FE byte a byte) = `['hospitality']`; filtro de categorías por `industryAllowsKey`. Revisar `reports_dispatch` (retail) con la misma regla.
- **Migraciones:** ninguna.
- **Tests:** `module-industries.parity.spec.ts`, spec del registro de reportes (categorías por industria), `route-gate-coverage.spec.ts`.
- **Riesgos:** permisos de reportes de hotel (`store:lodging:*`) vs. `store:reports:*`: los endpoints mantienen los suyos.

## Log
- 2026-11-23 — Plan escrito sobre la decisión de Rafael; F1 se ejecuta sin esperar OK (decidida). Commits F1: 69c3543d8 (endpoint), fb85b2371 (pantallas), ab8808a02 (menú y redirects), 9311c5bbd (disponibilidad del prestador y accesos visibles).
- 2026-11-23 — Tests F1 corridos de a uno (ver PR): backend 5 specs, frontend 6 specs, todos en verde. Typecheck backend filtrado a `scheduling/` y `store.module.ts`: sin errores.
