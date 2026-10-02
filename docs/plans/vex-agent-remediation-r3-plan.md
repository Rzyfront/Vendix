# Plan — Vex remediación ronda 3 (cierre de brechas post-auditoría)

## Context

La auditoría de código del 2026-10-01 sobre `docs/plans/vex-agent-remediation-plan.md` (commits `4f04f103f`…`19f110992`) midió ~78 %. Quedan brechas reales: `record_po_payment` y otras escrituras que mueven dinero o contabilizan no están marcadas `irreversible` y se aprueban con un clic; el rechazo de tools no ofrecidas ocurre después de emitir el frame `tool_call`, que Vexi ejecuta en el navegador; "Cancelar" no rechaza el plan en servidor (un plan cancelado sigue aprobable y reaparece al recargar); el estado del plan solo persiste `approved`; los pasos irreversibles quedan en callejón sin salida tras recargar (token solo en memoria); los caps `monthly_tokens_cap`/`daily_messages_cap` no se aplican; los conteos de caché nunca llegan a `ai_engine_logs`; la bitácora no recibe acciones del agente en vivo; y quedan detalles de seguridad (lectura de bloques no acotada a usuario, fuga 404/403, hashes sin expiración ni `plan_id`) y de UI. Además se commiteó una contraseña de seed en `docs/evidence/vex-remediation-e2e2-20261001/runner-vex_e2e2.py`. El usuario pidió preparar, ejecutar y subir esta ronda.

## General Objective

Cerrar todas las brechas abiertas por la auditoría para que Vex sea seguro, consistente tras recargar y medido, y subir el resultado a `origin/develop`.

## Specific Objectives

1. Toda tool que mueve dinero, envía a DIAN, cierra, anula, borra o aprueba asientos contables declara `irreversible: true`; un spec fija la lista y falla si alguna lo pierde.
2. Una tool no ofrecida se rechaza antes de emitir `tool_call` y antes de `ai.agent.tool_executed`; el navegador nunca la recibe.
3. `POST store/vex/plans/:id/reject` persiste `metadata.plan.status='rejected'`, cancela pasos pendientes y borra los hashes; un plan rechazado devuelve 409 al aprobar.
4. `metadata.plan` persiste el estado por paso (`pending|applied|failed|cancelled`) y del plan (`proposed|approved|rejected|applied|partially_applied`), incluso en turnos sin texto; recargar muestra el mismo estado.
5. Tras recargar, un paso irreversible de un plan aprobado obtiene una confirmación nueva del servidor y se puede aplicar.
6. Los caps `vex_agent.daily_messages_cap` y `monthly_tokens_cap` bloquean cuando se agotan; los pasos aplicados por plan consumen cuota `vex_agent`.
7. `ai_engine_logs.cache_read_tokens/cache_creation_tokens` se escriben en cada llamada que los reporta.
8. Cada acción aplicada por Vex/Vexi aparece en la bitácora en vivo, una sola vez.
9. `GET blocks/:id` solo devuelve bloques de conversaciones del usuario; `create()` falla cerrado sin usuario; el barrido de huérfanos solo toma bloques del turno.
10. El timeout del loop se lee de `ai_agents.timeout_seconds` (columna aditiva, editable en superadmin).
11. La contraseña commiteada se reemplaza por variable de entorno.

## Approach Chosen

Cuatro ejecutores en paralelo sobre `develop` (skills `parallel` + `sopus`: Opus orquesta/audita, Sonnet implementa) con alcances de archivos disjuntos y contratos fijados en este plan: (A) seguridad del catálogo y del loop + caps + timeout; (B) ciclo de vida del plan y bloques en backend; (C) caché en logs + bitácora en vivo + seed; (D) frontend contra el contrato de B. El orquestador hace el cambio trivial de la contraseña, audita cada diff, corre los specs y empuja a `origin/develop` (push directo, flujo vigente del dueño). Reutiliza `PlanApprovalService`, `VexiPlanStateService`, `VexBlockService`, `NotificationsSseService` y el patrón de cuota Redis existentes.

## Alternatives Considered

- **Marcar `purchasing`/`expenses`/`inventory` enteros como dominios irreversibles**: volvería irreversibles escrituras inocuas (crear OC, borradores). Rechazado; se usan flags explícitos por tool.
- **Guardar el `plan_token` en `localStorage` para sobrevivir recargas**: un token de escritura en almacenamiento del navegador amplía la superficie; se prefiere que el servidor emita una confirmación nueva para pasos irreversibles de un plan aprobado. Rechazado.
- **Ejecución secuencial de toda la ronda**: más lenta sin beneficio; los alcances son disjuntos. Rechazado.

