# Recordatorio de cuotas de venta a crédito

Objetivo: avisar a la tienda (campana) y al cliente (correo) N días antes del vencimiento de cada cuota de una venta a crédito, configurable en Configuración general → Venta. Rama `feat/credito-recordatorio-cuotas` desde `origin/develop`. Entrega: commits locales por unidad, sin push ni PR. Runner: `npm run test:path -w apps/backend -- <ruta>` (una ruta por invocación).

## Specs

**Historia:** Como dueño de tienda en el admin de Vendix, quiero activar recordatorios automáticos de las cuotas de mis ventas a crédito para que el cliente pague a tiempo sin que yo tenga que llamarlo uno por uno.

- **S1 — Ajuste.** Configuración general → Venta, sección "Ventas a crédito": check "Recordatorios de cuotas" (apagado por defecto). Al activarlo se siembran dos reglas: 3 días antes (tienda + cliente) y el mismo día (solo tienda). Cada regla: activa, días antes (0–30), avisar al equipo, avisar al cliente (correo). Persistido en `store_settings.settings.credit_reminders` (sección nueva en whitelist backend + `knownSections` frontend + DTO validado).
- **S2 — Job.** Cron diario sobre `order_installments` en estado `pending`/`partial` de órdenes a crédito (`payment_form = '2'`) no canceladas, cuya `due_date` = hoy local de la tienda + `days_before`. Hoy local por `resolveTimezoneCascade` + `localCivil` (no UTC). Solo tiendas activas con el check prendido; solo reglas activas con al menos un canal.
- **S3 — Sin duplicados.** Tabla `credit_installment_reminder_logs` con único (`installment_id`, `rule_key`, `channel`); `createMany` + `skipDuplicates`, se emite solo si insertó. Un aviso nunca sale dos veces.
- **S4 — Tienda.** Evento `credit_installment.reminder` canal `staff` → `createAndBroadcast` tipo `credit_installment_reminder` (valor nuevo de `notification_type_enum`), con cuota X de Y, orden, cliente, fecha y valor.
- **S5 — Cliente.** Canal `customer` → correo (`EmailService`) con cuota X de Y, fecha de vencimiento, valor de la cuota y saldo pendiente del crédito. Cliente sin correo: no se le envía (la tienda sí recibe el suyo). WhatsApp fuera de alcance (v1).
- **S6 — Cuota pagada.** Una cuota `paid`/`forgiven`/`cancelled` no genera aviso.

Criterios observables: check apagado → nada; aviso exactamente N días antes en fecha Colombia; cuota pagada → nada; correo con cuota, fecha, valor y saldo; sin correo → solo campana; nunca dos veces.

Archivos críticos: migración nueva (tabla + valor de enum, aditiva), `schema.prisma`, `store-prisma.service.ts` (scope), `settings` (defaults, interface, DTO, whitelist), `accounts-receivable` (job + listener de correo, módulo + `EmailModule`), `notifications-events.listener.ts`, frontend `store-settings.interface.ts`, `credit-reminders-settings-form`, `sales-settings.page.ts`, `general-settings.store.ts`, `notifications-dropdown`.

Reutiliza: patrón completo de `scheduled-order-reminders.job.ts` + `reminder-email.listener.ts` + `scheduled_order_reminder_logs`; `mergeStoreSettingsWithDefaults`; `createAndBroadcast`.

Riesgo: item 1 (migración nueva aditiva: tabla vacía + valor de enum; sin mutar filas).

## Tasks

| ID | Specs | Tarea | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- | --- |
| T1 | S1–S6 (backend) | Migración, schema, scope, settings, job, listeners, specs | inline | hecho; job spec 8/8, email util spec 3/3 | 21f0bc011 (migración), 539b9ac4e |
| T2 | S1, S4 (frontend) | Tipo, formulario, página Venta, store, campana | inline | hecho; zoneless sin hallazgos en archivos tocados | ver L4 |

## Log

- L1 (2026-11-03, usuario): "bueno lo ideal sería implementarla en Configuración general y pues ahí activarlo un check donde diga" / "bueno tocará hacerlo con configuración general en notificación o en configuraciones general o en venta cositas sí pero que sea el mismo flujo de órdenes preparadas revisa cómo es el orden del flujo de órdenes preparadas" / "implementalo".
- L2: decisiones por defecto tomadas al no responderse (propuestas en chat): sección en Venta, reglas 3 días (tienda+cliente) y mismo día (tienda), solo correo. "Órdenes preparadas" interpretado como Pedidos programados (`scheduled-orders`). Mirror Engram pendiente (herramienta no disponible en la sesión).
- L3 (2026-11-03): migración aplicada en dev (`migrate deploy`). `prisma generate` en el contenedor murió por OOM (límite 2,5 GiB) y dejó el cliente roto (`address_type_enum` undefined → backend caído); se copió el cliente generado en el host (misma versión 7.10.0, incluye linux-musl) a `/app/node_modules/.prisma/client` (respaldo en `/tmp/prisma-client-backup` del contenedor) y el backend volvió a levantar. Job spec 8/8 (escrito tras el código: sin RED observado). API: GET devuelve defaults, PATCH persiste, `days_before: 31` → 422. Ajuste dejado activado en `tech-bogota` (dev) para prueba manual. Pendiente: copy del correo (TODO(human)), commits, prueba E2E con una cuota real.
- L4 (2026-11-03, usuario): "continua con eso" → copy del correo escrito por el agente (cuota X de Y, fecha, valor pendiente de la cuota, saldo del crédito; "vence hoy" si days_before = 0). Spec del util 3/3. Commits: 21f0bc011 migración + schema + scope; 539b9ac4e backend; frontend + este documento en el commit siguiente. Pendiente: prueba E2E con una cuota real, `npx tsc --noEmit` antes de PR, verificador independiente (item 1). Mirror Engram sigue pendiente.
