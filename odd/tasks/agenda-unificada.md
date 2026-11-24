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
- **D6 — ¿Quién asigna la limpieza (F3)?** Hoy `housekeeper` no tiene `housekeeping:assign` (BE `common/constants/lodging-roles.constant.ts:49-53`) y el recepcionista tampoco: solo owner/admin/manager por el prefijo `store:`. Propuesta: permitir que recepción asigne la limpieza del check-out añadiendo `housekeeping:assign` a `receptionist`; si se quiere una «jefa de ama de llaves» aparte, es rol de sistema nuevo en el seed (no migración).
- **D7 — ¿La tarea de limpieza se crea sola al hacer check-out (F3)?** Hoy se generan de forma perezosa al abrir el tablero (`housekeeping-tasks.service.ts:357`). Propuesta: crearla en el listener de `LODGING_CHECKED_OUT_EVENT` con `skipDuplicates` (seguro por el único `(store_id, unit_id, task_date, type)`), además de la sugerencia en el modal.
- **D8 — Reportes de hotel: ¿tarjetas que enlazan o componentes dentro de Reportes (F4)?** Los 5 reportes son componentes a medida con endpoints propios (`store/hospitality/reports/*`, permiso `store:lodging:reports:read`) y no encajan en `GenericReportPageComponent`. Propuesta barata: tarjetas de categoría «Hotelería» que enlazan a `/admin/hospitality/reports?tab=…`. ¿O se migran a Reportes y se retira esa página?
- **D9 — Stats de Recepción por pestaña (F2).** Recepción y la vieja Reservas tienen 4 KPIs distintos y layouts sticky distintos (`sticky top-0` vs. `top-header-tabs`). ¿Se muestran los de la pestaña activa o se unifican?

## F1 — Órdenes → Agenda (Calendario | Programación | Configuración) — implementada en este PR

> Estructura de Rafael 2026-11-23 20:30 (`CAMBIO-ESTRUCTURA-2026-11-23-2030.md`): no hay entrada «Programación» separada; **un solo módulo Agenda** en Órdenes con tres pestañas en `?tab=`: **Calendario** (por defecto), **Programación** (la tabla) y **Configuración** (prestadores, equipo de servicio, horarios, bloqueos/excepciones, disponibilidad de proveedores, cola). Reemplaza la estructura anterior de dos entradas.

### Historia de usuario
Como dueño o administrador de una tienda de servicios o de un restaurante en el panel (escritorio o celular), quiero abrir Órdenes → Agenda y tener en un solo módulo el calendario de mis reservas de servicio y pedidos programados, la tabla con los mismos registros y filtros (tipo, personal/prestador, estado, fecha, búsqueda) y la configuración de mis prestadores y su disponibilidad, para atender y organizar todo lo programado sin saltar entre «Reservas», «Pedidos programados» y «Equipo de Servicio».

**Pasos para probar (humanos, en pantalla):**
1. Inicia sesión como `owner@techsolutions.co` en una tienda con industria servicio (y restaurante, con Pedidos programados activo) en `https://vendix.com`.
2. Abre Órdenes. Ves una sola entrada «Agenda»; ya no ves «Reservas», «Pedidos programados», «Programación» ni «Equipo de Servicio». «Solicitudes de pago» y «Estaciones de Servicio» siguen.
3. Agenda abre en **Calendario** (`?tab=calendario`): semana actual (celular: día); Mes → tocar un día abre ese día. En «Opciones» filtra Personal = un prestador: lo que queda fuera de su horario aparece sombreado y un día con excepción dice «No disponible: <motivo>».
4. Pestaña **Programación** (`?tab=programacion`): reservas y pedidos desde hoy en orden de hora; filtros, búsqueda y paginación. Clic en una reserva abre su detalle de siempre; en un pedido, su detalle; «Reprogramar» de un pedido ofrece solo franjas con cupo.
5. Pestaña **Configuración** (`?tab=configuracion`): secciones Equipo de servicio | Disponibilidad | Cola de atención | Horario del negocio (`?seccion=`), con las pantallas de siempre; abajo, enlaces a Solicitudes de reagenda, Solicitudes de pago, Ajustes de reservas, Recordatorios, Estaciones, Producción e Insumos del día y Franjas de pedidos.
6. Los botones «Equipo de servicio» y «Disponibilidad» de la cabecera (Calendario y Programación) abren su sección de Configuración.
7. Entra por URLs viejas: `/admin/reservations` y `/admin/scheduled-orders` → Calendario; `/admin/orders/scheduling` → Programación; `/admin/reservations/schedules|availability|queue|business-hours` → Configuración en su sección.

