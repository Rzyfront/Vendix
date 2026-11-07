# REPORTE — Flujos + Documentación (industria `administration`)

Rama `feat/flujos-documental` sobre `origin/develop` `ed3f227de`. Diseño: `odd/tasks/flujos-ai-business.md`. Seguimiento: `odd/tasks/flujos-documental.md` (es local; `odd/` está excluido por `.git/info/exclude`).

## Cambio de criterio

El módulo **no se ata a IA Business**. Lo habilita la industria nueva **`administration`** (`industry_enum`). Los planes se diferencian solo por la IA y su consumo de tokens. Las herramientas de IA de Flujos consumen la cuota estándar de la tienda, como cualquier otra herramienta, y no tienen compuerta de plan.

Pendiente de decisión de Rafael: la matriz de planes no se tocó, como pedía el brief, pero ya traía `flows` y `documents` como `exclusive` de `ia-business%`:
- en `plan-modules.ts`, `IA_BUSINESS_MODULE_KEYS`;
- en la migración `20261110090000_plan_module_rules`.

La capa de plan del backend no evalúa `/api/store/workflows`, porque no se agregaron rutas a `PLAN_MODULE_API_ROUTES`. Pero si la capa de plan del frontend pasa a `enforce`, el menú mostrará un candado de plan a las tiendas `administration` sin IA Business. Para desatarlo del todo hay dos caminos:
- quitar esas dos reglas desde Superadmin → Planes;
- autorizar una migración de datos.

## Estado por bloque

| Bloque | Estado | Commits |
|---|---|---|
| 1 Industria y compuerta | ✅ cerrado | `171e187fe` |
| 2 Contrato `vendix.workflow/v1` | ✅ cerrado | `050e0ba46`, `58bc37287` |
| 3 Datos y motor | ✅ cerrado, verificado en vivo | `47888df50`, `af25d6434` |
| 4 API mínima | ✅ cerrado, verificado en vivo | `940439b45`, `8ac45b035` |
| 5 Documental D1 | ✅ cerrado, verificado en vivo | `a696848ca` |
| 6 UI mínima | ✅ cerrado (AOT; sin vhost, ver Riesgos) | `3c4ca6b4e` |
| 7 Editor de etapas | ✅ cerrado | `3b1bf9bde`, `575b94a4f` |
| 8 Operación diaria | ✅ cerrado, backend verificado en vivo | `4002a6280`, `bb4d1621b` |
| 9 Plantillas y render | ⛔ bloqueado (infraestructura) | ver `BLOQUEO.md` |
| 10 Documento firmado | ⛔ bloqueado (depende del 9) | ver `BLOQUEO.md` |
| 11 IA sobre flujos | ✅ cerrado | `bafad6581` |
| 12 Analítica | ✅ cerrado | `08ffe2fb7` |
| 13 Integraciones | ✅ cerrado, backend verificado en vivo | `3b1fcf707`, `e7163e58e`, `ec4547bbf` |
| 14 OCR, editor avanzado, retención | ◐ parcial: `discard` respeta `legal_hold` y la retención. OCR, purga y plantillas desde PDF base están pendientes de la decisión de Rafael | `5b600f4bf`, ver `BLOQUEO.md` |

## Qué se construyó (historias de usuario)

**H1. Diseñar un flujo.** Como dueño en el panel de mi tienda con industria Administración (`/admin/workflows`), quiero crear un flujo con etapas, responsables, formularios, condiciones y plazos, para que mi equipo siga siempre el mismo proceso.
- Pasos: Flujos → "Nuevo desde JSON" o "Editar" → etapas a la izquierda, mapa al centro, propiedades por pestañas → "Simular" → "Publicar".
- Se ve:
  - el estado *Borrador*, *Publicado vN* o *Cambios sin publicar*;
  - los errores del validador nombrando la etapa, por ejemplo `La etapa "Aprobación jefe" no tiene responsable.`;
  - al publicar, "Versión N publicada", y al republicar sin cambios, "Sin cambios".

**H2. Atender mi bandeja.** Como colaborador, quiero ver mis tareas con su vencimiento y resolverlas desde la bandeja o el detalle, para atenderlas a tiempo.
- Pasos: Flujos → "Mis tareas" → Aprobar o Rechazar con comentario, o "Abrir" para llenar el formulario.
- Se ve: la tarea desaparece. Si otra persona se adelantó, aparece "Esta solicitud cambió; recarga." y nunca hay un doble avance (verificado con dos aprobaciones simultáneas).

