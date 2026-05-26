# Plan: Formalizar `model_type` en AI Engine (configs + apps)

## Context
Las configuraciones IA y aplicaciones IA actualmente derivan el tipo de modelo (text / image / embedding / audio / video / rerank / speech / transcription) por heurística sobre `ai_engine_configs.settings` JSON en `apps/backend/src/ai-engine/ai-engine.service.ts:1416-1433` (`getModelTypeFromSettings`). Las apps solo declaran `output_format`, que es distinto del tipo del modelo subyacente. No hay validación al asignar una config a una app, ni la UI de super-admin permite ver o filtrar por tipo. Resultado: configs de texto pueden quedar asignadas a apps de imagen (y viceversa) sin error, y los flujos fallan en runtime con mensajes opacos. Necesitamos `model_type` como campo estructurado y de primera clase tanto en `ai_engine_configs` (capacidad del modelo) como en `ai_engine_applications` (tipo requerido), con validación cruzada y UI explícita.

## General Objective
Formalizar `model_type` como enum y columna obligatoria en `ai_engine_configs` y `ai_engine_applications`, con validación cruzada y selector en super-admin, para que texto e imagen (y los demás tipos del catálogo `AIModelType`) sean soportados explícitamente por cada aplicación IA.

## Specific Objectives
1. Existe enum Postgres `ai_model_type_enum` con los 8 valores: `text`, `image`, `embedding`, `audio`, `video`, `rerank`, `speech`, `transcription` (alineado con `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts:2-10`).
2. `ai_engine_configs.model_type` y `ai_engine_applications.model_type` existen como columnas `NOT NULL` con `default 'text'`, ambas backfilled desde `settings.model_type` o vía heurística usando el algoritmo actual de `getModelTypeFromSettings`.
3. `CreateAIConfigDto`, `UpdateAIConfigDto`, `CreateAIAppDto`, `UpdateAIAppDto`, `AIAppQueryDto`, `AIConfigQueryDto` exponen `model_type` con validación `@IsIn` contra el catálogo.
4. `AIEngineAppsService.create` y `.update` rechazan con `VendixHttpException` cuando el `model_type` de la config asignada no coincide con el `model_type` de la app, devolviendo un código de error tipado (nuevo `AI_APP_003` o equivalente).
5. `AIEngineService.getApplicationModelType` lee `ai_engine_applications.model_type` (o de la config si la app no la define) en lugar de la heurística sobre `settings`; la heurística queda como `fallback` solo para registros legados sin migrar.
6. El seed `apps/backend/prisma/seeds/ai-engine-apps.seed.ts` declara `model_type` explícito por app y empareja con configs cuyo `model_type` coincida (eliminando heurísticas `isImageGenerationConfig` / `isTextGenerationConfig`).
7. Los modales super-admin (`ai-engine-config-modal.component.ts`, `ai-engine-app-modal.component.ts`) tienen selector `model_type` y la tabla de apps/configs muestra el tipo como badge y permite filtrar por él.
8. Tests `apps/backend/src/domains/superadmin/ai-engine/ai-engine-apps.service.spec.ts` cubren el caso "asignar config de tipo X a app de tipo Y → error".

## Approach Chosen
**Columna `model_type` enum en ambas tablas, validación cruzada exacta (una app = un tipo), seed y UI alineados.** Razón:
- El enum `AIModelType` ya existe en TypeScript (frontend + backend) con los 8 valores, solo falta llevarlo al schema Prisma.
- Promover `model_type` a columna elimina la heurística frágil sobre JSON y permite índices, filtros y validación nativa.
- Cardinalidad 1-tipo-por-app coincide con el catálogo real (`invoice_ocr`=vision/text dependiendo del modelo, `marketing_ad_image_generator`=image, resto=text); evita lógica de intersección de arrays. Si más adelante surge multimodal real, se añade un opcional `additional_model_types[]` sin romper consumidores.
- La validación cruzada en service convierte un fallo silencioso en runtime (mensaje opaco del provider) en un 400 explícito en superadmin.