**Criterios de aceptación:**
- [x] Una sola entrada de menú «Agenda» con tres pestañas; Calendario por defecto; `?tab=` abre la pestaña pedida (una desconocida cae en Calendario).
- [x] Programación: una tabla con ambas fuentes, clasificadas por tipo, paginada en servidor, con filtros múltiples.
- [x] Calendario mes/semana/día con ambas fuentes y los mismos filtros, en la zona horaria de la tienda.
- [x] Las acciones abren el flujo propio de cada módulo; no se reimplementa ninguna regla de negocio.
- [x] Una fuente aparece solo si su industria, su permiso de lectura y (pedidos) el ajuste de la tienda la habilitan. Una tienda retail no ve Agenda.
- [x] La disponibilidad del prestador gobierna Calendario y Programación (filtro por prestador; horario, bloqueos y excepciones).
- [x] Configuración da acceso a cada pantalla de configuración; ninguna configuración de Reservas se pierde (lista ruta por ruta abajo).
- [x] Sin entradas de menú duplicadas; las URLs viejas redirigen a su pestaña.

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

**Frontend (nuevo, `FE/private/modules/store/scheduling/`):**
- `scheduling-tabs.ts` — pestañas `calendario|programacion|configuracion` (`?tab=`), secciones `equipo|disponibilidad|cola|horario` (`?seccion=`), `agendaUrl()`.
- `pages/agenda-shell` — el módulo: `app-sticky-header` con las tres pestañas (capa 3) y los botones de la pestaña activa (`ModuleShellActionsService`, el mismo canal que `ModuleTabsShellComponent`).
- `pages/scheduling-agenda-page` (Calendario) y `pages/scheduling-list-page` (Programación) — las pantallas ya construidas con `embedded` (sin cabecera propia; publican sus botones en la del módulo).
- `components/scheduling-config-tab` (Configuración) — `app-scrollable-tabs` (capa 4) que monta `ScheduleManagementComponent`, `ProviderAvailabilityComponent` (ambos con `embedded` nuevo que oculta su cabecera), `AppointmentQueuePanelComponent` y `BusinessHoursComponent` sin cambiar su lógica; enlaces a las demás pantallas.
- `components/event-calendar`, `components/scheduling-record-host`, `components/scheduled-order-reschedule-modal`, `utils/` — sin cambios de lógica.
- `FE/private/modules/store/reservations/components/schedule-management/*` y `provider-availability/*` — input `embedded`; «volver» y «ver horarios» apuntan a Agenda.

**Menú, permisos, módulos e industrias:**
- `FE/private/layouts/store-admin/store-admin-menu-items.ts` (Órdenes) — fuera «Reservas», «Pedidos programados», «Programación» y «Equipo de Servicio»; una entrada «Agenda» (`/admin/orders/agenda`) con `panelUiAnyOf: ['orders_reservations','orders_scheduled']`. «Solicitudes de pago» y «Estaciones de Servicio» siguen.
- `FE/shared/components/sidebar/sidebar.component.ts` — campo `panelUiAnyOf`.
- `FE/core/services/menu-filter.service.ts` — caso 1b: la entrada se ve si al menos una key pasa sola todas las capas (panel usuario/tienda, industria, plan) y `orders_scheduled` exige `scheduledOrdersEnabled`. **No hay key nueva:** planes, roles y `MODULE_INDUSTRIES` (BE y FE) no cambian.
- `FE/routes/private/store_admin.routes.ts` — `orders/agenda` (antes de `orders/:id`); redirects con `agendaTabRedirect()`: `orders/scheduling` → programacion; `reservations` → calendario; `reservations/schedules|availability|queue|business-hours` → configuracion + sección. `scheduled-orders.routes.ts` `''` → calendario. Las demás subrutas de Reservas y Pedidos siguen igual.
- `FE/core/services/breadcrumb.service.ts` — miga de Agenda.

### Lista de verificación: configuración de Reservas que sigue alcanzable (ruta por ruta)