**H3. Seguimiento.** Como dueño, quiero un tablero por etapa y la analítica del flujo, para ver dónde se atasca.
- Tablero (`/admin/workflows/:id/board`): solo deja soltar en destinos válidos y ofrece "Mover a…" desde el teclado.
- Analítica (`/:id/analytics`): KPIs, promedio y p90 por etapa, cuello de botella señalado también en texto, y XLSX con el mismo dataset.

**H4. Documento por etapa.** Como responsable, quiero que la etapa exija un archivo, para no avanzar sin soporte.
- Se ve: "Falta: Soporte de compra". Al subir el archivo, el expediente muestra nombre, fecha, sha256 y el reemplazo encadenado.
- Un PNG renombrado a PDF se rechaza.

**H5. IA.** Como dueño, quiero describir el proceso y recibir un borrador, para no empezar de cero.
- Vex/Vexi usan `workflows_draft_from_description`: valida, muestra la propuesta y crea el borrador solo al confirmar. **Nunca publica.**
- También explican una solicitud y detectan cuellos de botella con números calculados por SQL.

**H6. Terceros.** Como cliente externo, quiero llenar un formulario público por enlace, para radicar una solicitud.
- Página `/flujos/<token>`: token guardado solo como hash, throttle, aviso de privacidad, y la tienda se resuelve por dominio.

**H7. Integración.** Como integrador, quiero una API con API key y webhooks firmados, para conectar mis sistemas.
- Panel `/admin/workflows/integrations`.

Piezas técnicas:
- Contrato puro compartido en tres copias byte a byte con spec de paridad. El simulador usa las mismas funciones que el motor.
- Motor con CAS por `row_version`, idempotencia por actor, eventos con `seq`, outbox con `FOR UPDATE SKIP LOCKED` y backoff.
- Quórum N de M, asignación round-robin y por menor carga, vencimientos con recordatorio y escalamiento por cron en el worker.
- Disparadores por 6 eventos de negocio: `order.created`, `order.paid` (reemplaza a `invoice.accepted`, que no lleva tienda), `purchase_order.received`, `expense.approved`, `customer.created`, `pqr.created`.
- Acciones Vendix: orden de compra en borrador y tarea CRM, con los permisos reales de quien publicó.

## Migraciones (todas aditivas e idempotentes, sin mutación de filas)

- `20261113090000_industry_administration`: `ALTER TYPE industry_enum ADD VALUE IF NOT EXISTS 'administration'`.
- `20261113100000_workflows_core`: definiciones, versiones, grupos y miembros, solicitudes, tareas, votos, eventos y outbox. Además, `notification_type_enum` suma `workflow_task`.
- `20261113110000_documents_core`: `stored_files`, `dossiers` y `dossier_items`.
- `20261113120000_workflows_operation`: comentarios y enlaces públicos (incluye un índice parcial que solo existe en SQL; ver el comentario en `schema.prisma`).
- `20261113130000_store_api_keys`.
- `20261113140000_workflow_webhooks`.

Dry-run: las seis migraciones se aplicaron con `prisma migrate deploy` sobre una copia completa de la base de desarrollo (`vendix_flujos`, con datos). Re-ejecutadas con `psql -v ON_ERROR_STOP=1`, solo dieron avisos de "already exists, skipping". `prisma migrate diff` no mostró drift en las tablas nuevas.

Los permisos nuevos se agregan por seed, como en los módulos recientes:
- `store:workflows:read|design|start|task|manage`;
- `store:work_groups:manage`;
- `store:documents:read`;
- `store:integrations:api_keys`.

Se probó el seed real contra la copia. En producción entran cuando corran los seeds del deploy.

## Pruebas

- **Backend, ~850 tests en ~45 specs**, cada uno corrido aparte con `--runInBand` (config `isolatedModules`, memoria `jest-typecheck-oom`). Cubren:
  - aislamiento por tienda de los 17 modelos nuevos;
  - concurrencia e idempotencia;
  - transición inválida, requisito pendiente y quórum;
  - outbox y timers;
  - SSRF;
  - firma HMAC;
  - API keys (401 uniforme, scopes);
  - formulario público;
  - validador y paridad del contrato.
