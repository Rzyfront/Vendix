# Flujos + Documentación — implementación (industria `administration`)

Objetivo: implementar el diseño de `odd/tasks/flujos-ai-business.md` (esquema §5.2/§10.2, contrato §5.3, motor §5.4, API §5.7, editor §6, documental §10) atado a la industria nueva `administration`, no a IA Business. Rama `feat/flujos-documental` desde `origin/develop` `ed3f227de`.
Entrega: un PR a develop (pedido explícito del brief), commits por bloque. Runner backend: `npx jest --runInBand --config <scratch isolatedModules> <spec>` desde `apps/backend` (un spec por invocación, memoria `jest-typecheck-oom`). Frontend: specs puntuales con Vitest/Karma no se corren (prohibido `ng test`); verificación por compilación acotada y revisión.

## Specs

- **S1 — Bloque 1, industria y compuerta.** "Nueva industria `administration` en `industry_enum` (migración aditiva) y en `MODULE_INDUSTRY_VALUES`." "`MODULE_INDUSTRIES`: `flows` y `documents` = `['administration']`. Copias byte a byte en backend/frontend + spec de paridad." "En el catálogo de módulos (`store-module-catalog.constant.ts`), claves `flows` y `documents` con sus rutas." "No tocar la matriz de planes: el módulo se habilita por industria; el plan solo cambia cupos de IA."
  - Criterio: una tienda con industria `administration` ve "Flujos" y "Documentos"; una sin ella recibe `403 MODULE_INDUSTRY_001` en `/api/store/workflows*` (enforce siempre para estas dos claves, también en modo audit: módulo nuevo sin usuarios previos) y ve candado en el menú.
- **S2 — Bloque 2, contrato `vendix.workflow/v1`.** "Tipos y validador `vendix.workflow/v1` en `libs/shared-types` (etapas, transiciones, condiciones, requisitos, acciones, formularios; límites del §5.3 del plan)." "Validador puro y testeado: una sola etapa `start`, alcanzabilidad, transiciones válidas, condiciones tipadas, rama por defecto, ciclos solo con tarea humana, requisitos con plantillas publicadas, topes de tamaño." "Esquema JSON exportable y mensajes de error legibles."
- **S3 — Bloque 3, datos y motor.** "Migración aditiva: `workflow_definitions`, `workflow_versions`, `workflow_instances`, `workflow_tasks`, `workflow_instance_events`, `workflow_outbox` (según §5.2 del plan, con `store_id`, `row_version`, índices por etapa/estado/responsable)." "`WorkflowEngineService`: `start`, `completeTask`, `transition` (admin), `cancel`, `tick`. Transacción única, CAS por `row_version`, idempotencia por `idempotency_key`, eventos con `seq`, outbox para efectos." "Asignación por rol/grupo/usuario/round-robin; quórum N de M; vencimientos por etapa." "Permisos `store:workflows:*` y guardas por tienda (`StorePrismaService`)." "Tests: aislamiento por tienda, concurrencia (dos completions simultáneas), idempotencia, transición inválida, requisito pendiente."
- **S4 — Bloque 4, API mínima.** "`/api/store/workflows`: definiciones (CRUD borrador, validar, publicar, versiones, export/import), instancias (iniciar, listar, detalle), tareas (claim, complete). DTOs validados, `ResponseService`, paginación." "Sin webhooks ni API keys (fuera de esta entrega)."
- **S5 — Bloque 5, D1 documental.** "Migración aditiva: `stored_files`, `dossiers`, `dossier_items` (hash, mime, tamaño, tenant, `supersedes_id`, `requirement_key`, `stage_key`)." "Subida segura (tipo, tamaño, hash), descarga con permiso por rol, expediente por instancia, requisito `upload` conectado al motor." "Tests de aislamiento y de límites."
- **S6 — Bloque 6, UI mínima.** "Ruta `/admin/workflows`: lista de flujos + crear desde JSON + publicar; `/admin/workflows/instances/:id` con línea de tiempo y tarea actual; candado/paywall si la industria no es `administration`."
- **S7…S14 — Bloques 7–14** según el brief (L1), en ese orden, cada uno cerrado entero o no empezado.

## Tasks

| ID | S# | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S1 | inline | ✅ | `171e187fe`; specs guard 10/10, paridad 4/4; migración en scratch + re-ejecución idempotente |
| T2 | S2 | delegado (backstop de contexto) | ✅ | `050e0ba46`; 103 tests; `tsc --strict` limpio |
| T3 | S3 | delegado (backstop de contexto) | ✅ | `47888df50`; 126 tests; verificación en vivo (L6) |
| T4 | S4 | delegado | ✅ | `940439b45` + `8ac45b035`; 74 tests; en vivo (L6) |
| T5 | S5 | delegado | ✅ | `a696848ca`; 51+ tests; en vivo (L6) |
| T6 | S6 | delegado | ✅ | `3c4ca6b4e`; AOT limpio |
| T7 | S7 | delegado (2 unidades) | ✅ | `3b1bf9bde`, `575b94a4f` |
| T8 | S8 | delegado (2) | ✅ | `4002a6280`, `bb4d1621b`; backend en vivo |
| T9 | S9 | — | ⛔ bloqueado (BLOQUEO.md) | — |
| T10 | S10 | — | ⛔ depende de T9 | — |
| T11 | S11 | delegado | ✅ | `bafad6581` |
| T12 | S12 | delegado | ✅ | `08ffe2fb7` |
| T13 | S13 | delegado (3) | ✅ | `3b1fcf707`, `e7163e58e`, `ec4547bbf`; en vivo |
| T14 | S14 | — | ⏸ no iniciado (BLOQUEO.md) | — |
| V | S1–S13 | verificador independiente | ✅ 1 bloqueante corregido | `af25d6434`, re-verificado en vivo |