## Critical Files

- `apps/backend/src/ai-engine/tools/domains/purchasing.tools.ts` — `record_po_payment`, `approve_receive_purchase_order` irreversibles (A).
- `apps/backend/src/ai-engine/tools/domains/finance-ops.tools.ts` — `run_depreciation` (A).
- `apps/backend/src/ai-engine/tools/domains/expenses.tools.ts` — `approve_expense` (A).
- `apps/backend/src/ai-engine/tools/domains/inventory.tools.ts` — `approve_stock_adjustment` (A).
- `apps/backend/src/ai-engine/tools/domains/accounting.tools.ts` — `post_journal_entry` (A).
- `apps/backend/src/ai-engine/tools/domains/invoicing.tools.ts` — `promote_dian_to_production`, `upload_dian_certificate`, `create_invoice_from_order` (A).
- `apps/backend/src/ai-engine/tools/domains/payroll.tools.ts` — `approve_payroll`, `approve_settlement`, `export_payroll_ach` (A).
- `apps/backend/src/ai-engine/tools/domains/fiscal.tools.ts` — `approve_declaration` (A).
- `apps/backend/src/ai-engine/tools/domains/cash-register.tools.ts` — `record_cash_movement` (A).
- `apps/backend/src/ai-engine/tools/irreversible-coverage.spec.ts` — lista fijada + factories faltantes (A).
- `apps/backend/src/ai-engine/ai-agent.service.ts` — guarda antes del frame, consumo de caps, timeout desde fila (A).
- `apps/backend/src/ai-engine/ai-agent.service.spec.ts` — casos nuevos (A).
- `apps/backend/src/domains/store/subscriptions/types/access.types.ts` — caps de mensajes/tokens (A).
- `apps/backend/prisma/schema.prisma` — `ai_agents.timeout_seconds` (A).
- `apps/backend/prisma/migrations/20261002130000_ai_agents_timeout_seconds/migration.sql` — aditiva (A).
- `apps/backend/src/domains/superadmin/ai-engine/dto/create-ai-agent.dto.ts` — `timeout_seconds` (A).
- `apps/backend/src/domains/store/ai-chat/ai-chat.service.ts` — pasar `timeout_seconds`; persistencia de plan sin texto; estados; barrido de huérfanos acotado (B).
- `apps/backend/src/domains/store/vex/vex.controller.ts` — reject, step confirmation, apply con estado y cuota, orden de chequeos (B).
- `apps/backend/src/domains/store/vex/services/plan-approval.service.ts` — `plan_id` ligado a hashes, expiración, rechazo (B).
- `apps/backend/src/domains/store/vexi/vexi-plan-state.service.ts` — hashes con `plan_id` y `created_at`, `clearStepHashes` (B).
- `apps/backend/src/domains/store/vex/services/vex-block.service.ts` — lectura por usuario, fail-closed (B).
- `apps/backend/src/domains/store/vex/services/plan-approval.service.spec.ts` — casos (B).
- `apps/backend/src/domains/store/vex/services/vex-block.service.spec.ts` — casos (B).
- `apps/backend/src/domains/store/ai-chat/ai-chat.plan.spec.ts` — casos (B).
- `apps/backend/src/ai-engine/ai-engine.service.ts` — pasar tokens de caché a `logRequest`/`calculateCost` (C).
- `apps/backend/src/ai-engine/ai-logging.service.spec.ts` — nuevo (C).
- `apps/backend/src/domains/store/vexi/vexi-activity.service.ts` — emitir evento vivo al registrar aplicada (C).
- `apps/backend/src/domains/store/vex/services/vex-activity-feed.service.ts` — usar `toLiveEvent` (C).
- `apps/backend/prisma/seeds/subscription-plans.seed.ts` — upsert de `vex_agent` en plan de desarrollo con `degradation: 'block'` (C).
- `apps/frontend/src/app/private/modules/store/vex/services/vex-api.service.ts` — reject, step confirmation, apply con plan/step (D).
- `apps/frontend/src/app/private/modules/store/vex/state/vex-chat.store.ts` — cancelar real, estado persistido, irreversibles tras recarga (D).
- `apps/frontend/src/app/private/modules/store/vex/components/vex-plan-card/vex-plan-card.component.ts` — mensajes correctos por estado (D).
- `apps/frontend/src/app/private/modules/store/vex/state/vex-log.store.ts` — consumir frame vivo de agente (D).
- `apps/frontend/src/app/private/modules/store/vex/components/vex-blocks/vex-block-file.component.ts` — locale (D).
- `apps/frontend/src/app/private/modules/store/vex/components/vex-blocks/vex-block-chart.component.ts` — paleta reactiva al tema (D).
- `apps/frontend/src/app/core/guards/vex-access.guard.ts` — settings sin `vex` → refetch (D).
- `apps/frontend/src/app/private/modules/store/settings/ai-agents/vex-settings.component.ts` — etiqueta de periodo (D).
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/components/ai-engine-agent-modal.component.ts` — campo `timeout_seconds` (D).
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/interfaces/ai-engine.interface.ts` — `timeout_seconds` (D).
- `docs/evidence/vex-remediation-e2e2-20261001/runner-vex_e2e2.py` — contraseña → env var (orquestador).