## Alternatives Considered
- **Mantener `model_type` en `settings` JSON y solo agregar validación cruzada por heurística**: rechazado porque la heurística requiere conocer convenciones no formalizadas (`image_generation_mode`, `modalities`), no soporta índices y no es introspectible desde UI/superadmin.
- **`supported_model_types[]` en app (multi-tipo)**: rechazado por innecesario hoy — no hay caso de uso en Vendix donde una app deba alternar entre tipos en runtime; agrega complejidad de selección.
- **Solo backend (sin UI superadmin)**: rechazado por el usuario al elegir alcance completo; sin UI los super-admin asignarán configs incorrectas y el bug se reintroduce.

## Critical Files
- `apps/backend/prisma/schema.prisma` — agregar enum + columnas en `ai_engine_configs` (líneas 3476-3496) y `ai_engine_applications` (líneas 3498-3521).
- `apps/backend/prisma/migrations/<timestamp>_add_ai_model_type/migration.sql` — migración nueva con enum, columnas y backfill SQL.
- `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts` — fuente de verdad del tipo `AIModelType` (líneas 2-10).
- `apps/backend/src/ai-engine/ai-engine.service.ts` — actualizar `getApplicationModelType` (línea 811), `getApplicationExecutionType` (línea 844) y dejar `getModelTypeFromSettings` (línea 1416) como fallback legado.
- `apps/backend/src/domains/superadmin/ai-engine/dto/create-ai-config.dto.ts` — agregar `model_type`.
- `apps/backend/src/domains/superadmin/ai-engine/dto/update-ai-config.dto.ts` — heredar.
- `apps/backend/src/domains/superadmin/ai-engine/dto/create-ai-app.dto.ts` — agregar `model_type`.
- `apps/backend/src/domains/superadmin/ai-engine/dto/update-ai-app.dto.ts` — heredar.
- `apps/backend/src/domains/superadmin/ai-engine/dto/ai-app-query.dto.ts` — filtro `model_type` opcional.
- `apps/backend/src/domains/superadmin/ai-engine/dto/ai-config-query.dto.ts` — filtro `model_type` opcional (crear si no existe).
- `apps/backend/src/domains/superadmin/ai-engine/ai-engine-apps.service.ts` — validación cruzada en `create` (línea 15) y `update` (línea 167+).
- `apps/backend/src/domains/superadmin/ai-engine/ai-engine.service.ts` — propagar `model_type` en respuestas y filtros.
- `apps/backend/src/common/errors/error-codes.ts` — nuevo `AI_APP_003` ("Config model_type does not match app model_type").
- `apps/backend/prisma/seeds/ai-engine-apps.seed.ts` — declarar `model_type` por app y emparejar configs.
- `apps/backend/src/domains/superadmin/ai-engine/ai-engine-apps.service.spec.ts` — test de validación cruzada.
- `apps/backend/src/domains/superadmin/ai-engine/ai-engine.service.spec.ts` — test de configs con `model_type`.
- `apps/backend/src/domains/superadmin/ai-engine/dto/create-ai-config.dto.spec.ts` — validación de enum.
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/interfaces/ai-engine.interface.ts` — agregar `model_type` a `AIEngineConfig` (línea 12), `AIEngineApp` (línea 117), DTOs y query DTOs.
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/components/ai-engine-config-modal.component.ts` — selector `model_type`.
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/components/ai-engine-app-modal.component.ts` — selector `model_type` + validación visual de mismatch con la config elegida.
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/ai-engine.component.ts` — columna/badge `model_type` en tablas, filtro por tipo.