Riesgo: S1/S3/S5 tocan migraciones y scoping por tenant (alto riesgo, items 1 y 2): verificación independiente al cierre de S3 y S5.

## Log

- **L1 (2026-11-05, brief de Rafael vía orquestador, textual en lo esencial)**: "lanzar con la cuenta Claude B la implementación del plan completo de Flujos y Documentación, con un cambio de criterio: no atarlo a IA Business. Debe quedar atado a una industria nueva llamada `administration`; lo que diferencia a los planes es la IA y sus consumos de tokens, no el acceso al módulo." "Tu entregable es un PR a develop con calidad de revisión ≥ 89/100." "Cada bloque se cierra entero (código + tests + verificación) antes de pasar al siguiente, y sigues con los bloques 7–14 en el mismo orden. Si el tiempo o la cuota se acaban, paras en un bloque cerrado —nunca a mitad— y lo declaras en el reporte. Nada de código muerto ni rutas a medio hacer." Reglas: tests solo de lo tocado `--runInBand`; migraciones aditivas e idempotentes; no tocar `apps/mobile`; commits convencionales sin firmas de IA; al terminar push + PR a develop con aviso de migración y `REPORTE-FLUJOS.md`; bloqueo → `BLOQUEO.md` y seguir.
- **L2 (decisión, conflicto detectado)**: `plan-modules.ts` (`IA_BUSINESS_MODULE_KEYS = ['flows','documents']`) y la migración `20261110090000_plan_module_rules` ya siembran `flows`/`documents` como `exclusive` de `ia-business%`. El brief dice "No tocar la matriz de planes". Se respeta: no se edita la matriz ni se agregan rutas API de workflows a `PLAN_MODULE_API_ROUTES`, así que la capa de plan del backend no evalúa `/api/store/workflows` y la API queda gobernada solo por industria. Pendiente para Rafael: quitar las dos filas `exclusive` desde superadmin (Planes) o autorizar una migración de datos; mientras tanto, con la capa de plan en `enforce`, el menú mostraría candado de plan a tiendas `administration` sin IA Business. Quitarlas por migración es mutación de datos (CLAUDE.md §6.3) y no se hace sin autorización explícita.
- **L3 (decisión)**: la compuerta por industria está en modo `audit` por defecto (solo registra). Para `flows`/`documents` se agrega una lista `ENFORCED_INDUSTRY_KEYS` que bloquea siempre (backend 403, frontend candado), porque son módulos nuevos sin usuarios previos que romper.
- **L4**: falso positivo de auditoría propia: creí que `StorePrismaService.$transaction` no tenía scope; sí lo tiene (override al final del servicio). Se conservan los predicados `store_id` explícitos como defensa en profundidad y el fake de tests replica producción.
- **L5**: fallo preexistente en la base, no causado por este cambio: `default-panel-ui.service.spec.ts` reclama `orders_scheduled` sin default.
- **L6 (verificación en vivo, backend del worktree en :3099 contra la copia scratch `vendix_flujos` y Redis desechable)**: 403 `MODULE_INDUSTRY_001` en tienda sin `administration`; borrador→validar→publicar v1, republicar `unchanged`; iniciar con Idempotency-Key y repetición `replayed:true`; PNG renombrado a PDF → `DOCUMENT_TYPE_MISMATCH`; subida real a S3 y descarga con sha256 idéntico; requisito pendiente → 409 "Falta: Soporte de compra"; comentario obligatorio; rama condicional por monto; **dos aprobaciones simultáneas → una gana, la otra `WORKFLOW_STALE`, un solo avance**; aislamiento entre dos tiendas `administration` (404 en solicitud, tarea, archivo, expediente); outbox `notify`+`advance` despachados por cron y etapa automática completada. Hallazgo corregido en `8ac45b035`: el empleado no veía su propia solicitud. Datos de prueba solo en la scratch (industrias de tiendas 3 y 4, vínculos `store_users` y contraseñas de 3 usuarios seed). No verificado en vivo: recordatorio/escalamiento por vencimiento (solo specs).
- **L7**: verificador independiente: bloqueante B1 (replay de idempotencia con clave ajena devolvía la solicitud de otro usuario) + 12 advertencias; corregidos B1, A1, A2, A3, A5, A6 en `af25d6434`; B1 re-verificado en vivo. Typecheck completo del backend limpio. Reporte final en `REPORTE-FLUJOS.md`.
- **L8 (gate pr-code-review)**: ronda inicial 78/100 (defaults de panel por rol sin `flows`, telemetría del candado, orden del scope, suscripciones anidadas; reportes en raíz retirado por ser entregable pedido). Ronda 1 `2ae41473c` → **89/100 APPROVE**, sin defectos nuevos. Preguntas abiertas para Rafael: candado de plan `ia-business` sobre `flows`/`documents`; mostrar el candado al personal de tiendas sin la industria; QA manual en el vhost.