## Reusable Assets

- `apps/backend/src/domains/store/vex/services/plan-approval.service.ts` — token de plan, verificación de propiedad y hashes.
- `apps/backend/src/domains/store/vexi/vexi-confirmation.service.ts` — confirmación de un solo uso para pasos irreversibles.
- `apps/backend/src/domains/store/vexi/vexi-plan-state.service.ts` — `setStepHashes`/`getStepHashes`.
- `apps/backend/src/domains/store/vex/services/vex-activity-feed.service.ts` — `toLiveEvent`/`buildAgentLiveEvent` ya escritos.
- Servicio SSE de notificaciones del backend (`vendix-notifications-system`) — canal vivo existente.
- `apps/backend/src/ai-engine/ai-logging.service.ts` — ya acepta tokens de caché y tarifas.
- `apps/backend/src/domains/store/subscriptions/types/access.types.ts` + servicio de cuota Redis — patrón INCR+EXPIRE.

## Steps

1. Checkpoint y contraseña
   Skills: parallel, git-workflow
   Resources: `git tag checkpoint/parallel-vex-r3`; `git rev-parse HEAD`
   Business decision: Ningún secreto en el repo; los scripts de evidencia leen credenciales de `VEX_E2E_PASSWORD`.
   Why: Antes del fan-out, ancla de recuperación.
   Output: tag y script sin contraseña literal.
   Verification: `grep -rn "1125634q" docs/evidence` sin resultados.

2. (A) Catálogo irreversible, guarda temprana, caps y timeout
   Skills: vendix-vex-agent, vendix-ai-agent-tools, vendix-subscription-gate, vendix-redis-quota, vendix-prisma-migrations, vendix-prisma-schema
   Resources: `cd apps/backend && npx jest --runInBand src/ai-engine/tools/irreversible-coverage.spec.ts src/ai-engine/ai-agent.service.spec.ts src/ai-engine/tools/ai-tool-registry.spec.ts`; `npx prisma migrate dev`
   Business decision: Irreversible = mueve dinero, envía a DIAN/entes, cierra, anula, borra o aprueba algo que contabiliza. La guarda de catálogo ofrecido va antes de cualquier emisión (`ai.agent.tool_executed`, frame `tool_call`). Vex consume `daily_messages_cap` (1 por turno) y `monthly_tokens_cap` (tokens del turno) además de `monthly_tool_calls_cap`. Timeout = `ai_agents.timeout_seconds` (NULL → default actual), la ampliación por plan no supera 600 s. Migración aditiva `ADD COLUMN IF NOT EXISTS timeout_seconds INT NULL`, `-- DATA IMPACT: 0 filas`.
   Why: Es el riesgo de seguridad; paralelo con B/C/D.
   Output: flags, spec con lista fijada, guarda movida, caps, columna + DTO.
   Verification: specs verdes; spec que verifica 0 frames `tool_call` para tool no ofrecida; `npx prisma migrate status` limpio.