## Reusable Assets
- `apps/backend/src/ai-engine/interfaces/ai-provider.interface.ts:2-10` — `AIModelType` TS ya existe; la migración Prisma se alinea contra él.
- `apps/backend/src/ai-engine/ai-engine.service.ts:1416-1463` — `getModelTypeFromSettings` + `isAIModelType` se reutilizan como **funciones de backfill** dentro de la migración (vía script) y como fallback runtime para configs legadas.
- `apps/backend/src/common/errors/error-codes.ts` (existente `AI_APP_001/002`, `AI_CONFIG_001`) — extender con `AI_APP_003` siguiendo el patrón actual.
- `apps/frontend/src/app/shared/forms/...` (selects nativos de Vendix) — reutilizar el patrón de `ai-engine-app-modal.component.ts` para `output_format` (líneas con `<select>` o `app-select`) para implementar el selector `model_type` sin componente nuevo.
- Skill `vendix-prisma-migrations` — patrón idempotente con header `DATA IMPACT` y backfill antes de `NOT NULL`.
- Skill `vendix-validation` — uso de `class-validator` `@IsIn(AIModelType[])` con la lista del catálogo.

## Steps

1. Migración Prisma: enum + columnas + backfill
   Skills: vendix-prisma-migrations, vendix-prisma-schema
   Resources: `cd apps/backend && npx prisma migrate dev --name add_ai_model_type --create-only`, luego edición manual del SQL; aplicar con `npx prisma migrate dev`.
   Business decision: Toda mutación de schema en Vendix va por migración versionada e idempotente; no se permite `DROP`/`TRUNCATE CASCADE`. La columna se crea NULL → backfill → `NOT NULL` con default `text`. (Global rule 6 + skill `vendix-prisma-migrations`.)
   Why: Va primero porque DTOs, service, seed y frontend dependen de la columna existir; sin esto, el resto rompe Prisma Client.
   Output: `apps/backend/prisma/migrations/<ts>_add_ai_model_type/migration.sql` que crea `ai_model_type_enum`, agrega `model_type` a `ai_engine_configs` y `ai_engine_applications`, backfill por SQL replicando heurística (`CASE WHEN settings->>'model_type' IN (...) THEN ... WHEN settings ? 'image_model' THEN 'image' ELSE 'text' END`), índice por `model_type` en ambas tablas, header `-- DATA IMPACT:` indicando filas afectadas.
   Verification: `cd apps/backend && npx prisma migrate status` reporta migración aplicada; `psql $DATABASE_URL -c "SELECT model_type, COUNT(*) FROM ai_engine_configs GROUP BY 1; SELECT model_type, COUNT(*) FROM ai_engine_applications GROUP BY 1;"` muestra distribución no-nula.

2. Actualizar `schema.prisma` con enum y columnas
   Skills: vendix-prisma-schema
   Resources: `cd apps/backend && npx prisma generate`
   Business decision: `schema.prisma` es la fuente declarativa; cualquier columna añadida por migración manual debe quedar reflejada para que Prisma Client la conozca y el resto del código pueda tiparla. (Skill `vendix-prisma-schema`.)
   Why: Va inmediatamente después de la migración porque sin el schema actualizado Prisma Client no expone `.model_type` y el TS no compila.
   Output: `apps/backend/prisma/schema.prisma` con `enum ai_model_type_enum { text image embedding audio video rerank speech transcription }`, campos `model_type ai_model_type_enum @default(text)` en ambos modelos, `@@index([model_type])`.
   Verification: `cd apps/backend && npx prisma generate` finaliza sin errores; `grep -n "model_type" apps/backend/prisma/schema.prisma` muestra al menos 3 ocurrencias (enum + 2 columnas).