| Pantalla / acción | Ruta de antes | Destino ahora |
|---|---|---|
| Calendario de Reservas | `/admin/reservations` | Agenda → Calendario (`?tab=calendario`, redirect) |
| Agenda de pedidos programados | `/admin/scheduled-orders` | Agenda → Calendario (redirect) |
| Tabla (F1 previa) | `/admin/orders/scheduling` | Agenda → Programación (`?tab=programacion`, redirect) |
| Equipo de servicio (prestadores, horarios semanales, bloqueos/excepciones, servicios por prestador) | `/admin/reservations/schedules` (antes también en el menú) | Agenda → Configuración → Equipo de servicio (`?tab=configuracion&seccion=equipo`, redirect); botón de cabecera en Calendario y Programación; Opciones |
| Disponibilidad de proveedores | `/admin/reservations/availability` | Configuración → Disponibilidad (`seccion=disponibilidad`, redirect); botón de cabecera; Opciones |
| Cola de atención | `/admin/reservations/queue` | Configuración → Cola de atención (`seccion=cola`, redirect); Opciones |
| Horario del negocio | `/admin/reservations/business-hours` | Configuración → Horario del negocio (`seccion=horario`, redirect); Opciones |
| Bloquear horario | `/admin/reservations/schedules` | Configuración → Equipo de servicio |
| Solicitudes de reagenda | `/admin/reservations/reschedule-requests` | Sin cambio de ruta; enlace en Configuración y en Opciones |
| Solicitudes de pago | `/admin/reservations/payment-requests` | Sin cambio; menú Órdenes; enlace en Configuración; Opciones |
| Ajustes de reservas | `/admin/settings/general/reservas` | Sin cambio; enlace en Configuración |
| Recordatorios de servicio | `/admin/reservations/reminders` | Sin cambio; enlace en Configuración y Opciones (servicio) |
| Estaciones de servicio / sesión | `/admin/services/stations` | Sin cambio; menú Órdenes; enlace en Configuración y Opciones (servicio) |
| Exportar reporte de reservas | modal `report-export-modal` | Programación → Opciones → «Exportar reservas» |
| Nueva reserva / llegada sin reserva | modal `reservation-form-modal` | Botón «Nueva reserva» en Calendario y Programación |
| Detalle: confirmar, cancelar, no asistió, check-in, llegando/atendiendo, iniciar, completar, re-agendar, notas, anticipo, cobro para reservar, atender consulta | modal `booking-detail-modal` | Clic en la fila o el evento |
| Producción del día / insumos | `/admin/scheduled-orders/day`, `/production` | Sin cambio; enlace en Configuración y Opciones (pedidos) |
| Franjas y cupos de pedidos | `/admin/settings/general/venta` | Sin cambio; enlace en Configuración (pedidos) |
| Pedido: detalle, enviar a cocina, ver orden, reprogramar | modal / `PATCH .../reschedule` | Clic en fila o evento; «Ver orden»; «Reprogramar» |

Lo que no pasó (ver D3/D4): tarjetas de KPIs y panel «Reservas de hoy» de la pantalla vieja; arrastrar para reprogramar.

### Tasks
- [x] T1 — Endpoint agregado + adaptadores · Verify: `scheduling.service.spec.ts`, `booking-scheduling.source.spec.ts`, `scheduled-order-scheduling.source.spec.ts`
- [x] T2 — Disponibilidad del prestador · Verify: `provider-availability.spec.ts`, `scheduling.service.spec.ts` (filtro por prestador)
- [x] T3 — Pantallas Programación y Agenda + calendario · Verify: `scheduling-calendar.util.spec.ts`, `scheduling-pages.component.spec.ts`
- [x] T4 — Menú, filtro por industria, redirects · Verify: `menu-filter.service.spec.ts`, `store-admin-menu-items.spec.ts`, `route-gate-coverage.spec.ts`, `store-admin-rutas-routes.spec.ts`
- [x] T4b — Estructura de Rafael 20:30: módulo Agenda con pestañas, Configuración, redirects a `?tab=`, menú sin duplicados · Verify: `agenda-shell.component.spec.ts`, `scheduling-pages.component.spec.ts`, `store-admin-menu-items.spec.ts`, `menu-filter.service.spec.ts`
- [ ] T5 — QA visual con Playwright contra el vhost (escritorio y 375 px) · pendiente: no corrí docker ni el vhost en esta sesión.