3. (B) Ciclo de vida del plan y bloques
   Skills: vendix-vex-agent, vendix-ai-chat, vendix-backend-api, vendix-error-handling, vendix-multi-tenant-context, vendix-prisma-scopes
   Resources: `cd apps/backend && npx jest --runInBand src/domains/store/vex src/domains/store/ai-chat`
   Business decision: Contrato fijo (lo consume D):
   - `metadata.plan = {plan_id, status, steps:[{step_id, order, tool, arguments, preview, irreversible, status, error?}]}` con `status ∈ proposed|approved|rejected|applied|partially_applied` y step `status ∈ pending|applied|failed|cancelled`.
   - `POST store/vex/plans/:id/reject {conversation_id}` → `{plan_id, status:'rejected'}`; pasos `pending` → `cancelled`; borra hashes; 403 no dueño; 409 si ya `applied`.
   - `POST store/vex/plans/:id/steps/:step_id/confirmation {conversation_id}` → `{confirmation_token, expires_in}` solo si plan `approved`, paso `irreversible` y `pending`, dueño.
   - `POST store/vex/confirmations/apply {conversation_id, plan_id, step_id, plan_token? | confirmation_token?}` → resultado de la tool + `{step_status, plan_status}`; persiste estados y consume cuota `vex_agent`. Plan pasa a `applied`/`partially_applied` cuando todos los pasos son terminales.
   - Hashes guardados con `plan_id` y `created_at`; approve exige `plan_id` igual y antigüedad < 24 h; propiedad se verifica antes de leer hashes (sin fuga 404/403).
   - Plan y punteros de bloques se persisten aunque el turno no tenga texto. Barrido de huérfanos solo bloques creados durante el turno. `GET blocks/:id` exige conversación del usuario; `create()` falla sin `user_id`.
   Why: Corrige estado y seguridad del plan; D depende de este contrato.
   Output: endpoints, servicios y specs.
   Verification: specs cubren reject→approve 409, estados persistidos, turno sin texto persiste plan, otro usuario no lee bloque, confirmación de paso irreversible tras aprobación.

4. (C) Caché en logs, bitácora viva y seed
   Skills: vendix-ai-platform-core, vendix-notifications-system, vendix-vex-agent, vendix-prisma-seed
   Resources: `cd apps/backend && npx jest --runInBand src/ai-engine/ai-logging.service.spec.ts src/domains/store/vex/services`
   Business decision: Todas las llamadas que logean pasan `cacheReadTokens/cacheCreationTokens` y se costean con tarifa de caché si existe. Cada acción aplicada registrada por `VexiActivityService` emite por el SSE de notificaciones de la tienda un evento `vex_agent_action` con id `agent-<id>` igual al del feed. El seed de desarrollo hace upsert de `vex_agent` en el plan trial con `degradation: 'block'`, sin tocar seeds de producción.
   Why: Paralelo; cierra objetivos 7 y 8.
   Output: cambios en `ai-engine.service.ts`, `vexi-activity.service.ts`, `vex-activity-feed.service.ts`, seed, spec nuevo.
   Verification: specs verdes; spec que comprueba `logRequest` recibe tokens de caché; spec que comprueba emisión SSE al registrar aplicada.

5. (D) Frontend
   Skills: vendix-vex-agent, vendix-frontend, vendix-zoneless-signals, vendix-frontend-state, vendix-frontend-theme, vendix-date-timezone, vendix-currency-formatting
   Resources: `cd apps/frontend && node ../../node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js -p tsconfig.app.json --noEmit`; `npm run zoneless:audit`
   Business decision: "Cancelar" llama a reject; el estado de la tarjeta sale de `metadata.plan` y de `{step_status, plan_status}`; el request de approve excluye pasos irreversibles; tras recargar, un paso irreversible de un plan aprobado pide `steps/:step_id/confirmation` y aplica por `/store/vex/confirmations/apply`; mensajes de cancelación reflejan pasos ya aplicados; bitácora consume `vex_agent_action`; locale de tienda en bloque archivo; paleta del gráfico se recalcula al cambiar tema; guard refetch si `settings.vex` es undefined; etiqueta "Uso del día/mes" según periodo; campo `timeout_seconds` en el modal de agente.
   Why: Consume el contrato de B; paralelo con contrato fijado.
   Output: componentes/servicios actualizados.
   Verification: ngc sin errores; `zoneless:audit` sin nuevas violaciones en `store/vex`.

6. Auditoría, pruebas y subida
   Skills: sopus, vendix-known-errors, git-workflow, vendix-engram
   Resources: `cd apps/backend && npx jest --runInBand src/domains/store/vex src/domains/store/ai-chat src/ai-engine`; `git push origin develop`
   Business decision: Opus revisa cada diff contra el plan; cualquier desviación se corrige antes de empujar. Memoria Engram guardada antes del push. Sin firmas de IA.
   Why: Cierre.
   Output: commits en `origin/develop`.
   Verification: suites verdes; `git rev-list --count origin/develop..HEAD` = 0 tras push.

## End-to-End Verification

1. `cd apps/backend && npx jest --runInBand src/domains/store/vex src/domains/store/ai-chat src/ai-engine` verde.
2. `npx prisma migrate status` limpio.
3. Frontend: ngc `--noEmit` sin errores y `./scripts/buildcheck.sh --watch` sin errores en el último ciclo.
4. `git log origin/develop -1` coincide con HEAD local.

## Knowledge Gaps

- Ninguno nuevo; las reglas se agregan a `vendix-vex-agent` (estados del plan, reject, confirmación por paso tras recarga).

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