- **Typecheck completo del backend** (`tsc -p apps/backend/tsconfig.build.json --noEmit`): limpio.
- **Frontend**:
  - `ngc -p tsconfig.buildcheck.json` (AOT con `strictTemplates`): 0 errores y 0 avisos en archivos nuevos;
  - `tsc -p tsconfig.app.json`: limpio;
  - `zoneless:audit`: sin hallazgos en archivos nuevos (el script falla por conteos preexistentes del repo).
- **Verificación en vivo**: el backend del worktree corrió contra la copia `vendix_flujos` con un Redis desechable, por curl. Se comprobó:
  - 403 de industria;
  - publicar y republicar;
  - idempotencia;
  - S3 real con sha256 idéntico al descargar;
  - requisito pendiente;
  - **dos aprobaciones simultáneas: una `WORKFLOW_STALE` y un solo avance**;
  - aislamiento entre dos tiendas `administration`;
  - outbox y etapa automática;
  - formulario público: aislamiento por tienda, hash y throttle 429;
  - bandeja y tablero;
  - API keys: scopes, 401 uniforme, revocación, sin mezcla JWT/API key;
  - SSRF: 8 URLs bloqueadas;
  - entrega real de un webhook con reintento registrado.
- **Verificador independiente** sobre el alto riesgo: encontró un bloqueante (replay de idempotencia con la clave de otro usuario) y 12 advertencias. El bloqueante y las advertencias 1, 2, 3, 5 y 6 quedaron corregidos en `af25d6434`, y el bloqueante se re-verificó en vivo.

## Qué queda

1. **Bloques 9 y 10**: decisión de infraestructura para el render HTML→PDF (`BLOQUEO.md`, opciones A, B y C).
2. **Bloque 14** (parcial): ya está la protección de `legal_hold` y de la retención al borrar archivos. Quedan para el siguiente PR, a la espera de que Rafael lo decida (`BLOQUEO.md`): OCR con procedencia, el job de purga y las plantillas desde PDF base (dependen del 9).
6. **Hallazgos de la revisión fuera de la ronda 2** (aceptados por el revisor para un PR posterior): M4 (trigger append-only de la evidencia), M5 (concurrencia contra Postgres real), M6 (specs de componentes y QA en navegador) y los bajos B1–B10.
3. **Matriz de planes**: quitar `flows` y `documents` de `exclusive ia-business%` (ver arriba).
4. **Herramientas IA no incluidas por estar fuera del bloque 11**: `workflows_update_draft`, `workflows_complete_task`, `workflows_start_instance` (§7.2 del diseño).
5. **Galería de plantillas por industria y migración de solicitudes entre versiones** (F7 del diseño, no estaba en los 14 bloques).

## Ronda 2 de correcciones (revisión del PR #1099: 84/100)

La revisión independiente pedía ≥ 89. Se cerró lo siguiente, cada punto con su spec. Todos los specs nuevos fallaron (RED) contra el código anterior.

| # | Historia de usuario | Qué ve la persona | Commit |
|---|---|---|---|
| A1 | Como dueño de una tienda que deja de ser Administración, quiero que mis API keys dejen de operar Flujos, para que el módulo quede cerrado también por API. | Con una key válida, `GET`/`POST /api/v1/workflows/*` responden 403 `MODULE_INDUSTRY_001`. En una tienda `administration` todo sigue respondiendo 200/201. | `b0bc47670` |
| M1 | Como operador, quiero que una tarea en segundo plano que tumba al worker se marque como muerta, para que no se reintente para siempre. | La fila abandonada en `processing` con 6 intentos pasa a `dead`, conserva su `last_error` y no se vuelve a tomar. Si era una acción, el historial muestra `action_failed`. | `3b372bcb2`, `5061f527a` |
| M2 | Como responsable de una tarea vencida, quiero recibir mi recordatorio aunque haya cientos de solicitudes vencidas sin aviso configurado, para no perder el plazo. | Con 205 solicitudes vencidas sin `on_overdue`, la siguiente con recordatorio lo recibe al minuto siguiente. | `9d200f217` |
| A2 (parcial) | Como responsable legal, quiero que un archivo bajo `legal_hold` o con retención vigente no se pueda borrar, para conservar la evidencia. | El borrado responde 409 `DOCUMENT_RETAINED`, y la fila y el objeto en S3 siguen ahí. Con la retención vencida y sin hold, sí se borra. | `5b600f4bf` |
| M3 | Como equipo, queremos que una copia desalineada del contrato rompa el CI aunque el PR solo toque el frontend. | En GitHub aparece el job **Backend Guard Specs**, que corre el spec de paridad en todo PR que toque backend, frontend o `libs`. | `d67b2d7eb` |

