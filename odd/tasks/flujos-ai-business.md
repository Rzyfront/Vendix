# Flujos + Gestión documental (plan IA Business) — análisis y plan

Objetivo: diseñar el módulo **Flujos** (flujos de trabajo administrativos configurables) y su capa de **Gestión documental** (plantillas con tokens, archivos, expediente, firma electrónica, OCR/IA), exclusivos del plan IA Business e integrados con la IA de Vendix.
Rama: ninguna todavía (documento de análisis, solo lectura). Entrega propuesta: `stacked-to-main` sobre `develop`, slices de ~400 líneas. Runner: `npm run test:path -w apps/backend -- src/<ruta>` (un spec por invocación).
Estado: **borrador para aprobación de Rafael**. No se implementa nada hasta su aprobación y las decisiones de §1.4.

> Convención de evidencia: rutas relativas a la raíz del monorepo; `BE` = `apps/backend`, `FE` = `apps/frontend/src/app`. Reajustado el 2026-11-04 sobre **`origin/develop` 5757831a2** (ya con #1074/#1075, Apps como estándar y gate de accesos por industria); las líneas de `schema.prisma` pueden moverse ±100 con cada merge. Las referencias externas se llaman **referencia A** y **referencia B**; no se nombran ni se copia su código, esquema ni textos.

---

## 1. Resumen ejecutivo y veredicto

### 1.1 Veredicto en una línea

Se puede construir, y Vendix ya tiene ~60 % de las piezas transversales (tenant, roles, colas, notificaciones multicanal, IA con herramientas y confirmación, formularios dinámicos, S3, OCR por visión). Lo que **no existe** es lo central: no hay motor de estados genérico, ni editor visual, ni plantillas de documento con tokens, ni firma electrónica, ni tabla genérica de archivos, ni webhooks salientes. Eso es lo que hay que construir.

### 1.2 Cuánto

| Bloque | Semanas-dev (1 dev senior full-stack) |
|---|---|
| Flujos completo (motor + API + editor + bandeja/tablero + notificaciones + vencimientos + IA + simulación + webhooks/API keys + plantillas por industria + analítica) | 21,5 |
| Gestión documental completa (archivos + expediente + plantillas con tokens + editor + documento firmado + OCR/validación IA + retención) | 13 |
| **Total (un solo release, decisión D3)** | **≈ 34,5 semanas-dev** |

Las cifras suponen el ritmo de un dev que ya conoce el repo, con verificación por spec y QA manual por historia de usuario. No incluyen asesoría legal sobre firma electrónica. Con 2 devs (motor/BE y FE/documental) y orquestador: **≈ 4,5–5 meses calendario** para la entrega completa.

Decisión de Rafael: **se entrega completo de una** (sin corte MVP comercial). Las fases F/D son el orden de construcción y los puntos de revisión, no versiones que se vendan por separado.

### 1.3 Qué lo hace distinto (sin hype)

1. **Una sola fuente de verdad por versión.** La definición publicada es un JSON inmutable y validado; el motor ejecuta contra esa versión. Las dos referencias mantienen la misma definición en dos o tres lugares (JSON del diseñador + filas relacionales + configuración legada) y editan flujos vivos sin versión. Ese es su defecto más caro y es el primero que evitamos.
2. **Documento, firma y etapa son un mismo contrato.** Una etapa declara "requiere el documento X firmado por el rol Y"; el motor no deja salir de la etapa hasta que se cumpla, y el expediente guarda la evidencia con hash. En las referencias el documento cuelga del caso por categoría o por id fijo, y la firma vive dispersa en el contexto JSON del caso.
3. **IA que propone, motor que decide.** La IA genera borradores de flujo, explica una instancia y detecta cuellos de botella; nunca avanza una etapa sin la misma compuerta de permisos y confirmación que ya usan Vexi/Vex (`BE/src/ai-engine/tools/ai-tool-registry.ts`, propose→confirm→execute).
4. **Nativo de Vendix.** Los flujos leen y disparan eventos reales del negocio (`order.created`, `purchase_order.received`, `expense.approved`, `invoice.accepted`…) y usan los roles, tiendas, industrias y canales (email/WhatsApp/SMS/push) que el cliente ya tiene. Un n8n externo no ve nada de eso sin integración.

### 1.4 Decisiones tomadas por Rafael (4 nov 2026)

| # | Decisión | Definición de Rafael | Implicación técnica |
|---|---|---|---|
| D1 | **Compuerta del plan** | No atar el módulo a un código de plan: la configuración de planes debe permitir **módulos o rutas prohibidas/exclusivas por plan**; si hoy no existe, se construye (lo mismo sirve para bloquear el módulo fiscal a los planes menores a Empresarial Pro) | Hoy `subscription_plans.feature_matrix` es **solo presentacional** (`plan-feature-item.dto.ts:26-28`: «no guard, quota or panel_ui rule reads it»); el gating real vive en `ai_feature_flags`. Se agrega una **matriz plan → módulos/rutas** (configurable por superadmin, aplicada por un `PlanAccessGuard` + `MODULE_ROUTES`/`canSeeKey` en el front), y Flujos se marca exclusivo de IA Business en esa matriz. Sustituye al `AIFeatureKey` como única compuerta |
| D2 | **Alcance tenant** | **Inicialmente por tienda** | `StorePrismaService` y `store_id` en todas las tablas del módulo; definiciones compartidas por organización quedan fuera de alcance hasta que se pida |
| D3 | **Alcance de la entrega** | **Completo de una**: no hay corte MVP; se entrega el módulo entero (motor, editor completo, tablero, IA, integraciones, analítica y documentación) | Un solo release funcional; los hitos internos (F1…F7, D1…D5) se mantienen como orden de construcción, no como versiones comerciales |
| D4 | **Editor de plantillas** | **Como el editor interno de la referencia A**, no como su módulo «DocsPlus» (el avanzado y pesado) | Editor propio de Vendix por bloques + tokens sobre HTML controlado, con vista previa; el concepto se toma del editor interno, la implementación es nueva (TipTap/ProseMirror acotado). El render sigue siendo HTML→PDF con Chromium en servicio aparte |
| D5 | **Firma electrónica** | **Firma digital con responsabilidad del cliente al subirla**; Vendix solo la almacena y le deja el acceso al cliente | Se elimina OTP y proveedor certificado del alcance: el flujo carga el documento ya firmado, guarda hash/evidencia/versión y lo deja disponible para el cliente y para la etapa que lo exige. Firma simple con aceptación + evidencia queda como opción, no como requisito |
| D6 | **Precio y cuotas** | **Sin cuotas**: el uso es ilimitado al comprar el plan; los costos extra son solo implementaciones avanzadas, capacitaciones y consultoría | Se quitan los contadores de instancias/documentos/OTP y el `degradation` por cupo. Se conservan límites técnicos (tamaño de JSON, adjuntos, rate limit por IP) como protección, no como producto |

Consecuencia para el plan comercial: IA Business incluye Flujos y Gestión documental **sin cupos**; el discurso de venta es adaptabilidad total, no consumo medido.

---

## 2. Estado actual de Vendix

### 2.1 Tamaño y base

- `BE/prisma/schema.prisma`: **395 modelos**; **622** entradas en `BE/prisma/migrations`.
- Stack: NestJS 11, Prisma 7 con adaptador `PrismaPg` (`BE/src/prisma/base/base-prisma.service.ts`), Angular 20 zoneless.
- Industrias: `industry_enum` (`schema.prisma:5589`): `retail`, `restaurant`, `manufacturing`, `service`, `gym`, `construction`, `hospitality`. Las tiendas guardan `industries industry_enum[]`.

### 2.2 Planes y gating

| Pieza | Evidencia | Uso para Flujos |
|---|---|---|
| Modelo de plan | `subscription_plans` (`schema.prisma:12098`) con `code`, `feature_matrix Json`, `ai_feature_flags Json`, `is_ai_plan` | Activar `flows` en `ai_feature_flags` del plan IA Business |
| Suscripción | `store_subscriptions` (`schema.prisma:12171`) | — |
| Llaves de IA | `AIFeatureKey` cerrado de 8 valores (`BE/src/domains/store/subscriptions/types/access.types.ts:8-16`), `AI_FEATURE_KEYS` (:18), `isAIFeatureKey` (:29) | **No** se agrega `flows`: la compuerta del módulo es la matriz plan→módulo (D1); `ai_feature_flags` queda solo para cupos y app_keys |
| Guard | `@RequireAIFeature` (`.../subscriptions/guards/ai-access.guard.ts:21`), `AiAccessGuard` llama `canUseAIFeature` (:82). Ejemplo: `BE/src/domains/store/vex/vex.controller.ts:554` | Mismo decorador en todos los controladores de Flujos |
| Resolución | Redis `sub:features:{storeId}` TTL 60 s (`.../services/subscription-resolver.service.ts:13`); merge de overrides/promos (~:363) | Registrar `flows` en la lista del merge |
| Cuotas | `ai:quota:{storeId}:{feature}:{period}` (`.../services/subscription-access.service.ts:44`), `consumeAIQuota` con `requestId` (:154), `checkQuotaRemaining` (:254-276) | Cupos de instancias/renders/firmas |
| Seeds de producción | `starter`, `pro`, `enterprise`, todos `is_ai_plan: false` (`BE/prisma/seeds/subscription-plans-production.seed.ts:57,115,176`) | **No hay plan IA Business en seeds**: se administra por superadmin (`plans.service.ts`). No verifiqué el `code` real en prod. |
| Frontend | interceptor de paywall `FE/core/interceptors/subscription-paywall.interceptor.ts`, `FE/core/services/subscription-access.service.ts` (~:140 etiquetas, ~:160 grupos), `FE/core/guards/vex-access.guard.ts` (rol + setting, el plan lo impone el backend) | Copiar el patrón de Vex: guard de rol en FE, plan en BE |
| Escritura | `StoreOperationsGuard` global (`BE/src/app.module.ts:216-217`) bloquea POST/PATCH/PUT/DELETE de tiendas sin suscripción activa | Aplica solo a `/api/store/*` |

Comercial: IA Business cuesta $179.900/mes y es el único con "IA Tools e IA Agents" (`skills/vendix-propuesta-comercial/references/planes.md:12,23`).

### 2.3 Multi-tenant

- Servicios con scope: `global-prisma.service.ts` (906 líneas), `organization-prisma.service.ts` (664), `store-prisma.service.ts` (2262), `ecommerce-prisma.service.ts` (289) en `BE/src/prisma/services/`.
- Registro manual de modelos: `store_scoped_models` (`store-prisma.service.ts:11`), `org_scoped_models` (:746 y `organization-prisma.service.ts:26`). **Un modelo nuevo que no se agregue a estos arreglos queda sin scope**: riesgo de fuga entre tiendas.
- Contexto: `RequestContextService` con `AsyncLocalStorage` (`BE/src/common/context/request-context.service.ts:36`), campos `user_id`, `organization_id`, `store_id`, `app_type`, `roles`, `permissions`, `is_owner`… (:13-34); `run()` (:43) y `runIsolated()` (:60) para workers que fijan otro tenant.
- `app_type` por hostname: `GET public/domains/resolve/:hostname` (`BE/src/domains/public/domains/public-domains.controller.ts:48-55`), fuente `domain_settings.app_type`; el FE lo llama en `FE/core/services/app-config.service.ts:339`. Flujos vive en `STORE_ADMIN`; los enlaces públicos de firma y formularios viven en el dominio de la tienda.
- Orden de guards globales: throttler → JWT → `DomainScopeGuard` → `StoreOperationsGuard` (`app.module.ts:192-217`).

### 2.4 Usuarios, roles y responsables

- `users` (:10), `store_users` (:336, `@@unique([store_id,user_id])`), `roles` (:369, con `organization_id?`, `store_id?`, `is_system_role`), `permissions` (:428, `@@unique([path,method])`), `user_roles` (:443, `store_id` nulo = toda la organización), `role_permissions` (:469).
- `@Permissions` = `RequirePermissions` (`BE/src/domains/auth/decorators/permissions.decorator.ts:4-6`); `PermissionsGuard` (`BE/src/domains/auth/guards/permissions.guard.ts:14`) compara exacto, `super_admin` pasa.
- Siembra: `BE/prisma/seeds/permissions-roles.seed.ts` + `syncRolePermissions` (`BE/prisma/seeds/shared/sync-role-permissions.ts:58`).
- **No existen equipos, áreas ni grupos de trabajo.** Solo `employees.department` como texto libre (`schema.prisma:8278`). Responsables puntuales existen por módulo: `support_tickets.assigned_to_user_id` (:6592), `lodging_housekeeping_tasks.assigned_user_id`, `store_users.crm_owner_user_id`, `crm_tasks` (:15163), proveedores de servicio por estación.
- Conclusión: Flujos necesita **grupos de trabajo** nuevos (tabla + miembros) y reutiliza `roles` para asignar por rol.

### 2.5 Módulo Apps y menú

- `store_apps` (`schema.prisma:1238`): `kind app_kind_enum` (`ecommerce`, `store_home`, `landing`, `product_page`, `service_page`, `booking`), `status` (`not_installed`, `draft`, `published`, `disabled`), `config Json`, `@@unique([store_id,kind])`.
- Catálogo en código: `BE/src/domains/store/apps/apps.catalog.ts` (`APP_CATALOG` con `industries`); controlador `apps.controller.ts:13` con `store:apps:read` / `store:apps:manage`; setting `apps` en `BE/src/domains/store/settings/defaults/default-store-settings.ts:635`; FE `store_admin.routes.ts:719-740`, `apps-menu.util.ts`.
- **Las Apps son superficies públicas publicables** (tienda, landing, reservas). Flujos es un módulo interno de administración: **no debe ser un `app_kind`**. Sí se reutiliza el patrón "catálogo en código + estado por tienda" para la **galería de plantillas de flujo por industria**.
- Menú: `MenuFilterService` resuelve hoy `canSeeKey = usuario ∧ tienda ∧ industria` (`FE/core/services/menu-filter.service.ts:136`, `:1527`) con el mapa positivo `MODULE_INDUSTRIES` de `libs/shared-types` y el `AccessGateService` (`mode: audit|enforce`, superficies `sidebar`/`url`/`apps_card`/`vexi`). La capa de **plan** entra como cuarta condición y el módulo se llama `workflows` en código (`module_flows` ya significa toggles de contabilidad/nómina/facturación; en UI: "Flujos").

### 2.6 Motor de IA

- Registro: `AIToolRegistry` (`BE/src/ai-engine/tools/ai-tool-registry.ts:58`, `register` :73, `registerMany` ~:103). Cada dominio registra en su `onModuleInit`.
- Contrato de herramienta: `RegisteredTool` (`BE/src/ai-engine/tools/interfaces/tool.interface.ts:81`) con `requiredPermissions` (:108), `requiresConfirmation` (:109), `irreversible` (:120), `clientSide` (~:149), `preview` (:171); `ToolPreview` (:190).
- ~60 archivos `domains/*.tools.ts` y ~319 herramientas registradas (conteo por grep, aproximado).
- Confirmación: `VexiConfirmationService.issue()` (`BE/src/domains/store/vexi/vexi-confirmation.service.ts:101`); hash SHA-256 del preview (`ai-tool-registry.ts:30`); `confirmationToken`, `proposalOnly`, `expectedPreviewHash` (:20-28).
- Vex: `ai_agents` (`schema.prisma:6808`) con `allowed_tools`/`denied_tools`; aprobación de planes `plan-approval.service.ts` (`approvePlan` :201; acciones irreversibles reconfirman ~:126); bloques UI persistidos `vex-block.service.ts`.
- Tareas durables: `BE/src/ai-engine/tasks/*` y `ai_agent_objectives` (:7075). Playbooks: 22 `.md` en `BE/src/ai-engine/playbooks/content`. Memoria procedimental: `ai_agent_recipes`.
- Costos: `ai_engine_logs` vía `ai-logging.service.ts`; cuota consumida tras éxito (`ai-engine.service.ts:616,1003,1057`).
- Conclusión: Flujos entra como **un dominio más de herramientas** (`workflows.tools.ts`) y como **playbook** ("diseñar un flujo"). No hace falta infraestructura de IA nueva.

### 2.7 Eventos, colas, cron y auditoría

- `EventEmitterModule.forRoot()` (`app.module.ts:152`), ~165 archivos con `EventEmitter2`/`@OnEvent`. Eventos útiles como disparadores: `order.created`, `order.status_changed`, `payment.received`, `purchase_order.received`, `expense.approved`, `invoice.accepted`, `customer.created`, `stock.low`, `pqr.created`, `payroll.paid`, `scheduled_order.reminder`. **Son en memoria**: se pierden si el proceso cae.
- **No hay tabla outbox genérica.** Hay bitácoras por dominio (`order_events` ~:600, `subscription_events`, `service_progress_events`, …).
- BullMQ: `BE/src/common/queue/queue.module.ts:8`; 23 colas registradas (`ai-agent`, `email-notifications`, `crm-outbound`, `ai-scan`, …).
- Cron: `ScheduleModule.forRoot()` en `BE/src/jobs/jobs.module.ts:70`; 55 archivos con `@Cron`/`@Interval`; `BE/src/main.ts:74-136` desmonta crons según el proceso (backend vs worker): **los temporizadores de Flujos deben correr en `vendix_backend_worker`**.
- Auditoría: `audit_logs` (`schema.prisma:552`) con `old_values`, `new_values`, `request_id`, `store_id`; `AuditService` (`BE/src/common/audit/audit.service.ts:78`) + interceptor.

### 2.8 Notificaciones y mensajería

- In-app: `notifications` (`schema.prisma:5098`), SSE `@Sse('stream')` (`BE/src/domains/store/notifications/notifications.controller.ts:147`), Web Push VAPID (`notifications-push.service.ts`).
- Email: `BE/src/email/email.service.ts` con proveedor por `EMAIL_PROVIDER` (resend, ses, sendgrid, console). Plantillas `email_templates` (`schema.prisma:11796`, `body_html`, `variables`, `event_type`).
- WhatsApp: **no es stub**. `BE/src/messaging/providers/meta-cloud.provider.ts` llama Graph API (~:106) con reintentos; salida por cola `crm-outbound`; entrada por `BE/src/domains/public/meta-whatsapp/`. No verifiqué plantillas aprobadas en Meta ni estado de producción.
- SMS: `messaging/providers/sns-sms.provider.ts` (SNS) con tope de gasto (`sms-spend.service.ts`).

### 2.9 Formularios

- Campos personalizados: `entity_metadata_fields` (`schema.prisma:11456`): `field_key`, `field_type`, `label`, `is_required`, `options`, por tienda y `entity_type`.
- Formularios por pasos: `data_collection_templates` (:11509) → tabs → sections (anidables) → `data_collection_items` (:11580, `validation_rules Json`, `width`, `help_text`); envíos `data_collection_submissions` (:11613) con `token` público, `current_step`, `expires_at`, `ai_prediagnosis`. Código `BE/src/domains/store/data-collection/` y `FE/private/modules/store/data-collection`.
- Faltan para etapas: visibilidad condicional, tipo archivo, tipo firma, cálculo. No revisé los valores de `field_type_enum`.
- Conclusión: el **esquema de campo** y el **renderizador** se reutilizan; el formulario de etapa se guarda dentro de la versión del flujo (no como `data_collection_template`) para que quede congelado con la versión.

### 2.10 Documentos, archivos, firma, OCR

| Capacidad | Existe | Evidencia |
|---|---|---|
| PDF | pdfkit ^0.18 (`BE/package.json:104`) vía `BE/src/common/pdf/pdfkit.ts`; `pdfjs-dist` para leer | builders de orden, remisión, ruta, factura SaaS, factura DIAN (`print-formats/services/fiscal-invoice-pdf-render.service.ts`) |
| Plantillas editables | `print_templates` (`schema.prisma:11843`) con `definition` `{paper, sections, fields, columns, styles, tokens}`; compositor `print-layout-composer.service.ts` (2592 líneas) | Son plantillas **de impresión estructurada** (secciones, columnas, papel térmico), no documentos de texto libre con `{{tokens}}` |
| Plantillas de texto | `email_templates`, `crm_message_templates`, `legal_documents` (:6487, versionado) | Sin render a PDF |
| Aceptación con evidencia | `document_acceptances` (:6521): usuario, versión, IP, user-agent, `accepted_at`, único por (usuario, documento, versión) | Patrón base de "firma simple" |
| Decisión con prueba | `service_change_proposals` (:14513, `snapshot_hash` 64, `expires_at`) + `service_proposal_decisions` (:14543, `actor_type`, `proof Json`) | Patrón base de aprobación con evidencia |
| S3 | `BE/src/common/services/s3.service.ts`, `common/helpers/s3-path.helper.ts`, `is-safe-s3-key.decorator.ts`, firma en lectura | Reutilizable tal cual |
| Archivos | **No hay tabla genérica.** Hay `ai_attachments` (:7021, con `linked_entity_type/id`), `purchase_order_attachments`, `support_attachments`, `received_document_files`, `vendor_support_documents` | Hace falta `stored_files` |
| Firma dibujada / OTP de firma / hash de documento | **No existe.** No hay signature pad en FE ni servicio de hash/sellado | Construir |
| OCR / visión | `AIEngineService.run(appKey…)` con apps `invoice_ocr`, `received_document_ocr`, `rut_scanner`, `member_roster_ocr`, `payment_receipt_ocr`, …; jobs `BE/src/common/ai-scan-jobs/`; poll FE `FE/core/utils/async-job-poll.util.ts` | Reutilizable: un `app_key` nuevo por tipo de validación |

### 2.11 Flujos "duros" existentes (casos de uso y patrón)

No existe un helper genérico de máquina de estados; cada módulo tiene su mapa:
- Mapas de transición: `fiscal-obligation.service.ts:72` (`OBLIGATION_STATUS_TRANSITIONS`), `journal-entry-flow.service.ts:9` (`VALID_TRANSITIONS`), `hospitality/reservations/reservation-status.ts:9` (`canTransition` :28), `housekeeping-status.ts:24`.
- Enums: órdenes de compra (`draft→approved→partial→received`), remisiones, rutas, nómina (`draft→calculated→approved→sent→accepted→paid`), cotizaciones, sesiones de servicio (`open, paused, closed, cancelled, no_show`).
- Pedidos programados: `BE/src/domains/store/scheduled-orders/` con recordatorios y excepciones de cumplimiento.
- Aprobación: OC `approved`, nómina `approved`, plan de Vex. **No hay tabla genérica de solicitud de aprobación.**
- Conclusión: Flujos **no reemplaza** estas máquinas (son reglas contables/fiscales duras). Se conecta a ellas por eventos y por acciones que llaman sus servicios.

### 2.12 API pública, webhooks y MCP

- `api_keys` (`schema.prisma:3635`): `user_id`, `key_hash`, `permissions Json`, sin `store_id`; **sin uso en `BE/src`** (verificar antes de reusar).
- Webhooks salientes: **no existen**. Todos los webhooks son entrantes (Wompi, Meta, recepción de documentos).
- MCP: `BE/src/domains/store/mcp/` (`mcp.controller.ts`, `McpToolProvider`), autentica con el mismo JWT; OAuth 2.1 queda pendiente según su propio comentario.
- Conclusión: hoy Flujos puede exponerse por REST con JWT y por MCP. Para integraciones de terceros hacen falta **API keys por tienda** y **webhooks firmados**.

### 2.13 Analítica y UI reutilizable

- `BE/src/domains/store/analytics/` con contrato `analytics-metrics.contract.ts`; XLSX con ExcelJS y `BE/src/common/reports/report-builder.ts`.
- FE: `chart.js` + `echarts`/`ngx-echarts`, `StatsComponent`, `@angular/cdk` ^20 (DragDrop); precedente de kanban: `FE/private/modules/store/customers/crm/pipeline/pipeline.component.ts`.
- **No hay** librería de grafos/diagramas, visor PDF, editor WYSIWYG ni signature pad. Sí hay `FE/shared/components/markdown-editor`, `diff-viewer`, `file-upload-dropzone`.

### 2.14 Resumen: reutilizar vs construir

| Reutilizar (sin cambios o con extensión menor) | Construir |
|---|---|
| Tenant y scopes, roles/permisos, `AiAccessGuard` + cuotas | Modelo de definición/versión/instancia/tarea |
| BullMQ, cron en worker, `AuditService` | Motor de transición con CAS, outbox y temporizadores |
| Notificaciones SSE/push/email/WhatsApp/SMS | Grupos de trabajo |
| `AIToolRegistry` + confirmación + Vex plan approval + playbooks | Editor de etapas, bandeja, tablero, simulador |
| Esquema de campo de `data_collection_items` y su renderizador | Formularios condicionales, campo archivo y firma |
| S3 con llaves seguras, OCR por `app_key` | `stored_files`, expediente, plantillas HTML con tokens, render Chromium |
| `document_acceptances` / `service_proposal_decisions` como patrón de evidencia | Solicitudes de firma, OTP de firma, sellado SHA-256 |
| `report-builder` XLSX, `StatsComponent`, CDK DragDrop | API keys por tienda, webhooks salientes firmados |

---

## 3. Qué hacen las referencias y qué patrones valen

### 3.1 Referencia A (dominio clínico, flujos por estados)

- Modelo: definición (cabecera + JSON de metadatos) → estados jerárquicos con orden tipo "1.2.1" → aristas con condiciones → ramas y nodos anidados → formularios (esquema JSON y además EAV) → instancia con contexto JSON → historial de estados y de contexto (este último por trigger de base de datos y un "atomizador" diferido).
- Motor: una "autoridad de transición" que bloquea la fila de la instancia, verifica el estado esperado (compare-and-set, 409), busca la arista, evalúa la condición (falla cerrado) y verifica el acceso del actor al estado destino; luego escribe estado + historial en la misma transacción. El actor sale de la sesión, nunca del cuerpo de la petición. Además, un servicio de auto-avance de ~3.800 líneas con un manejador por tipo de nodo (fork, paralelo, salto, bucle, subproceso, llamada API) que **clona la instancia** por rama.
- Editor: diseñador de secuencias anidadas (árbol, no grafo) vendorizado; el backend aplana el árbol en filas y lo reconstruye al leer. Sin versiones ni borrador/publicado (solo un flag de "operativo").
- Tablero: kanban por estado con drag nativo, paginado por columna, filtrado por estados permitidos al usuario. Un servicio de métricas (tiempo de ciclo, cuellos, salud) está muerto: nadie lo llama.
- Documentos: plantillas JSON de un diseñador PDF de posicionamiento absoluto, token `{var}` con filtros, alternativas, rutas e `if`; tres sintaxis históricas normalizadas a una. Render servidor que re-implementa el formato del diseñador (6.000 líneas) además del render en cliente: dos motores que pueden divergir. Plantillas atadas a estados con "obligatorio".
- Firma: la parte más madura. Hash SHA-256 sobre JSON canónico del contenido, recibo firmado de vida corta con identificador único y control de repetición, enlace remoto con token guardado solo como hash, TTL de 10 min, intentos máximos, ligado a dispositivo y geolocalización, TOTP/OTP/WebAuthn como segundo factor. Pero la evidencia vive esparcida en el contexto JSON de la instancia, y **el PDF generado no se hashea ni se sella**: la firma liga el contenido, no el archivo.
- OCR: tres caminos sin interfaz común.

### 3.2 Referencia B (onboarding comercial, flujos secuenciales)

- Modelo: el mismo flujo vive en tres sitios (JSON del diseñador, filas relacionales de etapas/tareas con un blob del paso, y una configuración legada tipo máquina de estados) con dos endpoints de guardado y dos sincronizadores. Una tabla de "estado de instancia secuencial" está muerta.
- Motor: resolución de transición por prioridad (condiciones dinámicas → siguiente etapa declarada → fallback legado); condiciones como **árbol** (grupo/operador lógico/campo/comparador/valor) con un constructor de contexto por proveedores de campos; resultados de tarea (avanzar, rechazar, finalizar); **asignación por menor carga** dentro del grupo de trabajo de la etapa, transaccional, con reasignación auditada.
- Variables: un **catálogo unificado de variables** (cliente, productos, requisitos, tareas, etapas, respuestas, rutas JSON) que consumen tanto el constructor de condiciones como el editor de PDF. Buen patrón.
- Linter estructural: verificación SQL por flujo ("exactamente una etapa inicial", "tiene etapa final", "etapas sin tarea", "etapas sin grupo"). Buen patrón.
- Editor: misma librería de diseño secuencial con ~35 editores de propiedades y ~8.000 líneas de extensiones para parecer BPMN; validador permisivo que suprime errores de los nodos que fingen aristas hacia atrás. Sin simulación.
- Documentos: plantillas de diseñador PDF sin versiones, preview que solo devuelve JSON (no PDF), un contrato fijo pintando rectángulos blancos sobre un PDF base, y una "cola" de PDFs que en realidad se procesa dentro de la petición de sondeo.
- Firma exprés: enlace con token aleatorio guardado como hash en caché con TTL de 30 min y lock para consumo idempotente; imagen PNG a S3 privado; transacción con rollback del objeto. Sin OTP, sin hash del documento, sin user-agent ni texto de consentimiento congelado; la sesión desaparece al vencer la caché, así que la traza de quién firmó qué versión no sobrevive.
- Validación IA de documentos: extracción + comparación con el formulario con normalizadores tipados + validación cruzada entre documentos + reglas de negocio; resultado como un JSON grueso en el caso con un hash de documentos como caché; sin versión de modelo/prompt; tres proveedores mezclados; ejecución por proceso desacoplado en vez de la cola.

### 3.3 Tabla de patrones

| Patrón | Por qué sirve | Cómo se adapta a Vendix | Qué NO se copia |
|---|---|---|---|
| Transición con lock + estado esperado + historial en la misma transacción | Evita dobles avances (el bug de doble clic del POS ya nos costó: ver memoria `project_pos_doubleclick_race`) | `updateMany where {id, row_version}` (CAS optimista) + `flow_instance_events` en `$transaction`; `Idempotency-Key` por comando | El auto-avance de miles de líneas con un manejador por tipo |
| Actor desde sesión, nunca del body | Seguridad | `RequestContextService.user_id` | — |
| Condiciones como árbol JSON, evaluador único que falla cerrado | Determinista, validable, explicable por IA | Un solo dialecto `{all|any:[{field, op, value}]}` con operadores cerrados | Cuatro formatos de condición + expresiones JS en texto |
| Catálogo unificado de variables | Mismo vocabulario para condiciones, plantillas y formularios | Servicio `FlowVariableCatalog` que deriva variables de la versión (formularios) + entidad vinculada (cliente, orden, OC) | Descubrimiento por introspección de columnas JSON de la BD |
| Linter estructural del flujo | Detecta flujos rotos antes de publicar | Validador determinista en `publish` (y herramienta IA `workflows_validate`) | Verificar contra la BD en producción después del hecho |
| Asignación por menor carga en grupo | Reparto justo sin jefe repartiendo | v1: rol/grupo/usuario/campo + "round-robin" o "menor carga" | Carga como columna mutable sin recálculo |
| Token remoto guardado solo como hash, TTL, intentos, consumo idempotente | Enlaces de firma seguros | `signature_requests.token_hash` + `expires_at` + `attempts` + lock CAS | Sesión solo en caché (la evidencia debe ser persistente) |
| Hash SHA-256 sobre forma canónica + recibo + anti-repetición | Integridad verificable | Hash del **PDF final** y del snapshot de datos, cadena de eventos con `prev_hash` | Evidencia dentro del contexto JSON del caso |
| Plantilla ↔ etapa con "obligatorio" | Documento como requisito | `stage.requirements[]` en la versión del flujo | Banderas booleanas sueltas por canal y visibilidad |
| Versiones de documentos generados (`is_latest`, padre) | Reemisión trazable | `documents.supersedes_id` | Plantillas sin versión |
| Kanban por etapa paginado por columna y filtrado por permisos | Escala | Endpoint de tablero con cursor por columna | Broadcast en tiempo real disparado desde el cliente |
| Variables de formulario fusionadas al contexto del caso con etiquetas | Datos listos para documentos | `instance.data` tipado por la versión | EAV + trigger + atomizador diferido |

### 3.4 Errores comunes a ambas que no se repiten (reglas de diseño)

1. **Nada de fuentes de verdad duplicadas.** La versión publicada es un JSON inmutable; el motor no lee filas espejo.
2. **Nada de editar en vivo.** Editar crea un borrador; publicar crea versión N+1; las instancias en curso siguen en su versión (migración opcional y explícita).
3. **Nada de reglas de un cliente dentro del motor.** Lo específico va como acción o como requisito declarado, no como `if` en el motor.
4. **Nada de archivos-dios.** Límite práctico ~400 líneas por servicio; motor, validador, evaluador, asignador y despachador de acciones separados.
5. **Nada de ids fijos en código** (requisito 37, producto 2…). Todo por clave estable dentro de la versión.
6. **Nada de árbol que finge grafo.** El modelo es un grafo dirigido de etapas con transiciones explícitas; la UI puede presentarlo como lista.
7. **Nada de trabajo pesado en la petición.** Render, OCR, webhooks y notificaciones van por cola.
8. **Nada de resultados IA sin procedencia.** Cada resultado guarda `app_key`, modelo, versión de prompt y hash de entrada.

---

## 4. Propuesta de producto

### 4.1 Concepto

**Flujos** convierte un proceso administrativo de la empresa en una ruta con etapas, responsables, formularios, documentos y plazos. Cada caso (una "solicitud") avanza por esas etapas; Vendix avisa a quien le toca, impide saltarse requisitos, guarda el expediente con evidencia y muestra dónde se atasca el proceso. La IA ayuda a diseñarlo, explicarlo y vigilarlo.

Vocabulario de UI (en español, sin anglicismos):
- **Flujo**: la plantilla del proceso (p. ej., "Aprobación de compras").
- **Etapa**: un paso del flujo.
- **Solicitud**: una ejecución concreta (instancia).
- **Tarea**: lo que una persona debe hacer en una etapa de una solicitud.
- **Grupo**: conjunto de personas que atiende una etapa.
- **Expediente**: todos los documentos, firmas y archivos de una solicitud.

### 4.2 Usuario objetivo

- **Dueño/administrador** de una empresa de 5–200 empleados con IA Business, que hoy lleva aprobaciones por WhatsApp y Excel.
- **Jefes de área** que aprueban o asignan.
- **Colaboradores** que ejecutan tareas desde la bandeja (también desde el celular, vía web responsive; `apps/mobile` fuera de alcance).
- **Terceros externos** (cliente, proveedor, candidato) que solo llenan un formulario o firman por enlace.

### 4.3 Historias de usuario principales

**H1 — Diseñar un flujo.** Como dueño en el panel de administración de mi tienda (`https://<tienda>.vendix.com/admin/workflows`), quiero crear un flujo con etapas, responsables, formularios y documentos, para que mi equipo siga siempre el mismo proceso.
- Pasos: Flujos → "Nuevo flujo" → elige plantilla "Aprobación de compras" o "Describir con IA" → ajusta etapas en la lista → asigna rol/grupo por etapa → agrega campos → "Simular" → "Publicar".
- Criterios observables: ve el flujo en estado *Borrador* hasta publicar; el botón Publicar muestra los errores del validador con el nombre de la etapa ("La etapa 'Aprobación gerente' no tiene responsable"); tras publicar ve "Versión 1 publicada".

**H2 — Atender mi bandeja.** Como colaborador, quiero ver solo las tareas que me tocan con su vencimiento, para atenderlas a tiempo.
- Pasos: Flujos → "Mis tareas" → abre una → llena el formulario → "Aprobar" o "Rechazar con motivo".
- Criterios: la tarea desaparece de su bandeja y aparece en la del siguiente responsable; si otra persona la atendió primero ve "Esta tarea ya fue atendida por <nombre>" (no se duplica el avance).

**H3 — Seguimiento.** Como dueño, quiero un tablero por etapa con tiempos y vencidos, para saber dónde se atasca el proceso.
- Criterios: columnas por etapa con conteo, tarjetas vencidas resaltadas, KPIs (en curso, vencidas, tiempo promedio por etapa, p90) y exportación XLSX con los mismos números que la pantalla.

**H4 — Documento y firma por etapa.** Como jefe de talento humano, quiero que la etapa "Contratación" genere el contrato con los datos del formulario y que el candidato suba el contrato firmado por su propio medio, para no avanzar sin documento firmado.
- Criterios: el botón "Avanzar" aparece deshabilitado con el texto "Falta: Contrato firmado por Candidato"; al subirlo, el expediente muestra el PDF, la fecha, quién lo aportó y el hash; si se reemplaza, queda la versión anterior y el registro de quién y cuándo.

**H5 — IA.** Como dueño, quiero describir mi proceso en una frase y recibir un borrador de flujo, para no empezar de cero.
- Criterios: Vexi/Vex muestra una tarjeta de propuesta con etapas y responsables; nada se crea hasta "Confirmar"; lo creado queda como *Borrador*, nunca publicado por la IA.

### 4.4 Casos de uso por industria (plantillas de la galería)

| Industria | Flujo plantilla | Etapas típicas | Documentos | Disparador Vendix |
|---|---|---|---|---|
| Retail | Aprobación de compras sobre umbral | Solicitud → Jefe de tienda → Gerente (si > $X) → OC creada | Cotizaciones adjuntas | Acción "crear OC en borrador" |
| Retail | Garantías y devoluciones | Recepción → Diagnóstico → Decisión → Reposición/Nota crédito | Acta de recepción firmada por cliente | `order.status_changed` |
| Retail | Alta de proveedor | Datos → Documentos (RUT, cámara de comercio, certificación bancaria) → Validación → Activo | RUT validado con `rut_scanner` existente | Formulario público |
| Restaurante | Contratación de personal | Postulación → Entrevista → Exámenes → Contrato → Inducción | Contrato firmado, manipulación de alimentos | Formulario público |
| Restaurante | Mantenimiento de equipos | Reporte → Asignación → Ejecución → Verificación | Fotos antes/después | Manual o cron mensual |
| Servicios | Onboarding de cliente B2B | Propuesta → Aceptación → Contrato → Kickoff | Propuesta y contrato con tokens, firma remota | `customer.created` |
| Servicios / PQR | Gestión de PQR con plazo legal | Radicado → Análisis → Respuesta → Cierre | Respuesta formal en PDF | `pqr.created` |
| Hotelería | Convenio corporativo | Solicitud → Tarifa → Aprobación → Convenio firmado | Convenio con tokens | Manual |
| Hotelería | Daños en habitación | Reporte housekeeping → Cotización → Cobro/condonación | Fotos + acta | Manual |
| Gym | Afiliación con contrato | Datos → Valoración → Contrato → Activación | Contrato + consentimiento firmado | Membresía nueva |
| Construcción | Orden de cambio de obra | Solicitud → Presupuesto → Aprobación cliente → Ejecución | Orden de cambio firmada | Manual |
| Transversal | Solicitud de vacaciones / anticipo | Solicitud → Jefe → RR. HH. | Formato firmado | Manual |

### 4.5 Alcance

**Alcance incluido (todo en el mismo release)**
- Definición con etapas, transiciones con condiciones (árbol JSON), etapa inicial, finales (éxito/rechazo/cancelado).
- Responsables por rol, grupo, usuario o "quien creó la solicitud"; reparto round-robin dentro del grupo.
- Formularios por etapa (texto, número, moneda, fecha, selección, sí/no, archivo, firma), obligatorios y visibilidad condicional simple.
- Aprobación: una persona, o N de M del grupo (quórum).
- Vencimiento por etapa con recordatorio y escalamiento a un rol.
- Notificaciones: in-app + push + email; WhatsApp con plantilla aprobada si la tienda tiene el canal.
- Bandeja "Mis tareas", lista de solicitudes, detalle con línea de tiempo, tablero kanban, KPIs básicos.
- Borrador/publicado con versiones inmutables; simulación paso a paso sin efectos.
- Import/export JSON (`vendix.workflow/v1`).
- Disparadores: manual, formulario público por enlace, y 6 eventos de negocio seleccionados.
- Acciones: notificar, crear tarea, generar documento, solicitar firma, cambiar campo de la solicitud, llamar acciones Vendix seleccionadas en borrador (crear OC borrador, crear tarea CRM).
- Gestión documental MVP (§10).
- IA: generar borrador, explicar solicitud, validar flujo (herramientas con confirmación).

**Resto del alcance (mismo release, no otra versión)**
- Canvas de grafo (vista y edición ligera), analítica de cuellos de botella con narrativa IA, webhooks salientes firmados, API keys por tienda, plantillas por industria (12 de §4.4), asignación por menor carga, temporizadores de espera ("esperar 3 días"), editor visual de plantillas de documento, validación IA de documentos, políticas de retención.

**v2 (no comprometido)**
- Definiciones por organización compartidas entre tiendas, subflujos, paralelismo real (fork/join de etapas), firma digital certificada con proveedor ECD, nodos HTTP genéricos hacia APIs externas, disparadores por cron con expresión libre.

### 4.6 No-alcance explícito

- **No es un n8n general.** Sin nodos de código, sin HTTP arbitrario en v1, sin cientos de integraciones de terceros.
- No reemplaza las máquinas de estado duras existentes (facturación DIAN, nómina, contabilidad, OC, remisiones, caja). Las invoca por acciones y escucha sus eventos.
- Sin BPMN 2.0 completo (eventos intermedios, compensación, mensajes entre pools).
- Sin firma digital con certificado (PAdES/XAdES) en v1.
- Sin `apps/mobile`.
- Sin edición de flujos publicados en caliente.
- La IA no publica flujos ni avanza solicitudes sin confirmación humana.

### 4.7 Argumento comercial (IA Business)

- **Hoy el plan IA Business se vende por "Vex/Vexi + IA tools"**; ambos son asistentes. Flujos añade **un producto operativo diario** que retiene: cuando el proceso de compras, contratación y garantías vive en Vendix, cambiar de software cuesta.
- Mensaje: "Tus procesos administrativos, con responsables, plazos, documentos firmados y un asistente que los diseña y los vigila — dentro del mismo sistema donde vendes, facturas y llevas inventario."
- Diferenciador frente a herramientas genéricas (Trello, formularios, n8n): **contexto nativo** (clientes, órdenes, OC, empleados, tiendas), **firma y expediente** incluidos y **IA en español sobre los datos del negocio**.
- Riesgo comercial honesto: el valor aparece solo si el cliente configura al menos un flujo. Por eso las plantillas por industria y "Describir con IA" son parte del MVP comercial, no adornos.

---

## 5. Arquitectura técnica

### 5.1 Principios

1. Definición = JSON validado e inmutable por versión (fuente única).
2. Runtime = filas pequeñas indexadas (solicitud, tarea, evento), nunca copia de la definición.
3. Toda transición pasa por **un** servicio (`WorkflowEngineService.transition`) con CAS e idempotencia.
4. Efectos (notificar, renderizar, firmar, webhook) se registran en outbox dentro de la misma transacción y se ejecutan por cola.
5. Todos los modelos nuevos se registran en `store_scoped_models` (`BE/src/prisma/services/store-prisma.service.ts:11`) con test de aislamiento.

### 5.2 Modelo de datos (Prisma, migraciones aditivas)

Convenciones: snake_case, `id Int @id @default(autoincrement())`, `store_id` + `organization_id` en toda tabla de runtime para índices y scope, `created_at/updated_at`. Enums nuevos con prefijo `workflow_`.

```prisma
// --- Definición ---
model workflow_definitions {
  id                    Int      @id @default(autoincrement())
  organization_id       Int
  store_id              Int
  key                   String   @db.VarChar(80)   // estable, slug
  name                  String   @db.VarChar(160)
  description           String?
  status                workflow_definition_status_enum @default(draft) // draft | active | archived
  draft_definition      Json?    // borrador editable (no ejecutable)
  draft_updated_at      DateTime?
  published_version_id  Int?     @unique
  category              String?  @db.VarChar(60)
  source_template_key   String?  @db.VarChar(80)   // plantilla de galería de origen
  created_by_user_id    Int
  updated_by_user_id    Int?
  created_at            DateTime @default(now())
  updated_at            DateTime @updatedAt
  @@unique([store_id, key])
  @@index([store_id, status])
}

model workflow_versions {
  id               Int      @id @default(autoincrement())
  store_id         Int
  definition_id    Int
  version          Int
  schema_version   String   @db.VarChar(20)  // "vendix.workflow/v1"
  definition       Json     // INMUTABLE tras publicar
  definition_hash  String   @db.Char(64)     // sha256 de JSON canónico
  published_by_user_id Int
  published_at     DateTime @default(now())
  changelog        String?
  @@unique([definition_id, version])
  @@index([store_id])
}

// --- Grupos de trabajo ---
model work_groups {
  id              Int      @id @default(autoincrement())
  organization_id Int
  store_id        Int
  name            String   @db.VarChar(120)
  description     String?
  is_active       Boolean  @default(true)
  assignment_strategy workflow_assignment_strategy_enum @default(round_robin) // round_robin | least_load | manual
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  @@unique([store_id, name])
}

model work_group_members {
  id            Int      @id @default(autoincrement())
  store_id      Int
  work_group_id Int
  user_id       Int
  is_lead       Boolean  @default(false)
  is_available  Boolean  @default(true)   // vacaciones / ausente
  @@unique([work_group_id, user_id])
  @@index([store_id, user_id])
}

// --- Runtime ---
model workflow_instances {
  id                 Int      @id @default(autoincrement())
  organization_id    Int
  store_id           Int
  definition_id      Int
  version_id         Int                       // fija para toda la vida
  reference          String   @db.VarChar(30)  // "FLU-000123", correlativo por tienda
  title              String   @db.VarChar(200)
  status             workflow_instance_status_enum @default(active) // active | completed | rejected | cancelled | failed
  current_stage_key  String   @db.VarChar(80)
  stage_entered_at   DateTime
  stage_due_at       DateTime?
  data               Json     @default("{}")   // valores de formularios por campo
  subject_type       String?  @db.VarChar(40)  // customer | order | purchase_order | employee | supplier
  subject_id         Int?
  started_by_type    workflow_actor_type_enum  // user | public | system | ai
  started_by_id      Int?
  row_version        Int      @default(0)      // CAS
  completed_at       DateTime?
  created_at         DateTime @default(now())
  updated_at         DateTime @updatedAt
  @@unique([store_id, reference])
  @@index([store_id, definition_id, status, current_stage_key])
  @@index([store_id, status, stage_due_at])
  @@index([store_id, subject_type, subject_id])
}

model workflow_tasks {
  id                Int      @id @default(autoincrement())
  organization_id   Int
  store_id          Int
  instance_id       Int
  stage_key         String   @db.VarChar(80)
  stage_entry_seq   Int                       // n-ésima vez que la solicitud entra a la etapa (bucles)
  kind              workflow_task_kind_enum   // form | approval | review | sign | manual
  status            workflow_task_status_enum @default(open) // open | claimed | done | skipped | expired | cancelled
  assignee_user_id  Int?
  assignee_role_id  Int?
  assignee_group_id Int?
  claimed_at        DateTime?
  due_at            DateTime?
  outcome           String?  @db.VarChar(40)  // approve | reject | submit | <outcome declarado>
  outcome_comment   String?
  completed_by_user_id Int?
  completed_at      DateTime?
  created_at        DateTime @default(now())
  @@index([store_id, assignee_user_id, status, due_at])
  @@index([store_id, assignee_group_id, status])
  @@index([store_id, assignee_role_id, status])
  @@index([instance_id, stage_key, stage_entry_seq])
}

model workflow_instance_events {      // historial append-only
  id             BigInt   @id @default(autoincrement())
  store_id       Int
  instance_id    Int
  seq            Int                        // 1..n por instancia
  type           String   @db.VarChar(40)   // started | transitioned | task_completed | field_changed | escalated | document_issued | signed | comment
  from_stage_key String?  @db.VarChar(80)
  to_stage_key   String?  @db.VarChar(80)
  actor_type     workflow_actor_type_enum
  actor_id       Int?
  payload        Json     @default("{}")
  idempotency_key String? @db.VarChar(80)
  occurred_at    DateTime @default(now())
  @@unique([instance_id, seq])
  @@unique([store_id, idempotency_key])
  @@index([store_id, occurred_at])
}

model workflow_outbox {               // efectos diferidos (patrón outbox)
  id            BigInt   @id @default(autoincrement())
  store_id      Int
  instance_id   Int?
  kind          String   @db.VarChar(40)  // notify | render_document | request_signature | webhook | action
  payload       Json
  status        workflow_outbox_status_enum @default(pending) // pending | processing | done | failed | dead
  attempts      Int      @default(0)
  available_at  DateTime @default(now())
  last_error    String?
  created_at    DateTime @default(now())
  @@index([status, available_at])
  @@index([store_id, instance_id])
}

// --- Integración externa ---
model workflow_webhook_endpoints {
  id            Int      @id @default(autoincrement())
  store_id      Int
  url           String   @db.VarChar(500)
  secret_enc    String                       // cifrado; firma HMAC-SHA256
  event_types   String[]
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now())
  @@index([store_id, is_active])
}

model workflow_webhook_deliveries {
  id            BigInt   @id @default(autoincrement())
  store_id      Int
  endpoint_id   Int
  event_id      String   @db.VarChar(40)    // id único del evento (reintentos idempotentes del receptor)
  status_code   Int?
  attempts      Int      @default(0)
  delivered_at  DateTime?
  next_retry_at DateTime?
  last_error    String?
  @@unique([endpoint_id, event_id])
}

model store_api_keys {
  id            Int      @id @default(autoincrement())
  organization_id Int
  store_id      Int
  name          String   @db.VarChar(120)
  prefix        String   @db.VarChar(12)    // visible: "vdx_live_ab12"
  key_hash      String   @unique @db.Char(64)
  scopes        String[]                    // workflows:read, workflows:write, documents:read
  created_by_user_id Int
  last_used_at  DateTime?
  expires_at    DateTime?
  revoked_at    DateTime?
  created_at    DateTime @default(now())
  @@index([store_id])
}
```

Notas del modelo:
- **Por qué no filas de etapas**: la etapa existe solo en `workflow_versions.definition`. El runtime guarda `current_stage_key`. Así no hay sincronizador ni doble verdad (defecto principal de ambas referencias).
- **Por qué `store_api_keys` nueva y no extender `api_keys`**: `api_keys` (`schema.prisma:3635`) está atada a `user_id`, no tiene tenant y no tiene lector. Extenderla mezcla semánticas; la tabla nueva es aditiva y no toca nada existente. `api_keys` queda como está.
- **Eventos con `seq` único por instancia**: además de auditoría, sirve de segundo candado (dos transiciones concurrentes no pueden escribir el mismo `seq`).
- **Migración**: 100 % aditiva (CREATE TABLE/ENUM/INDEX idempotentes), sin mutación de filas: no requiere `-- DATA IMPACT`. Antes de escribirla: skill `vendix-prisma-migrations`.
- **Permisos**: filas nuevas en `permissions-roles.seed.ts` + `syncRolePermissions`.

### 5.3 Esquema JSON de la definición (`vendix.workflow/v1`)

```jsonc
{
  "schema": "vendix.workflow/v1",
  "key": "aprobacion-compras",
  "name": "Aprobación de compras",
  "subject": { "type": "purchase_request" },           // o customer, employee, supplier, none
  "fields": [                                           // catálogo de datos de la solicitud
    { "key": "monto", "type": "money", "label": "Monto estimado", "required": true },
    { "key": "proveedor", "type": "text", "label": "Proveedor" },
    { "key": "cotizacion", "type": "file", "label": "Cotización", "accept": ["application/pdf","image/*"] }
  ],
  "stages": [
    {
      "key": "solicitud", "name": "Solicitud", "type": "form", "start": true,
      "assignee": { "kind": "initiator" },
      "form": { "fields": ["monto","proveedor","cotizacion"] },
      "transitions": [ { "to": "jefe", "on": "submit" } ]
    },
    {
      "key": "jefe", "name": "Aprobación jefe de tienda", "type": "approval",
      "assignee": { "kind": "role", "role_key": "store_manager" },
      "due": { "hours": 24, "business_hours": true, "on_overdue": { "remind_every_hours": 8, "escalate_to": { "kind": "role", "role_key": "owner" } } },
      "transitions": [
        { "to": "gerente", "on": "approve", "when": { "all": [ { "field": "monto", "op": "gt", "value": 2000000 } ] } },
        { "to": "crear_oc", "on": "approve" },
        { "to": "rechazada", "on": "reject", "require_comment": true }
      ]
    },
    {
      "key": "gerente", "name": "Aprobación gerencia", "type": "approval",
      "assignee": { "kind": "group", "group_ref": "gerencia" }, "quorum": { "required": 1 },
      "requirements": [ { "kind": "file_field", "field": "cotizacion" } ],
      "transitions": [ { "to": "crear_oc", "on": "approve" }, { "to": "rechazada", "on": "reject" } ]
    },
    {
      "key": "crear_oc", "name": "Crear OC", "type": "automatic",
      "on_enter": [ { "action": "vendix.purchase_order.create_draft", "map": { "supplier_name": "{{fields.proveedor}}", "estimated_total": "{{fields.monto}}" } } ],
      "transitions": [ { "to": "aprobada", "on": "auto" } ]
    },
    { "key": "aprobada", "name": "Aprobada", "type": "end", "outcome": "completed" },
    { "key": "rechazada", "name": "Rechazada", "type": "end", "outcome": "rejected",
      "on_enter": [ { "action": "notify", "to": { "kind": "initiator" }, "template": "solicitud_rechazada" } ] }
  ],
  "triggers": [ { "kind": "manual" }, { "kind": "public_form", "stage": "solicitud" } ]
}
```

Reglas del validador (deterministas, ejecutadas en `publish` y por la herramienta IA):
1. Exactamente una etapa `start`; al menos una `end`; todas las etapas alcanzables desde `start`; desde toda etapa no final se alcanza un `end`.
2. Toda etapa no automática ni final tiene `assignee` resoluble (rol existe en la tienda, grupo existe y tiene ≥ 1 miembro disponible).
3. Toda transición referencia una etapa existente; `on` pertenece al conjunto del tipo de etapa (`approval`: approve/reject; `form`: submit; `automatic`: auto).
4. Las condiciones solo usan campos declarados y operadores compatibles con su tipo; ninguna rama ambigua sin una transición por defecto (sin `when`) al final.
5. Acciones solo de la lista blanca registrada; `map` solo con tokens del catálogo de variables.
6. Ciclos permitidos solo si pasan por una etapa con tarea humana (evita bucles automáticos infinitos).
7. Requisitos documentales referencian plantillas publicadas existentes.
8. Límites: ≤ 60 etapas, ≤ 150 campos, ≤ 20 transiciones por etapa, JSON ≤ 256 KB.

El esquema se define una vez en TypeScript (tipos + validador con `class-validator` o un esquema JSON compartido en `libs/shared-types`) y lo consumen backend, frontend e IA.

### 5.4 Motor de ejecución

**Comandos** (únicas puertas de escritura):
- `start(definitionKey, data, subject?, idempotencyKey)`.
- `completeTask(taskId, outcome, formValues, comment?, expectedRowVersion, idempotencyKey)`.
- `transition(instanceId, to, reason)` — solo administradores, para corregir (queda en historial como `forced`).
- `cancel(instanceId, reason)`.
- `tick(instanceId)` — interno, para vencimientos y etapas automáticas.

**Algoritmo de `completeTask`** (todo dentro de `prisma.$transaction`):
1. Cargar tarea + instancia (scope de tienda por `StorePrismaService`).
2. Verificar que el actor (`RequestContextService`) puede atender: es el asignado, o pertenece al rol/grupo, y tiene `store:workflows:task`.
3. Validar formulario contra la versión (tipos, obligatorios, visibilidad).
4. Si la etapa tiene quórum, registrar el voto; si no se alcanza, terminar aquí.
5. Verificar requisitos de salida (documento emitido, firma completa, campo archivo presente). Si falta alguno → `409 WORKFLOW_REQUIREMENT_PENDING` con la lista legible.
6. Resolver transición: filtrar por `on = outcome`, evaluar `when` en orden, tomar la primera verdadera; si ninguna → `422 WORKFLOW_NO_TRANSITION`.
7. `updateMany({ where: { id, row_version: expected }, data: { current_stage_key, row_version: { increment: 1 }, … } })`; si `count = 0` → `409 WORKFLOW_STALE` ("Esta solicitud cambió; recarga").
8. Insertar `workflow_instance_events` con `seq = último + 1` e `idempotency_key`; si el `idempotency_key` ya existe → devolver el resultado previo (reintento seguro).
9. Cerrar tareas de la etapa saliente, crear tareas de la entrante (asignador).
10. Encolar efectos `on_exit` / `on_enter` en `workflow_outbox`.
11. Si la etapa entrante es `automatic`, encolar `tick` (no se encadena dentro de la misma transacción: evita cadenas largas y bucles).

**Despachador de outbox**: un processor BullMQ (cola nueva `workflows`) en `vendix_backend_worker` toma lotes `pending` con `FOR UPDATE SKIP LOCKED` (vía `$queryRaw`), ejecuta con `RequestContextService.runIsolated` fijando el tenant, reintenta con backoff exponencial (1 min, 5 min, 30 min, 2 h, 12 h) y marca `dead` al 6.º intento con notificación al dueño.

**Temporizadores**: al entrar en etapa con `due`, se guarda `stage_due_at`; un `@Cron` cada minuto en el worker busca `status=active AND stage_due_at <= now()` con índice `(store_id, status, stage_due_at)` y encola `tick`. Horario hábil: calendario por tienda (zona horaria de `store_settings`, skill `vendix-date-timezone`). Se prefiere el barrido por cron a los jobs retrasados de BullMQ porque sobrevive a cambios de versión y reinicios sin jobs huérfanos.

**Disparadores por evento**: `WorkflowTriggerListener` con `@OnEvent` sobre la lista blanca de eventos; escribe en outbox (`start_instance`) y sale. Como los eventos son en memoria, el riesgo de pérdida existe (proceso cae entre el commit del dominio y el listener). Mitigación v1: aceptarlo y documentarlo; v2: outbox de dominio para esos 6 eventos.

**Asignador**: `role` → tarea con `assignee_role_id` (cualquiera del rol puede reclamar); `group` + `round_robin` → miembro disponible siguiente según el último asignado del grupo; `least_load` → menor número de tareas `open|claimed`; `user`; `initiator`; `field` (un campo tipo usuario). Si no hay nadie disponible → asignar al rol de escalamiento y evento `unassigned`.

**Concurrencia y rendimiento**: CAS por fila, sin locks largos; tareas indexadas por responsable; tablero con conteo por `GROUP BY current_stage_key` sobre el índice compuesto. Objetivo: 10.000 solicitudes activas por tienda con bandeja < 300 ms.

### 5.5 Permisos

| Permiso | Quién por defecto | Permite |
|---|---|---|
| `store:workflows:read` | owner, admin, manager | Ver flujos, solicitudes, tablero |
| `store:workflows:design` | owner, admin | Crear/editar borradores, publicar, archivar, importar/exportar |
| `store:workflows:start` | todos los roles de staff | Crear solicitudes en flujos habilitados para su rol |
| `store:workflows:task` | todos los roles de staff | Atender tareas asignadas a él, su rol o su grupo |
| `store:workflows:manage` | owner, admin | Forzar transición, reasignar, cancelar |
| `store:work_groups:manage` | owner, admin | Grupos y miembros |
| `store:documents:templates` | owner, admin | Plantillas de documento |
| `store:documents:read` | según flujo | Ver expediente |
| `store:integrations:api_keys` | owner | API keys y webhooks |

Además, cada versión puede restringir **quién inicia** (`start_roles`) y **quién ve** solicitudes (`visibility: participants | stage_roles | all_readers`). Regla: un usuario ve una solicitud si tiene `read` y (participó, o es responsable actual, o la política lo permite).

### 5.6 Acceso por plan

Decisión D1: **no se ata el módulo a un código de plan ni a un feature flag con cupos**. Se construye una **matriz plan → módulos y rutas** en la configuración de planes (superadmin):

- `subscription_plans.route_rules` / tabla `plan_module_rules`: por plan, módulos `exclusive` o `blocked`. Aplica a Flujos, Gestión documental y sirve desde el primer día para bloquear el **módulo fiscal** a los planes menores a Empresarial Pro (ver `odd/tasks/planes-matriz-accesos.md`).
- Backend: se **extiende el gate existente** — `AccessLayer` suma `'plan'` y `canSeeKey` evalúa `planAllows(key)` después de usuario, tienda e industria; el modo `audit|enforce` y el sumidero `ACCESS_AUDIT` ya existen (`FE/core/services/access-gate.service.ts`). Para HTTP, `PlanAccessGuard` global responde `403 PLAN_MODULE_NOT_INCLUDED` con el plan mínimo requerido.
- Mapa ruta→módulo en `libs/shared-types` con copias byte a byte y spec de paridad (mismo patrón que `module-industries.ts`).
- Frontend: la capa de plan alimenta el candado en las cuatro superficies y el paywall («Disponible en IA Business»), en lugar de esconder el módulo.
- `ai_feature_flags` sigue existiendo para lo que sí es de IA (modelos, app_keys, herramientas), pero **no** es la compuerta del módulo ni lleva cuotas de instancias/documentos/OTP.
- Bajar de plan: las solicitudes en curso quedan en solo lectura y exportables; el expediente sigue descargable 90 días. Se documenta en el paywall (decisión de producto ya tomada: sin cupos, D6).

### 5.7 API REST

Prefijo `/api/store/workflows` (JWT) y `/api/v1/workflows` (API key, v1). `ResponseService` estándar.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/definitions` | Lista |
| POST | `/definitions` | Crear borrador (desde cero, plantilla o JSON) |
| GET/PATCH | `/definitions/:id/draft` | Leer/guardar borrador (autosave) |
| POST | `/definitions/:id/validate` | Errores y advertencias del validador |
| POST | `/definitions/:id/simulate` | Ejecuta pasos sobre datos ficticios, sin efectos |
| POST | `/definitions/:id/publish` | Crea versión N+1 |
| GET | `/definitions/:id/versions` | Historial + diff |
| GET | `/definitions/:id/export` | JSON `vendix.workflow/v1` |
| POST | `/definitions/import` | Importa a borrador (valida, remapea roles/grupos) |
| POST | `/instances` | Iniciar solicitud (`Idempotency-Key`) |
| GET | `/instances` | Filtros: flujo, etapa, estado, responsable, vencidas, rango |
| GET | `/instances/:id` | Detalle + línea de tiempo + requisitos pendientes |
| POST | `/tasks/:id/claim` | Tomar tarea de rol/grupo |
| POST | `/tasks/:id/complete` | Atender (`expected_row_version`, `Idempotency-Key`) |
| POST | `/instances/:id/reassign` · `/cancel` · `/force-transition` | Gestión |
| GET | `/inbox` | Mis tareas |
| GET | `/board/:definitionId` | Columnas con conteo y cursor por columna |
| GET | `/analytics/:definitionId` | KPIs; `?format=xlsx` |
| CRUD | `/work-groups` | Grupos |
| GET | `/public/workflows/forms/:token` · POST submit | Formulario público (dominio de tienda) |

**Webhooks salientes** (v1): eventos `workflow.instance.started|transitioned|completed|rejected`, `workflow.task.created|completed|overdue`, `document.issued`, `signature.completed`. Cuerpo con `event_id`, `occurred_at`, `store_id`, `data`; cabecera `X-Vendix-Signature: t=<ts>,v1=<hmac_sha256(secret, ts.body)>`; reintentos según outbox; el receptor deduplica por `event_id`.

### 5.8 Versionado y publicación

- Un borrador por definición (`draft_definition`); autosave cada 3 s con `draft_updated_at` como control de concurrencia ("Otro usuario modificó el borrador").
- Publicar: valida → canonicaliza → hashea → inserta versión N+1 → apunta `published_version_id`. Si el hash coincide con la versión publicada, no crea versión.
- Las solicitudes en curso **siguen en su versión**. v1 incluye "migrar solicitudes a la nueva versión" solo si cada `current_stage_key` existe en la nueva versión (el asistente muestra cuáles no se pueden migrar).
- Archivar: no permite nuevas solicitudes; las vivas terminan.

---

## 6. Editor visual y tablero

### 6.1 Estructura de pantallas (`FE/private/modules/store/workflows/`)

| Pantalla | Ruta | Componentes |
|---|---|---|
| Lista de flujos | `/admin/workflows` | Módulo estándar (`vendix-frontend-standard-module`): stats (flujos activos, solicitudes en curso, vencidas), búsqueda, `ResponsiveDataView` |
| Galería de plantillas | `/admin/workflows/templates` | Tarjetas por industria, filtradas por `store.industries`, botón "Usar" y "Describir con IA" |
| Editor | `/admin/workflows/:id/edit` | Ver §6.2 |
| Mis tareas | `/admin/workflows/inbox` | Lista por vencimiento, filtros, acción rápida aprobar/rechazar |
| Solicitudes | `/admin/workflows/:id/instances` | Tabla + filtros guardados |
| Tablero | `/admin/workflows/:id/board` | Kanban por etapa (CDK DragDrop, como el pipeline de CRM) |
| Detalle | `/admin/workflows/instances/:id` | Cabecera sticky, datos, tarea actual, requisitos pendientes, expediente, línea de tiempo, comentarios |
| Analítica | `/admin/workflows/:id/analytics` | KPIs + gráficas (echarts) + exportar XLSX |
| Grupos | `/admin/workflows/groups` | CRUD de grupos y miembros |

Todo con signals, `input()/output()/model()`, `toSignal` con `initialValue`, sin `ngOnChanges` ni `detectChanges` (skill `vendix-zoneless-signals`); UI "Soft" con un solo acento (memoria `feedback_sober_ui_single_accent`).

### 6.2 Editor (lista + mapa editable, completo desde el inicio)

Diseño en tres paneles:
1. **Izquierda — lista de etapas** ordenable (CDK DragDrop), con icono por tipo (formulario, aprobación, firma, automática, fin) y chip de errores del validador.
2. **Centro — mapa de la ruta**: diagrama de solo lectura generado automáticamente (layout por niveles con SVG propio: etapas en columnas, transiciones como flechas con etiqueta "Aprobar", "Rechazar", "Si monto > 2.000.000"). Se dibuja con un layout simple por BFS desde `start`; sin librería externa. Clic en una flecha o etapa abre su editor.
3. **Derecha — propiedades** de la etapa seleccionada en pestañas: General · Responsable · Formulario · Requisitos (documentos/firmas) · Transiciones · Plazos · Acciones.

Editores específicos:
- **Constructor de condiciones**: filas "Campo · Operador · Valor" con grupos "Todas/Alguna"; los campos vienen del catálogo de variables; vista previa en lenguaje natural ("Si el monto es mayor a $2.000.000").
- **Constructor de formularios**: reutiliza el esquema de campo y el renderizador de `data-collection`; agrega tipos archivo y firma y la regla "mostrar si".
- **Matriz de transiciones** (vista alternativa): filas = etapa origen, columnas = resultado, celdas = destino. Útil para revisar flujos grandes.
- **Barra superior**: estado (Borrador / Publicado v3), "Validar", "Simular", "Publicar", "Exportar JSON", "Historial".
- **Panel de JSON** (avanzado, solo `design`): editor de texto con validación en vivo; los cambios se reflejan en la UI.

v1: el mapa central pasa a ser editable (arrastrar para conectar etapas). Evaluar entonces una librería Angular de grafos frente a SVG propio; no hay ninguna instalada hoy.

### 6.3 Simulación / vista previa

- "Simular" abre un panel lateral: el usuario elige la persona simulada (rol) y llena el formulario de la etapa; el backend (`/simulate`) aplica la misma función pura del motor (validación → requisitos → resolución de transición) sobre un estado en memoria y devuelve la siguiente etapa, las tareas que se crearían, las notificaciones que se enviarían (sin enviarlas) y los documentos que se generarían (render de muestra con marca de agua "SIMULACIÓN").
- La función de resolución es **la misma** que usa el motor real (no una copia), para que la simulación no mienta (memoria `reference_parity_test_between_consumers_of_one_module_is_tautological`: por eso se prueba por los puntos de entrada, no comparando la función consigo misma).
- Vista previa del formulario público tal como lo verá el tercero.

### 6.4 Tablero

- Columnas = etapas de la versión publicada (las solicitudes de versiones anteriores se agrupan por `stage_key` y se marcan "v2").
- Tarjeta: referencia, título, responsable (avatar), tiempo en etapa, semáforo de vencimiento, icono de documento/firma pendiente.
- Arrastrar una tarjeta = atajo de "completar tarea" con el resultado que lleva a esa columna; si hay formulario o requisito, abre el modal en vez de mover. Solo se permite soltar en destinos válidos (columnas inválidas atenuadas).
- Filtros: responsable, grupo, vencidas, rango de fechas, campo (p. ej., monto > X).
- Paginación por columna con cursor (20 por columna).
- Tiempo real: SSE del módulo de notificaciones (`notifications.controller.ts:147`) emitido **desde el servidor** al confirmar una transición (no como en la referencia A, donde el cliente reenvía).

### 6.5 Accesibilidad

- Toda acción de arrastrar tiene alternativa por teclado/menú ("Mover a…").
- Diagrama SVG con `role="img"` y lista textual equivalente; foco visible; contraste AA; etiquetas en todos los campos; estados no comunicados solo por color (semáforo + texto "Vencida hace 3 h").
- Formularios públicos y firma usables en móvil a 360 px.

### 6.6 Analítica (tablero de KPIs)

KPIs por flujo y rango (día de negocio en zona horaria de tienda, skill `vendix-analytics-metrics`):
- Solicitudes iniciadas, completadas, rechazadas, en curso, vencidas.
- Tiempo de ciclo (inicio→fin) promedio y p90.
- Tiempo por etapa promedio y p90; **etapa cuello de botella** = mayor p90 × WIP.
- % de tareas atendidas dentro del plazo por etapa, por grupo y por persona.
- Tasa de rechazo por etapa.

Se calculan desde `workflow_instance_events` (entradas/salidas de etapa) con SQL agregado; caché por tienda 5 min. XLSX con `report-builder` y mismo dataset que la pantalla (skill `vendix-report-xlsx`).

---

## 7. Integración con IA

### 7.1 Qué es determinista y qué es IA

| Función | Determinista | IA | Nota |
|---|---|---|---|
| Validar flujo | ✅ validador §5.3 | Redacta la explicación de los errores | La IA nunca decide si es válido |
| Generar flujo desde descripción | Validación + guardado como borrador | ✅ propone el JSON | Si el JSON no valida, se reintenta 1 vez con los errores; si vuelve a fallar se muestra lo que sí se pudo |
| Sugerir responsables | Lista de roles/grupos reales de la tienda | ✅ elige entre ellos | Prohibido inventar roles: el prompt recibe el catálogo |
| Explicar estado de una solicitud | Línea de tiempo + requisitos pendientes | ✅ resume en lenguaje natural | Cita eventos por fecha |
| Cuellos de botella | ✅ métricas §6.6 | ✅ narrativa y sugerencias | Los números salen del SQL, nunca del modelo |
| Avanzar/aprobar una tarea | ✅ motor | Solo propone | Siempre confirmación humana |
| Extraer datos de documentos | Validación de formato | ✅ visión (`AIEngineService.run`) | §10.7 |
| Generar plantilla de documento | Validación de tokens | ✅ redacta el borrador | Siempre revisión humana |

### 7.2 Herramientas (`BE/src/ai-engine/tools/domains/workflows.tools.ts`)

Registradas con `registerMany` desde `WorkflowsModule.onModuleInit`, todas con `requiredPermissions` y detrás de `canUseAIFeature('workflows')`:

| Herramienta | Tipo | Permiso | Confirmación |
|---|---|---|---|
| `workflows_list` | lectura | `store:workflows:read` | No |
| `workflows_get_definition` | lectura | `read` | No |
| `workflows_validate_definition` | lectura | `design` | No |
| `workflows_draft_from_description` | escritura (borrador) | `design` | **Sí**, preview = lista de etapas, responsables y campos |
| `workflows_update_draft` | escritura (borrador) | `design` | **Sí**, preview = diff (reutiliza `diff-viewer`) |
| `workflows_inbox` | lectura | `task` | No |
| `workflows_explain_instance` | lectura | `read` + visibilidad | No |
| `workflows_find_instances` | lectura | `read` | No |
| `workflows_bottlenecks` | lectura | `read` | No |
| `workflows_complete_task` | escritura | `task` | **Sí**, preview = resultado + destino + efectos; `irreversible: true` si dispara firma o webhook |
| `workflows_start_instance` | escritura | `start` | **Sí** |
| `documents_render_preview` | lectura | `documents:read` | No |

**No** se exponen a la IA: publicar, forzar transición, cancelar, borrar, gestionar API keys o webhooks. Publicar siempre es un clic humano en el editor.

En Vex (`ai_agents.allowed_tools`), estas herramientas se suman al agente de negocio; las de escritura entran al flujo de aprobación de planes (`plan-approval.service.ts`), donde lo irreversible reconfirma.

### 7.3 Playbook y memoria

- Playbook nuevo `BE/src/ai-engine/playbooks/content/disenar-flujo.md`: preguntas mínimas (¿quién inicia?, ¿quién aprueba?, ¿hay montos o condiciones?, ¿qué documentos?, ¿plazos?), luego `workflows_draft_from_description`, luego `workflows_validate_definition`, luego explicar los avisos.
- La galería de plantillas se pasa como ejemplos few-shot (no se inventa la estructura cada vez).
- App de IA `workflow_designer` en la configuración de superadmin (modelo, temperatura, salida JSON estructurada).

### 7.4 Sin cuotas de uso

- Decisión D6: el módulo es **ilimitado** al comprar IA Business. No hay contadores de solicitudes, documentos ni firmas, ni mensajes de "llegaste al límite".
- Las llamadas de IA siguen consumiendo la cuota estándar de la tienda (`consumeSubscriptionQuota` tras éxito), porque eso es costo real de modelo, no un límite comercial del módulo.
- Los costos extra del negocio son implementación avanzada, capacitaciones y consultoría (fuera del producto).

### 7.5 Lo que no prometemos

- La IA no "entiende el negocio" sola: necesita roles y grupos reales configurados; sin ellos, propone y deja advertencias.
- La detección de cuellos de botella necesita ≥ 20 solicitudes completadas para que el p90 signifique algo; antes de eso se muestra "Datos insuficientes".
- La generación de flujos acierta en procesos lineales con 1–2 condiciones; en procesos con muchas reglas propone una base que hay que ajustar. Medir con evals (skill `vendix-agent-evals-observability`): 20 descripciones de prueba, meta ≥ 80 % de borradores válidos a la primera.

---

## 8. Fases y estimación

Semanas-dev = 1 dev senior full-stack. Cada fase cierra con historias de usuario verificadas (curl + Playwright contra el vhost) y commits por unidad.

| Fase | Entregables | Semanas | Depende de | Vendible |
|---|---|---|---|---|
| **F0 · Decisiones y cimientos** | Matriz plan→módulos/rutas (D1) y `PlanAccessGuard`; tipos y validador de `vendix.workflow/v1` en `libs/shared-types`; permisos sembrados; esqueleto de módulo BE/FE con menú y paywall | 2 | — | No |
| **F1 · Datos y motor** | Migración aditiva (§5.2 sin webhooks/API keys); `WorkflowEngineService` (start, completeTask, CAS, idempotencia, eventos); evaluador de condiciones; asignador rol/grupo/usuario/round-robin; outbox + cola `workflows` en worker; tests de aislamiento por tienda y de concurrencia | 4 | F0 | No |
| **F2 · API + editor de etapas** | CRUD definiciones, borrador/publicar/versiones, validar, simular, import/export; editor de 3 paneles con constructor de condiciones y formularios (reuso `data-collection`) y mapa SVG de solo lectura | 4 | F1 | No |
| **F3 · Operación diaria** | Bandeja, lista, detalle con línea de tiempo, tablero kanban, grupos; notificaciones in-app/push/email/WhatsApp; vencimientos, recordatorios y escalamiento por cron; formulario público por enlace; 4 plantillas de galería | 3 | F2 | — |
| **D1–D3** (§10) | Archivos + expediente, plantillas HTML con tokens y render, carga de documento firmado + evidencia | 7,5 | F1 (D1), F2 (D2), F3 (D3) | — |
| **F4 · IA** | Herramientas §7.2, playbook, app `workflow_designer`, evals; "Describir con IA" en galería | 2,5 | F3 | Mejora venta |
| **F5 · Analítica** | KPIs, cuello de botella, XLSX, narrativa IA | 1,5 | F3, F4 | Sí |
| **F6 · Integraciones** | `store_api_keys`, `/api/v1/workflows`, webhooks salientes firmados con reintentos y panel de entregas; disparadores por 6 eventos de negocio; acciones Vendix (OC borrador, tarea CRM) | 2,5 | F3 | Sí |
| **F7 · Galería completa y canvas** | 12 plantillas por industria; mapa editable; migración de solicitudes entre versiones; asignación por menor carga | 2,5 | F2, F3 | — |
| **D4–D5** (§10) | OCR/validación IA, editor visual de plantillas, retención | 5,5 | D2 | — |

**Totales**: Flujos F0–F7 ≈ 21,5 semanas; Gestión documental D1–D5 ≈ 13 semanas; **≈ 34,5 semanas-dev**. Con 2 devs (uno motor/BE, otro FE/documental) y el orquestador, **≈ 4,5–5 meses calendario**. Decisión D3: **se entrega completo de una**, sin corte MVP comercial; los hitos F/D son orden de construcción y puntos de revisión, no versiones vendibles por separado.

**Orden recomendado**: F0 → F1 → (F2 ∥ D1) → (F3 ∥ D2) → D3 → F4 → F5 → F6 → F7 → D4 → D5.

**Qué vender primero**: "Aprobaciones y solicitudes con documentos firmados" (compras, vacaciones/anticipos, contratación, alta de proveedor) con 4 plantillas. Es lo que más rápido demuestra valor y no depende de integraciones.

Volumen estimado de código (para slices de ~400 líneas): BE ≈ 9.000–11.000 líneas (con tests), FE ≈ 8.000–10.000, libs ≈ 800. ≈ 45–55 PRs/commits de unidad.

---

## 9. Riesgos y decisiones abiertas

### 9.1 Técnicos

| # | Riesgo | Prob. | Impacto | Mitigación / recomendación |
|---|---|---|---|---|
| T1 | Modelo nuevo sin registrar en `store_scoped_models` → fuga entre tiendas | Media | Crítico | Test de aislamiento por modelo en F1 (dos tiendas, misma consulta); revisión de alto riesgo (tenant) en cada PR del módulo |
| T2 | Eventos de dominio en memoria se pierden | Baja | Medio | v1 documentado; panel "solicitudes no iniciadas" en v2 con outbox de dominio |
| T3 | Dobles avances por doble clic o dos aprobadores | Media | Alto | CAS `row_version` + `idempotency_key` único + `seq` único (tres candados) |
| T4 | Render Chromium consume RAM en EC2 (ver memoria `project_worker_split_memory_ceiling`) | Alta | Alto | Contenedor separado con límite de memoria y concurrencia 2, cola dedicada, timeout 30 s; alternativa: servicio gestionado. Medir antes de D2 |
| T5 | Cron de vencimientos corriendo en ambos procesos | Media | Medio | Ubicarlo en el worker según `BE/src/main.ts:74-136` + lock Redis por ejecución |
| T6 | JSON de definición crece y el editor se vuelve lento | Baja | Medio | Límites §5.3 regla 8 |
| T7 | Condiciones complejas que el usuario no entiende | Media | Medio | Vista en lenguaje natural + simulación obligatoria antes del primer publish |
| T8 | Heap del backend ya en el límite (memoria `project_backend_heap_floor_27_prisma_clients`) | Media | Medio | El módulo no crea PrismaClient propio; importar `PrismaModule` existente; `npm run prisma-singleton:audit` tras cada `*.module.ts` |

### 9.2 Producto

| # | Decisión | Recomendación |
|---|---|---|
| P1 | ¿Editor de lista o canvas desde el día 1? | **Completo desde el inicio** (D3): lista + matriz de transiciones + mapa editable; el canvas no es lo que vende, pero se entrega para no volver después |
| P2 | ¿Flujos por tienda u organización? | **Por tienda** (D2); compartir por organización queda fuera de alcance |
| P3 | ¿Qué pasa al bajar de plan? | Solo lectura + exportación 90 días; nunca borrar datos |
| P4 | ¿Terceros externos pueden iniciar solicitudes? | Sí, por formulario público con token por flujo, captcha/throttle |
| P5 | ¿Se cobra la firma o el OTP aparte? | No: firma por carga del cliente y sin OTP; el módulo es ilimitado en IA Business |
| P6 | ¿Nombre en código? | `workflows` (evita choque con `module_flows`); "Flujos" en UI |

### 9.3 Negocio y legal

| # | Riesgo | Recomendación |
|---|---|---|
| N1 | Validez de la firma electrónica | Decisión D5: **la firma la aporta el cliente y la responsabilidad es suya**; Vendix es custodio (almacena, versiona, da acceso y prueba integridad). Los términos y la UI deben decirlo («Documento aportado por el cliente»); no anunciar "firma certificada" |
| N2 | Habeas data (Ley 1581/2012) en expedientes con datos personales | Retención configurable, aviso de privacidad en formularios públicos, exportación y eliminación por solicitud del titular |
| N3 | Expectativa "n8n" | El material comercial habla de "procesos administrativos con aprobaciones y documentos", no de "automatiza cualquier cosa" |
| N4 | Adopción baja (nadie configura) | Plantillas por industria + "Describir con IA" + onboarding guiado (skill `vendix-tour`) en el MVP |
| N5 | Coste de 36 semanas-dev frente a otras prioridades | Cortar en F3+D3 y medir uso real (≥ 30 % de tiendas IA Business con un flujo activo a 60 días) antes de F5–F7 y D4–D5 |

---

## 10. Gestión documental

### 10.1 Objetivo y principios

Un solo subsistema, ordenado, para: plantillas con tokens → documentos emitidos → archivos subidos → firmas → expediente. Se usa dentro de Flujos y también fuera (p. ej., un contrato de cliente sin flujo), pero vende con Flujos.

Principios (respuesta directa al desorden observado en ambas referencias):
1. **Un motor de render** para documentos de texto (no dos que diverjan cliente/servidor).
2. **Una sintaxis de tokens** (no tres normalizadas).
3. **Plantillas versionadas e inmutables al publicar**; el documento emitido apunta a la versión exacta y guarda el snapshot de datos.
4. **El hash se calcula sobre el PDF final**, y la firma se liga a ese hash.
5. **Evidencia en tablas propias, append-only**, nunca en el JSON de la solicitud.
6. **Un pipeline de OCR/IA** con interfaz común (ya existe: `AIEngineService.run(appKey)`), resultados con procedencia.

### 10.2 Modelo de datos

```prisma
model stored_files {                     // tabla genérica de archivos
  id               Int      @id @default(autoincrement())
  organization_id  Int
  store_id         Int
  s3_key           String   @unique @db.VarChar(500)   // nunca URL firmada
  original_name    String   @db.VarChar(255)
  mime_type        String   @db.VarChar(120)
  size_bytes       Int
  sha256           String   @db.Char(64)
  source           stored_file_source_enum             // upload | generated | signature_image | public_form
  uploaded_by_type workflow_actor_type_enum
  uploaded_by_id   Int?
  retention_until  DateTime?
  legal_hold       Boolean  @default(false)
  deleted_at       DateTime?                           // borrado lógico; purga física por job respetando retención
  created_at       DateTime @default(now())
  @@index([store_id, sha256])
}

model document_templates {
  id               Int      @id @default(autoincrement())
  organization_id  Int
  store_id         Int
  key              String   @db.VarChar(80)
  name             String   @db.VarChar(160)
  category         String   @db.VarChar(40)   // contract | letter | certificate | form | act | other
  status           workflow_definition_status_enum @default(draft)
  draft_body       Json?                       // { html, css, page, header, footer, signature_slots }
  published_version_id Int? @unique
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt
  @@unique([store_id, key])
}

model document_template_versions {
  id               Int      @id @default(autoincrement())
  store_id         Int
  template_id      Int
  version          Int
  body             Json                        // inmutable
  token_schema     Json                        // tokens requeridos/opcionales con tipo y formato
  body_hash        String   @db.Char(64)
  published_by_user_id Int
  published_at     DateTime @default(now())
  @@unique([template_id, version])
}

model dossiers {                         // expediente
  id               Int      @id @default(autoincrement())
  organization_id  Int
  store_id         Int
  reference        String   @db.VarChar(30)
  title            String   @db.VarChar(200)
  subject_type     String?  @db.VarChar(40)    // customer | employee | supplier | order | none
  subject_id       Int?
  workflow_instance_id Int? @unique
  retention_policy_key String? @db.VarChar(60)
  closed_at        DateTime?
  created_at       DateTime @default(now())
  @@unique([store_id, reference])
  @@index([store_id, subject_type, subject_id])
}

model dossier_items {
  id               Int      @id @default(autoincrement())
  store_id         Int
  dossier_id       Int
  kind             dossier_item_kind_enum      // issued_document | uploaded_file | signed_document | note
  requirement_key  String?  @db.VarChar(80)    // requisito de la etapa que satisface
  stage_key        String?  @db.VarChar(80)
  document_id      Int?
  file_id          Int?
  status           dossier_item_status_enum @default(pending) // pending | received | validated | rejected | expired
  valid_until      DateTime?                   // p. ej. certificado con vigencia
  added_by_type    workflow_actor_type_enum
  added_by_id      Int?
  created_at       DateTime @default(now())
  @@index([dossier_id, requirement_key])
}

model documents {                        // documento emitido
  id               Int      @id @default(autoincrement())
  organization_id  Int
  store_id         Int
  reference        String   @db.VarChar(30)
  template_version_id Int
  dossier_id       Int?
  data_snapshot    Json                        // valores de tokens usados
  data_hash        String   @db.Char(64)
  file_id          Int?                        // PDF renderizado
  pdf_sha256       String?  @db.Char(64)
  status           document_status_enum @default(rendering) // rendering | issued | pending_signature | signed | voided | superseded
  supersedes_id    Int?
  issued_at        DateTime?
  created_at       DateTime @default(now())
  @@unique([store_id, reference])
  @@index([store_id, status])
}

model signature_requests {
  id               Int      @id @default(autoincrement())
  organization_id  Int
  store_id         Int
  document_id      Int
  document_sha256  String   @db.Char(64)       // hash del PDF que se firma (congelado)
  mode             signature_mode_enum          // sequential | parallel
  status           signature_request_status_enum @default(pending) // pending | partially_signed | completed | declined | expired | cancelled
  expires_at       DateTime
  consent_text     String                      // texto exacto mostrado
  consent_text_version String @db.VarChar(20)
  sealed_file_id   Int?                        // PDF final con página de evidencia
  sealed_sha256    String?  @db.Char(64)
  created_at       DateTime @default(now())
  completed_at     DateTime?
  @@index([store_id, status, expires_at])
}

model signature_signers {
  id               Int      @id @default(autoincrement())
  store_id         Int
  request_id       Int
  order            Int      @default(1)
  signer_type      signer_type_enum             // user | customer | external
  user_id          Int?
  name             String   @db.VarChar(160)
  document_number  String?  @db.VarChar(30)
  email            String?  @db.VarChar(160)
  phone            String?  @db.VarChar(30)
  role_label       String?  @db.VarChar(80)     // "Empleador", "Candidato"
  method           signature_method_enum        // in_session | link_otp_email | link_otp_whatsapp | link_otp_sms
  token_hash       String?  @unique @db.Char(64)
  otp_hash         String?  @db.Char(64)
  otp_attempts     Int      @default(0)
  otp_sent_at      DateTime?
  status           signer_status_enum @default(pending) // pending | viewed | signed | declined | expired | blocked
  signed_at        DateTime?
  signature_image_file_id Int?
}

model signature_evidence_events {        // append-only, encadenado
  id               BigInt   @id @default(autoincrement())
  store_id         Int
  request_id       Int
  signer_id        Int?
  seq              Int
  type             String   @db.VarChar(40)  // created | sent | opened | otp_sent | otp_failed | otp_verified | consent_accepted | signed | declined | sealed
  ip_address       String?  @db.VarChar(64)
  user_agent       String?  @db.VarChar(400)
  payload          Json     @default("{}")
  prev_hash        String?  @db.Char(64)
  event_hash       String   @db.Char(64)     // sha256(prev_hash || canonical(evento))
  occurred_at      DateTime @default(now())
  @@unique([request_id, seq])
}

model document_checks {                  // OCR / validación IA con procedencia
  id               Int      @id @default(autoincrement())
  store_id         Int
  file_id          Int
  dossier_item_id  Int?
  check_type       String   @db.VarChar(40)   // extract | compare_with_form | expiry | authenticity_hint
  app_key          String   @db.VarChar(60)
  model            String   @db.VarChar(80)
  prompt_version   String   @db.VarChar(20)
  input_sha256     String   @db.Char(64)
  result           Json                       // campos extraídos + hallazgos con severidad
  verdict          document_check_verdict_enum // pass | warn | fail | needs_review
  reviewed_by_user_id Int?
  reviewed_at      DateTime?
  created_at       DateTime @default(now())
  @@index([store_id, file_id])
}
```

Relación con lo existente: `ai_attachments`, `purchase_order_attachments`, etc. **no se migran** en v1 (cero mutación de datos). `stored_files` es para lo nuevo; un adaptador puede listar adjuntos legados en el expediente en v2.

### 10.3 Tokens

- Sintaxis única: `{{ ruta.al.dato | filtro:arg }}`. Bloques: `{{#if campo}}…{{/if}}`, `{{#each lineas}}…{{/each}}`. Sin expresiones arbitrarias ni código.
- Fuentes (catálogo de variables común con Flujos): `store.*` (razón social, NIT, logo, dirección), `instance.*` (referencia, fechas, etapa), `fields.*` (formularios), `subject.*` (cliente/empleado/proveedor/orden según tipo), `user.*` (quien emite), `now`.
- Filtros cerrados: `money` (usa `CurrencyFormatService`, skill `vendix-currency-formatting`), `date:'largo'` (zona horaria de tienda), `upper`, `number`, `words` (número en letras, útil en contratos), `default:'—'`.
- `token_schema` se extrae al publicar; si un token requerido no se resuelve en la emisión → error claro "Falta el dato 'Salario' para emitir 'Contrato laboral'", nunca un PDF con huecos.
- Motor: Handlebars o equivalente en modo estricto, con helpers registrados y escape HTML por defecto. No existe hoy en `BE/package.json` (dependencia nueva, riesgo de entrega bajo).

### 10.4 Motor de render

- HTML+CSS → PDF con Chromium headless en un servicio aislado (decisión D4). Cola `documents-render`; el backend envía HTML ya resuelto (los datos nunca salen hacia un servicio externo sin tenant).
- Encabezado/pie con logo (ojo memoria `reference_pdfkit_cannot_decode_webp_logo`: Chromium sí decodifica WebP, pero se normaliza el logo a PNG para la página de evidencia y para el resto de PDFs).
- Al terminar: subir a S3 (`s3-path.helper.ts`), calcular `pdf_sha256`, crear `stored_files`, marcar `documents.issued`.
- Documentos fiscales y térmicos **siguen** en `print-formats`/pdfkit; no se mezclan.
- Previsualización: render real con marca de agua "VISTA PREVIA" y datos de ejemplo del `token_schema` (la referencia B solo devolvía JSON).

### 10.5 Editor de plantillas

- Decisión D4: se toma **el concepto del editor interno de la referencia A**, no su módulo avanzado tipo «DocsPlus». Editor propio de Vendix: bloques (títulos, párrafos con tokens insertables, tabla repetible, imagen, salto de página, **casilla de firma**) sobre HTML controlado, panel lateral de tokens con buscador y vista previa lado a lado. WYSIWYG nuevo y acotado a las marcas permitidas (TipTap/ProseMirror), sin HTML libre.
- Plantillas desde un PDF base (subir PDF y ubicar campos y casillas por coordenadas) para formatos oficiales que el cliente ya tiene; generación de plantilla con IA desde una descripción o desde un documento de ejemplo (siempre borrador).
- Casillas de firma (`signature_slots`) declaradas con rol («Empleador», «Candidato»): el PDF muestra la casilla vacía como «Pendiente de firma» hasta que exista el documento firmado (patrón de la referencia A: nunca dibujar un nombre como si fuera firma).

### 10.6 Firma electrónica

Decisión D5: **la firma la aporta el cliente y la responsabilidad es suya**; Vendix no firma ni certifica, solo almacena, versiona, deja el acceso y prueba la integridad.

| Pieza | v1 | Cómo |
|---|---|---|
| Carga de documento ya firmado | ✅ | El cliente sube el PDF firmado (por su propio medio o proveedor); Vendix guarda `file`, `sha256`, firmante declarado, fecha declarada y versiona |
| Acceso del cliente | ✅ | Portal/expediente con descarga y visor; permisos por rol; enlace temporal si se requiere compartir |
| Evidencia e integridad | ✅ | Cadena de eventos (`uploaded`, `viewed`, `replaced`), hash encadenado, sello del servidor; verificación pública por código opcional |
| Aceptación simple en sesión | Opcional | Clic + consentimiento + user/IP/UA, para documentos internos sin peso legal |
| OTP / firma certificada (proveedor) | **Fuera de alcance** | Se puede agregar después si un cliente lo exige; hoy no se construye |

Reglas: el documento firmado se ata a la etapa que lo exige; si se reemplaza, se conserva la versión anterior y se registra quién y cuándo; la etapa no avanza sin el archivo firmado cuando así se declaró. Texto legal: Vendix es custodio, no firmante; se refleja en los términos y en la UI («Documento aportado por el cliente»).

### 10.7 OCR y validación con IA

- Reutiliza `AIEngineService.run(appKey, vars, messages)` y `BE/src/common/ai-scan-jobs/` (asíncrono con sondeo FE ya hecho).
- Nuevos `app_key`: `document_extract_generic` (campos clave de cédula, RUT, certificado bancario, cámara de comercio, factura), `document_compare_form` (compara extracción con el formulario, con normalizadores deterministas de fecha, documento, nombre sin tildes y similitud).
- El RUT reutiliza el escáner existente (`store/settings/rut-scanner.controller.ts`).
- Resultado en `document_checks` con `model`, `prompt_version`, `input_sha256`; si el `input_sha256` y `prompt_version` coinciden con un check previo, no se vuelve a llamar (ahorro de cuota).
- Veredicto `pass | warn | fail | needs_review`. **La IA nunca rechaza sola**: un `fail` pone el ítem en `needs_review` y crea una tarea para el responsable de la etapa, que acepta o rechaza.
- Vigencias: si se extrae fecha de expedición/vencimiento, se llena `dossier_items.valid_until` y un cron avisa 15 días antes.

### 10.8 Cómo se ata a las etapas del flujo

En la versión del flujo, cada etapa declara `requirements[]`:

```jsonc
"requirements": [
  { "key": "rut", "kind": "upload", "label": "RUT actualizado", "accept": ["application/pdf"], "max_age_days": 30, "ai_check": "document_extract_generic" },
  { "key": "contrato", "kind": "issued_document", "template_key": "contrato-laboral", "auto_issue_on_enter": true },
  { "key": "firma_contrato", "kind": "signature", "of": "contrato", "upload_required": true, "accept": ["application/pdf"], "blocks_exit": true }
]
```

- **Documento requerido por etapa**: `upload` o `issued_document`; aparece como lista de verificación en la tarea.
- **Firma como requisito**: `blocks_exit: true` → el motor responde `409 WORKFLOW_REQUIREMENT_PENDING` hasta `signature_requests.completed`; al completarse, el sellado emite `signature.completed`, que hace `tick` de la solicitud y, si la etapa es automática, avanza sola.
- **Expediente**: cada solicitud tiene un `dossier` creado al iniciar; los ítems llevan `requirement_key` y `stage_key`.
- **Versionado**: reemitir un documento crea uno nuevo con `supersedes_id`; el anterior pasa a `superseded`; si estaba firmado, la nueva emisión exige nueva firma.
- **Retención**: políticas por categoría (p. ej., laboral 3 años tras cierre, comercial 10 años, según el Código de Comercio art. 60 para libros y papeles del comerciante — confirmar con contador/abogado); job mensual que purga lo vencido sin `legal_hold`, dejando evento de auditoría.

### 10.9 Permisos y auditoría

- Permisos de §5.5 (`documents:templates`, `documents:read`) + visibilidad heredada de la solicitud.
- Descarga siempre por URL firmada de vida corta; cada descarga de documento firmado se registra en `audit_logs` (`AuditService`).
- Anulación (`voided`) requiere motivo y queda en la cadena de evidencia.

### 10.10 Fases de Gestión documental

| Fase | Entregables | Semanas |
|---|---|---|
| **D1 · Archivos y expediente** | `stored_files`, `dossiers`, `dossier_items`; subida segura (tipos, tamaño, hash, antivirus opcional), expediente en detalle de solicitud, requisito `upload` en etapas | 2 |
| **D2 · Plantillas y render** | `document_templates` + versiones, tokens y filtros, editor por bloques, servicio Chromium + cola, vista previa real, requisito `issued_document` | 4 |
| **D3 · Documento firmado por el cliente** | Carga del PDF firmado, hash, versiones, evidencia, visor y acceso por rol, requisito `signature` sin OTP, verificación pública por código | 1,5 |
| **D4 · OCR / validación IA** | `document_checks`, 2 `app_key`, revisión humana, vigencias | 2,5 |
| **D5 · Editor avanzado y retención** | Plantillas desde PDF base con coordenadas, generación IA de plantillas, políticas de retención y purga | 3 |
| **Total** | | **14,5** |

---

## 11. Anexo de evidencia

### 11.1 Vendix (verificado por exploración y muestreo directo)

| Hallazgo | Ruta:línea |
|---|---|
| 395 modelos, 622 entradas de migraciones | `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations` (conteo 2026-11-03) |
| Modelo de plan con `feature_matrix`, `ai_feature_flags`, `is_ai_plan` | `schema.prisma:12098` |
| `AIFeatureKey` de 8 valores | `BE/src/domains/store/subscriptions/types/access.types.ts:8-16` (verificado) |
| `@RequireAIFeature` / `AiAccessGuard` | `BE/src/domains/store/subscriptions/guards/ai-access.guard.ts:21,49-53,82` |
| Uso en Vex | `BE/src/domains/store/vex/vex.controller.ts:554,599-620` |
| Resolver Redis de features | `BE/src/domains/store/subscriptions/services/subscription-resolver.service.ts:13,~363` |
| Cuotas Redis | `BE/src/domains/store/subscriptions/services/subscription-access.service.ts:44,154,254-276` |
| Seeds de planes sin IA Business | `BE/prisma/seeds/subscription-plans-production.seed.ts:57,115,176` |
| IA Business en comercial y landing | `skills/vendix-propuesta-comercial/references/planes.md:12,23` (verificado); `FE/public/landing/vendix-landing/vendix-landing.component.ts:219,979` |
| Scopes Prisma | `BE/src/prisma/services/store-prisma.service.ts:11,254,746`; `organization-prisma.service.ts:26` |
| Contexto ALS | `BE/src/common/context/request-context.service.ts:13-34,36,43,60` |
| Resolución de dominio | `BE/src/domains/public/domains/public-domains.controller.ts:48-55`; `FE/core/services/app-config.service.ts:339` |
| Guards globales | `BE/src/app.module.ts:152,192-217` |
| Usuarios/roles/permisos | `schema.prisma:10,336,369,428,443,469` (verificado) |
| `PermissionsGuard`, decorador | `BE/src/domains/auth/guards/permissions.guard.ts:14`; `.../decorators/permissions.decorator.ts:4-6` |
| `syncRolePermissions` | `BE/prisma/seeds/shared/sync-role-permissions.ts:58` |
| Sin equipos/grupos; `employees.department` texto | `schema.prisma:8278` |
| `store_apps` y catálogo de apps | `schema.prisma:1238` (presente en `origin/develop`); `BE/src/domains/store/apps/apps.catalog.ts`; `apps.controller.ts:13`; `default-store-settings.ts:635` |
| Filtro de menú | `FE/core/services/menu-filter.service.ts:80`; `FE/core/guards/panel-ui.guard.ts` |
| `api_keys` sin tenant y sin uso | `schema.prisma:3635` |
| MCP | `BE/src/domains/store/mcp/mcp.controller.ts`, `mcp-auth.service.ts` |
| Auditoría | `schema.prisma:552`; `BE/src/common/audit/audit.service.ts:78` |
| BullMQ y cron | `BE/src/common/queue/queue.module.ts:8`; `BE/src/jobs/jobs.module.ts:70`; `BE/src/main.ts:74-136` |
| Notificaciones | `schema.prisma:5098`; `BE/src/domains/store/notifications/notifications.controller.ts:147` |
| Email/WhatsApp/SMS | `BE/src/email/email.service.ts:62`; `BE/src/messaging/providers/meta-cloud.provider.ts:~106`; `sns-sms.provider.ts`; `messaging/spend/sms-spend.service.ts` |
| Registro de herramientas IA | `BE/src/ai-engine/tools/ai-tool-registry.ts:20-30,58,73`; `tools/interfaces/tool.interface.ts:81,108,109,120,171,190` |
| Confirmación | `BE/src/domains/store/vexi/vexi-confirmation.service.ts:101` |
| Vex | `schema.prisma:6808` (`ai_agents`); `BE/src/domains/store/vex/services/plan-approval.service.ts:~126,201` |
| Tareas durables / recetas | `schema.prisma:7075`; `BE/src/ai-engine/tasks/`, `BE/src/ai-engine/memory/` |
| Playbooks (22) | `BE/src/ai-engine/playbooks/content/*.md` |
| PDF | `BE/package.json:103-104`; `BE/src/common/pdf/pdfkit.ts`; `BE/src/domains/store/print-formats/services/*` |
| Plantillas de impresión | `schema.prisma:11843` (`print_templates`) |
| Plantillas email y legales | `schema.prisma:11796,6487,6521` |
| Archivos por módulo | `schema.prisma:7021` (`ai_attachments`) y tablas de adjuntos por dominio |
| S3 | `BE/src/common/services/s3.service.ts`; `common/helpers/s3-path.helper.ts`; `common/decorators/is-safe-s3-key.decorator.ts` |
| Propuestas con hash y decisiones con prueba | `schema.prisma:14513,14543` |
| Formularios dinámicos | `schema.prisma:11456,11509,11580,11613`; `BE/src/domains/store/data-collection/` |
| Máquinas de estado ad hoc | `fiscal-obligation.service.ts:72`; `journal-entry-flow.service.ts:9`; `hospitality/reservations/reservation-status.ts:9,28` |
| OCR por `app_key` | `BE/src/domains/received-documents/services/received-document-scan.service.ts:14,51`; `BE/src/common/ai-scan-jobs/` |
| Analítica | `BE/src/domains/store/analytics/analytics-metrics.contract.ts`; `BE/src/common/reports/report-builder.ts` |
| Kanban existente | `FE/private/modules/store/customers/crm/pipeline/pipeline.component.ts` |
| Industrias | `schema.prisma:5589` |

**No verificado**: el `code` real del plan IA Business en producción; los valores de `field_type_enum`; plantillas de WhatsApp aprobadas en Meta; si `dispatch_route_stops` guarda foto de entrega; el uso de `canUseFeature` en FE más allá de los patrones buscados. Las líneas de `schema.prisma` no listadas como "verificado" provienen del explorador y pueden diferir en ±100.

### 11.2 Referencia A (solo patrones)

- Definición sin versiones; "operativo" como única noción de borrador.
- Autoridad de transición con lock de fila, estado esperado, condición que falla cerrado, acceso al destino e historial en la misma transacción; actor desde sesión.
- Auto-avance de ~3.800 líneas con manejadores por tipo y clonación de instancias por rama; controladores de 5.000–30.000 líneas.
- Dos sistemas de condiciones, cuatro formatos aceptados; reglas del dominio clínico dentro del motor.
- Diseñador de secuencias anidadas (árbol) aplanado a filas; export parcial (sin ramas, formularios ni documentos).
- Kanban con drag nativo, paginado por columna; servicio de métricas sin uso.
- Plantillas PDF con tres sintaxis normalizadas; motor servidor que re-implementa el formato del diseñador además del render en cliente.
- Firma: hash sobre JSON canónico, recibo de vida corta con anti-repetición, enlace remoto con token hasheado, TTL 10 min, intentos, dispositivo, geolocalización, OTP/TOTP/WebAuthn; evidencia dispersa en el contexto; PDF no hasheado.
- Tres caminos de OCR sin interfaz común.

### 11.3 Referencia B (solo patrones)

- Mismo flujo en tres representaciones, dos endpoints de guardado, dos sincronizadores; tabla de estado de instancia muerta.
- Transición por prioridad (condiciones dinámicas → siguiente declarada → legado); condiciones como árbol; resultados de tarea avanzar/rechazar/finalizar.
- Asignación por menor carga dentro del grupo de la etapa, transaccional, con reasignación auditada.
- Catálogo unificado de variables compartido entre condiciones y plantillas; linter estructural por flujo.
- Diseñador secuencial con ~35 editores y ~8.000 líneas de extensiones; validador permisivo; sin simulación.
- Plantillas PDF sin versión; preview que no renderiza; contrato fijo tapando con rectángulos; "cola" de PDF ejecutada en la petición de sondeo.
- Firma exprés con token hasheado en caché (TTL 30 min, lock, idempotente) sin OTP, sin hash del documento, sin evidencia persistente.
- Validación IA de documentos: extracción + comparación tipada + validación cruzada + reglas; resultado grueso sin procedencia; tres proveedores; proceso desacoplado en vez de cola.

---

## Specs

> Requisitos de la futura implementación, tomados del pedido de Rafael (L1). Las cadenas entre comillas son textuales del pedido.

- **S1** — Módulo "Flujos / Flows": "flujos de trabajo configurables parecidos a n8n, orientados a gestión administrativa empresarial", que permitan "gestionar y administrar cualquier flujo de trabajo administrativo completo" con "etapas del proceso, roles y grupos de trabajo que atienden cada etapa, formularios, condiciones, aprobaciones, notificaciones, tablero de seguimiento, vista previa, configuración por JSON y por API, y diseño/asistencia con inteligencia artificial". → §4, §5, §6.
- **S2** — "Exclusivo del plan más alto, IA Business (los demás planes no lo ven ni lo usan)". → §5.6, D1.
- **S3** — "Debe integrarse con la IA que ya tiene Vendix (AI tools, Vexi, Vex), no ser un módulo aislado". → §7.
- **S4** — "Módulo estrella del plan IA Business: argumento de venta". → §4.7.
- **S5** — "Sin copiar, clonar ni plagiar" las referencias; patrones propios adaptados a "multi-app por empresa, multi-tienda, scoping por tenant, industrias". → §3, §5.1.
- **S6** — Documentación: "plantillas de documentos con tokens/placeholders (editor PDF avanzado para personalizar y tokenizar), carga de archivos/documentos, y firmas electrónicas", "ordenado y unificado", con "documento requerido por etapa, firma como requisito para aprobar/cerrar una etapa, expediente por cliente/proceso, versionado, retención". → §10.
- **S7** — Multi-tenant: todo modelo nuevo con scope de tienda y prueba de aislamiento. → §5.1, T1.
- **S8** — Toda transición idempotente y a prueba de concurrencia. → §5.4.

## Tasks

| ID | S# | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T0 | S1–S8 | inline (este documento) | ✅ análisis entregado | este archivo |
| T1 | S2 | inline | ⏳ requiere D1–D6 | — |
| T2 | S1, S7, S8 | F1 — delegado si se paraleliza con D1 | pendiente | — |
| T3 | S1 | F2 | pendiente | — |
| T4 | S1, S6 | F3 + D1 | pendiente | — |
| T5 | S6 | D2 | pendiente | — |
| T6 | S6 | D3 (alto riesgo: firma/seguridad → verificador independiente) | pendiente | — |
| T7 | S3 | F4 | pendiente | — |
| T8 | S1 | F5, F6, F7 | pendiente | — |
| T9 | S6 | D4, D5 | pendiente | — |

## Log

- **L1 (2026-11-03, pedido de Rafael, extracto textual)**: "Vendix (Quickss S.A.S.) quiere un módulo nuevo llamado Flujos / Flows: flujos de trabajo configurables parecidos a n8n, orientados a gestión administrativa empresarial. Debe permitir a una empresa gestionar y administrar cualquier flujo de trabajo administrativo completo, con alta adaptabilidad: etapas del proceso, roles y grupos de trabajo que atienden cada etapa, formularios, condiciones, aprobaciones, notificaciones, tablero de seguimiento, vista previa, configuración por JSON y por API, y diseño/asistencia con inteligencia artificial." Requisitos duros: "Exclusivo del plan más alto, IA Business", "Debe integrarse con la IA que ya tiene Vendix (AI tools, Vexi, Vex)", "módulo estrella", "Sin copiar, clonar ni plagiar". Audio 20:35: "Además de los flujos, el módulo debe cubrir documentación: plantillas de documentos con tokens/placeholders (editor PDF avanzado para personalizar y tokenizar), carga de archivos/documentos, y firmas electrónicas." Entregable: este documento + `REPORTE.md`; solo lectura en todo lo demás.
- **L2 (2026-11-03)**: exploración con 4 lectores en paralelo (Vendix gating/tenant/roles/API; Vendix IA/documentos/formularios; referencia A; referencia B) y muestreo directo de `access.types.ts`, `schema.prisma` y `planes.md`. Hallazgos que cambian supuestos del pedido: WhatsApp **no** es stub (`meta-cloud.provider.ts`); IA Business no existe en seeds; `store_apps` ya está en `develop`; `api_keys` no tiene tenant ni uso.
- **L3**: decisiones D1–D6 tomadas por Rafael el 4 nov (§1.4). Siguiente paso: aprobar el arranque de la implementación, abrir rama desde `origin/develop` y convertir §8 en tareas de implementación (F0 primero: matriz plan→rutas).