3. Extender DTOs backend y agregar código de error
   Skills: vendix-validation, vendix-backend-api, vendix-error-handling
   Resources: `npm run lint -w apps/backend`
   Business decision: La validación de tipo ocurre en el DTO con `@IsIn` contra el catálogo central; el error de mismatch usa `VendixHttpException` con código tipado en `error-codes.ts` (skill `vendix-error-handling`).
   Why: Va antes del service para que el service compile contra DTOs ya tipados.
   Output: `CreateAIConfigDto.model_type?`, `CreateAIAppDto.model_type?`, ambos `UpdateAI*Dto` heredan, `AIAppQueryDto.model_type?` (filtro), `AIConfigQueryDto.model_type?` (nuevo archivo si no existe), nuevo `ErrorCodes.AI_APP_003 = 'Config model_type does not match app model_type'`. Lista usa exactamente las 8 cadenas del catálogo.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/superadmin/ai-engine/dto/create-ai-config.dto.spec.ts` pasa, incluyendo nuevo caso "rechaza `model_type` fuera del catálogo".

4. Validación cruzada y filtros en services superadmin
   Skills: vendix-backend-api, vendix-validation, vendix-error-handling
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/superadmin/ai-engine/ai-engine-apps.service.spec.ts`
   Business decision: Una app no puede asociarse a una config cuyo `model_type` difiera del declarado por la app; se rechaza con 400 `AI_APP_003`. Si la app no declara `model_type`, toma el de la config (compatibilidad hacia atrás).
   Why: Va después de DTOs y antes del cambio en `AIEngineService` runtime, porque cambia el contrato pero no la resolución de tipo en runtime de provider.
   Output: `AIEngineAppsService.create` y `.update` consultan `ai_engine_configs.model_type` y comparan con `dto.model_type ?? appCurrent.model_type`; lanzan `AI_APP_003` en mismatch. Listado acepta filtro `?model_type=image`. `AIEngineService` superadmin (`ai-engine.service.ts` superadmin) acepta filtro paralelo para configs.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/superadmin/ai-engine/ai-engine-apps.service.spec.ts` pasa con el caso nuevo "asignar config text a app image → 400 AI_APP_003"; manual: `curl -X POST -H 'Authorization: Bearer $SUPERADMIN_TOKEN' -d '{"key":"x","name":"x","model_type":"image","config_id":<id_texto>}' http://localhost:3000/superadmin/ai-engine/apps` retorna 400.

5. Reescribir resolución runtime en `AIEngineService`
   Skills: vendix-ai-engine, vendix-ai-platform-core
   Resources: `npm run test -w apps/backend -- --runInBand src/ai-engine/`, `docker logs --tail 200 vendix-backend | grep ai_engine` para validar fallback legado.
   Business decision: `getApplicationModelType` lee `ai_engine_applications.model_type`; si es nulo (registro legado), cae a la config y luego a `getModelTypeFromSettings` como fallback. Ya no se confía en la heurística como fuente primaria.
   Why: Va después de la validación cruzada porque depende de columnas ya existentes y de que el seed/UI las popule; ejecutar antes haría que apps sin migrar respondan inconsistente.
   Output: `getApplicationModelType` y `getApplicationExecutionType` (`apps/backend/src/ai-engine/ai-engine.service.ts:811-856`) actualizados; `getModelTypeFromSettings` marcado como `@deprecated` con comentario "fallback legado para configs sin migrar".
   Verification: `npm run test -w apps/backend -- --runInBand src/ai-engine/` pasa; manual con Bruno: `bruno run apps/api-tests/ai-engine/run-by-type.bru --env dev` (o equivalente) prueba un app text + un app image y confirma despacho correcto.

6. Actualizar seed `ai-engine-apps.seed.ts`
   Skills: vendix-prisma-seed, vendix-ai-engine
   Resources: `npm run seed -w apps/backend -- ai-engine-apps` (o el comando real del runner Vendix), `psql $DATABASE_URL -c "SELECT key, model_type, config_id FROM ai_engine_applications ORDER BY key;"`
   Business decision: El seed declara `model_type` explícito por app y empareja con configs cuyo `model_type` coincida; las heurísticas `isImageGenerationConfig`/`isTextGenerationConfig` desaparecen (skill `vendix-prisma-seed` → idempotencia + flat seed).
   Why: Va después del runtime para que las apps nuevas/actualizadas creadas por seed pasen la validación cruzada del paso 4.
   Output: `apps/backend/prisma/seeds/ai-engine-apps.seed.ts` con cada definición de app declarando `model_type: 'text' | 'image' | ...`; selector de config por `where: { model_type: app.model_type, is_active: true }`.
   Verification: Re-correr seed sobre DB con datos no rompe (`idempotente`); `psql $DATABASE_URL -c "SELECT key, model_type FROM ai_engine_applications WHERE key IN ('invoice_ocr','marketing_ad_image_generator');"` retorna los tipos esperados.