**Riesgos:** (1) La tabla mezcla fuentes en memoria hasta 5 000 filas por página pedida: si alguien navega muy lejos sin fechas recibe 422 con un mensaje; (2) el estado de los pedidos se deriva en lectura, así que el filtro de estado de pedidos se aplica en memoria sobre el rango (tope 2 000, se avisa con `truncated`); (3) quien tenía la pantalla Reservas como inicio pierde KPIs (D3); (4) `/store/scheduling` no lleva `@IndustryModule`: el aislamiento por industria lo hace el servicio por fuente (cubierto por specs); los datos siempre van por el Prisma de tienda; (5) Equipo de servicio, Disponibilidad, Cola y Horario ya no tienen URL propia gobernada por `orders_reservations` en el guard de URL: Configuración solo las monta si la fuente de reservas está habilitada (industria + permiso) y sus endpoints siguen exigiendo sus permisos; (6) `ScheduleManagementComponent` y `ProviderAvailabilityComponent` mantienen sus barras sticky internas pensadas para su página propia: revisar en QA visual que no se monten bajo la cabecera del módulo.

## F2 — Recepción con «Reservas» principal + «Llegadas» segunda; sale el módulo Reservas de hotel

- **Alcance:** la lista de reservas de hotel (`FE/.../hospitality/reservations/pages/reservations-page/reservations-page.component.ts`, paginada en servidor, `PAGE_SIZE = 20`, filtros estado/`date_from`/`date_to`, acciones Ver y Cancelar) pasa a ser la primera pestaña de Recepción; Llegadas segunda; Salidas y En casa después. Se quita del menú la entrada «Reservas de hotel».
- **Archivos (FE):** menú `FE/private/layouts/store-admin/store-admin-menu-items.ts:138` (entrada a quitar; el grupo Hotelería está en `~:116` y `hospitality_reservations` sigue siendo la key de Recepción/Rack/Reportes); rutas `FE/routes/private/store_admin.routes.ts:1270-1275` (`reservations` → redirect `/admin/hospitality/front-desk?tab=reservations` con `createUrlTree`, patrón ya usado en `:1316-1347`); Recepción `FE/.../front-desk-page/front-desk-page.component.ts` — tipo `FrontDeskTab` `:52`, títulos `:96`, tabs `:161-169`, tab inicial `'arrivals'` `:364`, `onTab` `:586`; estado de pestaña hoy es local, hay que pasarlo a `queryParamMap` copiando `FE/.../hospitality/reports/pages/reports-page/reports-page.component.ts:93-119`; modales de detalle/creación ya montados (`:147-148`, template `:336-349`); catálogo `FE/shared/constants/store-module-catalog.constant.ts:147` (`hospitality_reservations` → `/admin/hospitality/front-desk`) y `MODULE_GATE_ROUTES` `:321-324`; breadcrumb `FE/core/services/breadcrumb.service.ts:1092`; nombre del módulo en `FE/shared/constants/app-modules.constant.ts:561`.
- **Backend:** nada nuevo. Se reutilizan `GET store/hospitality/reservations` (lista paginada, `reservations.controller.ts:46`, stats `:54`, detalle `:114`, cancel `:130`), `GET store/hospitality/front-desk` (`front-desk.controller.ts:11-26`; board sin paginar, `lodging-front-desk.service.ts:83`/`:131`) y el check-in (`:146`, permiso `front_desk:operate`). No fusionar endpoints: los DTO (`FrontDeskRow` / `ReservationListResult`) y el alcance son distintos.
- **Permisos/módulos:** misma key `hospitality_reservations`; `store:lodging:reservations:read/write` para la pestaña Reservas, `store:lodging:front_desk:operate` para check-in. Keys `hospitality_*` no se borran (`BE/common/access/module-industries.ts:174-178`, `:297-300`, `:333-336`). Presets por rol en `BE/common/services/default-panel-ui.service.ts:212-215` y `BE/common/constants/lodging-roles.constant.ts:62-75` no cambian.
- **Migraciones:** ninguna.
- **Tests:** spec de Recepción (pestaña por defecto = Reservas, deep-link `?tab=`, stats y permisos por pestaña, paso `cancel` del detalle), `reservations-page` sigue cubierta, `store-admin-menu-items.spec.ts`, `route-gate-coverage.spec.ts`, spec del catálogo de módulos.
- **Riesgos:** (1) enlaces viejos a `/admin/hospitality/reservations` (menú, breadcrumb, `MODULE_ROUTES`) → redirect; (2) `DetailStep` de Recepción no incluye `'cancel'` (`front-desk-page.component.ts:53` vs. `reservation-detail-modal.component.ts:62`) → ampliarlo; (3) el board de Recepción no pagina: usarlo solo para Llegadas/Salidas/En casa, nunca para la lista general; (4) no perder «Cancelar» ni sus permisos; (5) ocultar la entrada de menú no protege la URL: el redirect es la protección. Decisión abierta D2.