Notas técnicas:

- **A1:** `@UseGuards(IndustryModuleGuard)` + `@IndustryModule('flows')`, colocados para que el guard corra después de `ApiKeyGuard` (necesita `req.user`). El spec usa el guard real dentro de la cadena.
- **M1:** antes del reclamo, las filas `processing` abandonadas con `attempts >= OUTBOX_MAX_ATTEMPTS` pasan a `dead` por CAS fila a fila. Además, el `WHERE` del reclamo exige `attempts < OUTBOX_MAX_ATTEMPTS`.
- **M2:** el tick sella `stage_last_reminded_at` por CAS, en su misma transacción, cuando no hay acción posible: sin `on_overdue`, sin tareas abiertas, o ya escalada y sin recordatorios.
  - Residual conocido: si hay un recordatorio configurado que aún no toca, no se sella, para no correr su cadencia. Esa instancia vuelve al lote cada minuto desde la hora del último aviso hasta el siguiente.
  - Corregirlo de verdad pide una columna `next_reminder_at` (cambio de esquema). Queda fuera de esta ronda.
- **A2:** la protección va en el predicado del `DELETE`, así que un hold puesto en paralelo gana.
- **M3:** se eligió la lista fija de guardia en CI y no importar desde `libs` por `paths`. Importar por `paths` cambia el build de Nest, el del frontend y el Dockerfile, con más riesgo. Se comprobó en local que el spec falla si se altera un byte de la copia del frontend.
  - Si el job debe ser obligatorio para mergear, hay que añadirlo a la protección de rama. No se tocó.
- **Typecheck:** el typecheck completo del backend (`tsc -p tsconfig.check.json`) se quedó sin memoria en esta Mac (5 GB de heap). Se tipó en su lugar la lista de archivos cambiados con el mismo `tsconfig`: limpio. El CI corre el completo.

## Riesgos

- **UI sin prueba en el vhost.** El `:4200` lo ocupa otra sesión y el API del vhost apunta al backend de la copia principal. Las pantallas están verificadas solo por compilación AOT y revisión. **QA manual pendiente** con los pasos de H1 a H7 en una tienda con industria Administración.
- **Specs de frontend sin correr** (`ng test` está prohibido en esta máquina). Se actualizaron `menu-filter.service.spec.ts`, `route-gate-coverage.spec.ts` y `module-industries.spec.ts`; CI debe correrlos.
- **Eventos de negocio en memoria.** Si el proceso cae entre el commit del dominio y el listener, la solicitud no se inicia (T2 del diseño, documentado en el listener).
- **Webhooks.** Queda el riesgo SSRF residual frente a un host público que sirva al propio receptor. Se recomienda filtrado de egress en la red.
- **Seeds de permisos.** Las tiendas existentes reciben los permisos cuando corran los seeds del deploy.
- **FKs a `users` con `ON DELETE RESTRICT`.** El borrado duro de un usuario que diseñó flujos o creó API keys fallará. El borrado de usuarios en Vendix es lógico.
- **Fallo preexistente, ajeno a este cambio**: `default-panel-ui.service.spec.ts` reclama que `orders_scheduled` no tiene default.

Risk: items 1 (migraciones), 2 (permisos, API keys, formulario público, aislamiento por tienda), 4 (concurrencia del motor) y 5 (seeds de permisos en el deploy).

## Limpieza y artefactos externos

- Se eliminaron la copia scratch `vendix_flujos`, el Redis desechable y los temporales de `/tmp/flujos-scratch`. Solo queda `extra/`, el `@aws-sdk/client-sns` que usa el `node_modules` de este worktree.
- La verificación en vivo subió **un objeto de prueba** de 45 bytes al bucket S3 configurado en el `.env` de desarrollo. No se borró porque es una operación remota en un bucket compartido. Clave: `organizations/tech-solutions-2/stores/tech-bogota-3/workflows/1/7bfb48de-a441-4d0b-b40d-1239aad5535b.pdf`.
- Gate `pr-code-review`: 78/100 en la primera ronda y **89/100 (APPROVE)** tras la ronda 1 (`2ae41473c`). La revisión independiente posterior dio **84/100 (REQUEST CHANGES)**. La ronda 2 cierra A1, M1, M2, A2 (parcial) y M3, y queda a la espera de una nueva revisión.