7. Frontend super-admin: interfaces, modales y filtros
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-angular-forms
   Resources: `npm run build -w apps/frontend`, `npm run zoneless:audit`
   Business decision: La UI super-admin expone `model_type` en formularios (config y app) y como filtro/badge en tablas; si se asigna una config a una app con tipo distinto, el modal lo bloquea o muestra warning antes de enviar al backend (defensa en profundidad). Skill `vendix-zoneless-signals` + `vendix-angular-forms` rigen los controles.
   Why: Va al final porque consume las APIs ya extendidas; sin ellas, el frontend no tiene de dónde leer ni escribir el campo.
   Output: `ai-engine.interface.ts` con `model_type` en `AIEngineConfig`, `AIEngineApp`, los 4 DTOs y los 2 query DTOs; selectores en `ai-engine-config-modal.component.ts` y `ai-engine-app-modal.component.ts` (reutilizando el patrón de `output_format`); filtro `model_type` en `ai-engine.component.ts` + columna/badge en la tabla; el modal de app deshabilita configs incompatibles en el `select` de `config_id`.
   Verification: `npm run build -w apps/frontend` exit 0; manual: abrir `/super-admin/ai-engine`, crear config tipo `image`, intentar asignarla a app tipo `text` → modal bloquea; cambiar app a tipo `image` → permite asignar.

8. Tests y verificación final
   Skills: vendix-validation, vendix-ai-engine
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/superadmin/ai-engine src/ai-engine`, `npm run build -w apps/frontend`, `npm run build -w apps/backend`
   Business decision: Toda regla nueva queda cubierta por test unitario antes de mergear (skill `vendix-validation` y patrón del repo: cada cambio en service con `.spec.ts`).
   Why: Va al cierre para consolidar regresiones y dejar la suite verde como gate de merge.
   Output: Tests nuevos en `ai-engine-apps.service.spec.ts` (cross-validation), `create-ai-config.dto.spec.ts` (enum), `ai-engine.service.spec.ts` (resolución runtime con columna). Suite verde.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/superadmin/ai-engine src/ai-engine` 100% pass; `npm run build -w apps/backend && npm run build -w apps/frontend` exit 0.

## End-to-End Verification
1. `cd apps/backend && npx prisma migrate status` → todas las migraciones aplicadas, sin `pending`.
2. `psql $DATABASE_URL -c "SELECT model_type, COUNT(*) FROM ai_engine_configs GROUP BY 1; SELECT model_type, COUNT(*) FROM ai_engine_applications GROUP BY 1;"` → distribución sin `NULL` y consistente con seed.
3. Bruno (o curl): `POST /superadmin/ai-engine/apps` con `model_type:image` y `config_id` de config texto → 400 con `code: AI_APP_003`. Mismo POST con config imagen → 201.
4. UI manual: en `/super-admin/ai-engine` crear y editar configs/apps de tipo `text` e `image`; el badge y el filtro responden; intentar mismatch en el modal queda bloqueado.
5. Runtime: ejecutar un app `text` (p.ej. chat) y un app `image` (p.ej. `marketing_ad_image_generator`) vía `POST /store/ai/run-by-type/<appKey>` → cada uno responde con la forma de respuesta correcta (`AIResponse` vs `AIImageResponse`).
6. `npm run build -w apps/backend && npm run build -w apps/frontend` → ambos exit 0.
7. `npm run test -w apps/backend -- --runInBand src/domains/superadmin/ai-engine src/ai-engine` → suite verde.

## Knowledge Gaps
- El skill `vendix-ai-platform-core` describe el AIEngineService pero **no** menciona explícitamente la resolución de `model_type`; tras estabilizar este cambio, actualizar el skill con la nueva regla "lee `ai_engine_applications.model_type`, fallback a config, fallback a `settings`". Si después de la implementación se confirma que el patrón es repetible (otros dominios con tipos de capacidad), valorar elevarlo a skill propio `vendix-ai-model-type` vía `skill-creator`.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