## F3 — Limpieza sugerida al cerrar el checkout + rol fijo de limpieza

- **Alcance:** al terminar el check-out, el sistema ofrece crear la tarea «Limpieza de salida» (`checkout_clean`) de esa habitación y asignarla, con las personas del rol de limpieza primero en la lista recomendada.
- **Archivos (BE):** check-out `BE/domains/store/hospitality/reservations/check-out/check-out.service.ts:103` (`checkOut`; ya pasa las habitaciones a `dirty` en `:293-296` y emite `LODGING_CHECKED_OUT_EVENT` en `:318`, hoy solo escuchado por SIRE/TRA); tareas `BE/domains/store/hospitality/housekeeping/housekeeping-tasks.service.ts` — `dailyHousekeepingTasks` `:79-107`, `create` `:226`, `assign` `:278`, `complete` `:318`, `ensureToday` `:357`, `staff` `:410-428` (filtra `active`, usuario de la tienda y rol `housekeeper`; `HOUSEKEEPING_ASSIGNEE_ROLES` `:22`), nombres resueltos a mano en `assigneeNames` `:183`; controlador `housekeeping.controller.ts` (permisos `read`/`operate`/`assign`; ojo: no tiene `IndustryModuleGuard`). Rol `housekeeper` en `BE/common/constants/lodging-roles.constant.ts:14-54` y seed `prisma/seeds/permissions-roles.seed.ts:5020-5043`/`~:5116` (`is_system_role`, `organization_id` nulo). Alcance/asignación de roles: `BE/common/utils/role-scope.util.ts:94-112` y espejo FE `FE/shared/constants/role-scope.constant.ts:107,121`.
- **Archivos (FE):** modal de check-out `FE/.../reservations/components/check-out-modal/check-out-modal.component.ts` (selector, `checkOut` `:435`, emite `checkedOut` `:454`) abierto desde `reservation-detail-modal` (`:474`) y desde Recepción (`openDetail(row, 'check_out')`); paso final «Asignar limpieza» con el `staff` del endpoint de tareas. Formulario de tarea `FE/.../housekeeping/components/task-form-modal.component.ts:125-129` (selector «Camarera (opcional)») y panel `housekeeping-tasks-panel.component.ts:108,220`.
- **Backend:** `staff()` devuelve primero las personas del rol de limpieza y después el resto del personal activo de la tienda (aditivo, sin romper la validación de assignee); `checkOut` devuelve `unit_id`, fecha y la sugerencia de asignación (la creación se decide en D7). Sin endpoint nuevo si `POST store/hospitality/housekeeping/tasks` acepta `assigned_user_id`.
- **Permisos:** quien hace check-out y asigna necesita `housekeeping:operate`/`assign` (D6). El rol `housekeeper` mantiene su preset de panel `['hospitality','hospitality_rooms']`.
- **Migraciones:** ninguna. El rol existe en el seed; crear uno nuevo también es seed (`findOrCreateSystemRole`), no SQL. `assigned_user_id` no tiene FK a `users` (PRISMA:2767-2786): no se añade relación en esta fase.
- **Tests:** `housekeeping-tasks.service.spec.ts` (orden de `staff` y validación de assignee), spec de `check-out.service` (sugerencia con `unit_id`), spec del `check-out-modal`/detalle (paso de asignación), y el de `lodging-roles.constant` si cambia la etiqueta.
- **Riesgos:** (1) no duplicar la tarea (`@@unique([store_id, unit_id, task_date, type])` + `skipDuplicates`, PRISMA:2784); (2) el recepcionista hoy no puede asignar (D6); (3) `HousekeepingController` sin `IndustryModuleGuard`: hueco de gating por industria a revisar (no bloquea F3); (4) la asignación no valida contra un join de Prisma: no inventar relaciones.

## F4 — Reportes de hotel a Reportes y analíticas + reportes por industria

- **Alcance:** los reportes de hotel (cierre del día, indicadores, ritmo de reservas, cancelaciones y no presentados, FONTUR, servicios exentos) salen de Hotelería y aparecen como categoría «Hotelería» en Reportes y analíticas; la página de Reportes muestra solo categorías de las industrias activas de la tienda.
- **Archivos (FE):** catálogo `FE/.../store/reports/config/report-registry.ts` — `REPORT_CATEGORIES` `:11-24` (12 categorías), `REPORT_DEFINITIONS` `:26`, helper `:1930-1945`; solo `dispatch` tiene `panelUiKey` (`:23`, `reports_dispatch`); tipo en `FE/.../store/reports/interfaces/report.interface.ts:1-13` y `ReportCategory.panelUiKey?` `:113`; el catálogo de tarjetas **no filtra por industria** (`reports-catalog.component.ts:64-65` y `overview-summary-report.component.ts:121-127`) y `reports-shell.component.ts:138,147` solo filtra acciones; analíticas `FE/.../store/analytics/config/analytics-registry.ts` (cada categoría ya trae `panelUiKey` `:64-128`, `getSidebarEntries()` `:540-554`); página `FE/.../hospitality/reports/pages/reports-page/reports-page.component.ts:17-22` (5 pestañas, `?tab=` `:93-119`) y rutas `FE/routes/private/store_admin.routes.ts:1246-1252`; menú Hotelería `store-admin-menu-items.ts:165` (quitar) y Reportes `:626-709`; `MODULE_ROUTES` `store-module-catalog.constant.ts:111-120,179` y `MODULE_GATE_ROUTES` `:303-313`.
- **Backend:** los 6 controladores `BE/domains/store/hospitality/reservations/reports/*.controller.ts` se reutilizan tal cual (`GET` + `GET export`, `@IndustryModule('hospitality_reservations')`, permiso `store:lodging:reports:read`); el cierre del día usa `night_audit:close`. No se migran a `GenericReportPageComponent` (D8).
- **Industria:** `reports_*` y `analytics_*` están hoy en `'all'` salvo `reports_dispatch`/`analytics_dispatch` (`RETAIL_ONLY`, `module-industries.ts:93-94`); hotelería no tiene key de reportes. Nueva key `reports_hospitality` = `['hospitality']` en `MODULE_INDUSTRIES` (BE `common/access/module-industries.ts` + copia FE byte a byte, hay spec de paridad) y, si aplica, `analytics_hospitality`; filtro de tarjetas y de navegación con la misma regla (`industryAllowsKey`) y revisión de `reports_dispatch`. Altas en `MODULE_ROUTES`/`MODULE_GATE_ROUTES`, `app-modules.constant.ts` y `default-panel-ui.service.ts` (no hay presets de plan para hotelería en `plan-modules.ts`).
- **Migraciones:** ninguna.
- **Tests:** `module-industries.parity.spec.ts`, spec del registro de reportes (categorías y tarjetas por industria activa), `route-gate-coverage.spec.ts`, spec del menú filtrado.
- **Riesgos:** (1) permisos `store:lodging:reports:read` vs. `store:reports:read`: los endpoints conservan los suyos y el catálogo debe respetarlos; (2) dos catálogos paralelos (Reportes y Analíticas): decidir dónde vive hotelería (D8); (3) tocar `module-industries.ts` sin copiar el espejo rompe la spec de paridad; (4) los reportes con componente propio no entran en el visor genérico sin adaptarlos.

## Log
- 2026-11-23 20:30 — Cambio de estructura de Rafael: un solo módulo Agenda con pestañas Calendario | Programación | Configuración; Programación y Equipo de Servicio salen del menú; URLs viejas redirigen a su pestaña. Sin BD.
- 2026-11-23 — Plan escrito sobre la decisión de Rafael; F1 se ejecuta sin esperar OK (decidida). Commits F1: 69c3543d8 (endpoint), fb85b2371 (pantallas), ab8808a02 (menú y redirects), 9311c5bbd (disponibilidad del prestador y accesos visibles).
- 2026-11-23 — Tests F1 corridos de a uno (ver PR): backend 5 specs, frontend 6 specs, todos en verde. Typecheck backend filtrado a `scheduling/` y `store.module.ts`: sin errores.
- 2026-11-23 — F2–F4 afinadas con las líneas verificadas contra el código actual (pestañas de Recepción en estado local, board sin paginar, tareas de limpieza perezosas, rol `housekeeper` de sistema, catálogo de reportes que no filtra por industria). Nuevas decisiones abiertas D6–D9.
