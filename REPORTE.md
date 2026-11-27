# Reporte PR #1430 (`fix/vex-voz-corta`): correcciones de la revisión (B1, B2)

Revisión independiente: 62/100, dos bloqueantes reproducidos y CI de tipos en rojo. Sin push.

## Historia de usuario

Como dueño de tienda en el panel de Vex/Vexi (`https://vendix.com`), quiero que la voz nunca me dicte código y que el acuse hablado de un cambio llegue con audio válido o sin audio, para no oír JSON ni recibir un audio roto cuando el proveedor de voz falla.

Pasos en pantalla:
1. En Vex, pedir una respuesta que termine en un bloque de código o JSON y tocar «Escuchar».
2. Activar el modo voz y repetir con una respuesta que tenga un bloque de código seguido de más texto.
3. En Vexi, confirmar por voz un cambio (por ejemplo, subir un precio) mientras el proveedor de voz falla.

Criterios observables:
- En 1 y 2 se oye la prosa, nunca el código, las llaves ni la palabra «json».
- En 3 el cambio queda aplicado y el resumen aparece en texto, sin reproductor de audio vacío.

## B1 — el acuse de Vexi no maneja `SynthesisLoss`

- `vexi.controller.ts`: en el acuse, `isSynthesisLoss(spoken)` se trata como «sin audio»: no se asigna a `audio` ni se mide en el cupo. La respuesta sale sin `audio_base64`/`content_type`, igual que antes del PR.
- Consumidores de `synthesize()` (`rg "synthesize\("`): fuera del pipeline solo existe el acuse de `vexi.controller.ts`. El pipeline ya distinguía la pérdida.
- El typecheck completo encontró otro error del PR que el informe no listaba: `vexi-speech.service.spec.ts(683)` `TS2339 'seconds' does not exist on type 'SynthesizedAudio | SynthesisLoss'`. Se corrigió estrechando el tipo con `isSynthesisLoss` en vez de `!`.
- Spec nuevo (`vexi.controller.voice-quota.spec.ts`): proveedor caído en el acuse → el cambio se aplica, la respuesta no tiene `audio_base64` ni `content_type` y no se consume cupo. RED antes del arreglo (`Expected path: not "audio_base64"`), GREEN después.

## B2 — el filtro dictaba el código cuando el trozo terminaba en el cierre del bloque

- `vexi-speech.markdown.ts` (`safeEnd`):
  - Paso 2: las comillas invertidas finales solo se retienen si quedan después del último bloque cerrado; si son el cierre de un bloque, ya no se toman por una apertura.
  - Paso 5 (nuevo): ningún corte cae dentro de un bloque cerrado. El paso 4 retenía la línea corta «```» del cierre y así también partía el bloque; ahora se retiene el bloque entero.
- Spec nuevo `vexi-speech.markdown.spec.ts`: el caso exacto del informe (un `push` + `flush`), el mismo bloque seguido de prosa en otro trozo, código al inicio del texto (solo, y seguido de prosa) y unas comillas finales que sí abren un bloque (siguen retenidas). Antes del arreglo, 3 de 4 en RED, por ejemplo `Received string: "Aquí va el ejemplo.\njson…"`. Después, 4/4.

## Evidencia

Specs (uno por invocación, config scratch `isolatedModules` + stub de `nodemailer`):

```
src/domains/store/vexi/vexi.controller.voice-quota.spec.ts   Tests: 6 passed, 6 total
src/domains/store/vexi/vexi-speech.markdown.spec.ts          Tests: 4 passed, 4 total
src/domains/store/vexi/vexi-speech.pipeline.spec.ts          Tests: 35 passed, 35 total
src/domains/store/vexi/vexi-speech.service.spec.ts           Tests: 86 passed, 86 total
```

Typecheck:
- `npm run buildcheck:types` en este worktree aborta en 10 s con un único `error TS2688: Cannot find type definition file for 'yauzl'` (la carpeta `@types/yauzl` del `node_modules` enlazado está vacía, igual que `apps/backend/node_modules/@types/node`). Con ese error global `tsc` no comprueba nada más: es un falso verde, no evidencia.
- Mismo programa que `tsconfig.check.json` (mismo `include`, 8 GB de heap como en CI), con los `@types` implícitos de CI salvo el `yauzl` vacío y el tsbuildinfo en `/tmp`: **0 errores en Vex/Vexi**. Los `TS2322` (294) y `TS2345` (295) de `vexi.controller.ts` y el `TS2339` del spec ya no aparecen. Quedan 6 errores, ninguno en archivos de este PR, todos del `node_modules`/cliente Prisma compartido con el checkout principal: `@aws-sdk/client-sns` (2), `@aws-sdk/client-sqs`, `nodemailer` y `mailparser` no instalados, y `public_token` en `store_app_mediaWhereInput` (cliente Prisma generado desde otro schema; este PR no toca el schema).
- Confirmación definitiva: el job «Typecheck de specs (buildcheck:types)» de CI, con instalación limpia, al publicar la rama.

---

# Reporte: clasificador de desempate de Vex (`vex_classifier`)

Rama `feat/vex-clasificador` (base `origin/develop` @ b2f40f016), PR #1428. Spec: `odd/tasks/vex-clasificador.md`. Sin push.

> Ronda de corrección tras la revisión independiente (62/100): ver «Correcciones de la revisión (B1, B2, B3 y CI)» al final.

## Historia de usuario

Como dueño de tienda en el chat de Vex, quiero que Vex no cree tickets de «capacidad faltante» para cosas que Vendix ya hace y que mi «sí/no» frente a una tarjeta de lote quede leído, para recibir respuestas honestas sin que nada cambie cuando el clasificador está apagado.

Como super admin en la administración del motor de IA, quiero elegir cualquier modelo de OpenRouter para el clasificador sin deploy, para cambiar costo/calidad sin tocar código.

### Pasos en pantalla

1. Con la fila `vex_classifier` inactiva: pedir a Vex algo que no existe y aceptar la tarjeta → se crea el ticket como hoy.
2. Activar la fila con un modelo `typesafe/*` y `adapter: 'auto'`; pedir algo ambiguo para el catálogo → la tarjeta de solicitud dice que no se crea ticket si el clasificador opina `exists`/`unclear`.
3. Cambiar el modelo de la config a uno cualquiera (p. ej. `openai/gpt-5-mini`) y repetir 2 → mismo comportamiento; la traza `verifier` muestra `classifier_adapter = chat` y el nuevo `classifier_model`.
4. Con una tarjeta de lote pendiente, responder «dale» → la respuesta de Vex no cambia; la conversación guarda la lectura `accept` junto al id del lote; la tarjeta sigue siendo lo único que aplica.

### Criterios de aceptación observables

- Fila ausente/inactiva, sin clave, sin `model_id`, o cualquier falla (timeout, 429, 500, JSON inválido dos veces) → el chat responde como hoy; nunca se bloquea ni muestra un error.
- Cambiar de modelo es editar una fila; no hay `model_id` escrito en el código.

## Adaptadores

| `metadata.adapter` | Modelo `typesafe/*` | Otro modelo |
| --- | --- | --- |
| `auto` (por defecto) | `decisions` → `/api/alpha/decisions` | `chat` → `/api/v1/chat/completions` |
| `decisions` | `decisions` | `unavailable` (`adapter_unsupported`), sin llamada |
| `chat` | `chat` | `chat` |
| otro valor | `unavailable` (`config_error`) | `unavailable` (`config_error`) |

- **decisions**: una pregunta tipada `choice` con id `verdict`; la respuesta trae `choice` + `confidence`.
- **chat**: mismo estado y mismos criterios en un mensaje `system` que exige JSON estricto `{"verdict": "<valor>"}`; `response_format: { "type": "json_object" }` salvo `metadata.json_mode = false`. Si el proveedor rechaza el pedido con 400, se reintenta una vez sin `response_format` (el mensaje ya exige JSON). Se valida exactamente una clave `verdict` con un valor permitido (se tolera un bloque ```json). Si no valida: **un** turno de reparación; si vuelve a fallar → `unavailable` (`invalid_response`). `refusal` o `content_filter` → `unavailable` (`refusal`), sin reparación.
- Garantías en ambos: timeout por POST (`retry_config.timeout_ms`, 800 ms por defecto, 100–5000), **plazo total por llamada lógica** (`retry_config.total_timeout_ms`, 1200 ms por defecto, 100–5000) que abarca reintento, reparación y reenvío; máximo 1 reintento en 429/5xx/timeout/red; **tope por turno contado en POST** (`rate_limit.max_calls_per_turn`, 3 por defecto); `null` en esas claves = valor por defecto; fail-closed (`unavailable`, nunca lanza), nunca reemplaza el texto de Vex. Un modelo que rechazó `response_format` con 400 queda recordado y no vuelve a pagar el reenvío.
- `min_confidence`: chat no reporta confianza; con `min_confidence > 0` un modelo de chat degrada siempre a `low_confidence`. Con chat, dejarlo en 0.

### Modelos con Decisions API

Constante `DECISIONS_MODEL_PREFIXES` en `apps/backend/src/ai-engine/vex-classifier.service.ts`. Para ampliar: agregar el prefijo ahí y en esta tabla.

| Prefijo de `model_id` | Ejemplo | Fuente |
| --- | --- | --- |
| `typesafe/` | `typesafe/jev-1.14` | https://openrouter.ai/docs/api-reference/decisions |

### Parámetros por modelo (solo `chat`)

En `metadata`, opcionales; se envían solo si vienen y son válidos, nunca con valor por defecto. En `decisions` se ignoran.

| Clave | Validación | Se envía como |
| --- | --- | --- |
| `temperature` | número 0–2 | `temperature` |
| `max_tokens` | entero 1–32000 | `max_tokens` |
| `reasoning_effort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | `reasoning: { effort }` |

Las columnas `temperature`/`max_tokens` de la fila no se leen: la fuente es `metadata`.

## Configuración (SQL de ejemplo)

Modelo y proveedor salen siempre de `ai_engine_configs` (fila de `config_id`). `api_key_ref` significa lo mismo que en todo el motor: **la clave literal**, enmascarada en el panel; si está vacía, el respaldo del motor `AI_<PROVIDER>_API_KEY` (p. ej. `AI_OPENROUTER_API_KEY`). `base_url` es opcional y solo puede ser `https://openrouter.ai/...` (se usa su origen; la ruta la pone el adaptador); cualquier otro host → `unavailable` (`host_not_allowed`), sin llamada.

> Ejemplo para un entorno nuevo. Cambios en DB de staging/prod van por el flujo del motor (super admin) o por migración versionada, nunca SQL manual.

```sql
-- api_key_ref NULL: usa AI_OPENROUTER_API_KEY del despliegue, igual que el motor.
-- Para una clave propia, crear/editar la config desde el panel (queda enmascarada);
-- nunca escribir la clave literal en un SQL versionado.
INSERT INTO ai_engine_configs (provider, sdk_type, label, model_id, base_url, api_key_ref, is_active, model_type)
VALUES ('openrouter', 'openai_compatible', 'OpenRouter · typesafe jev-1.14', 'typesafe/jev-1.14',
        'https://openrouter.ai/api/v1', NULL, true, 'text')
ON CONFLICT (provider, model_id) DO NOTHING;

INSERT INTO ai_engine_applications
  (key, name, description, config_id, is_active, output_format, model_type,
   rate_limit, retry_config, metadata, ai_feature_category)
SELECT 'vex_classifier', 'Vex · clasificador de desempate',
       'Opinión tipada para desempatar; nunca reemplaza el texto de Vex.',
       c.id, true, 'json', 'text',
       '{"max_calls_per_turn": 3}',
       '{"timeout_ms": 800, "total_timeout_ms": 1200, "max_retries": 1}',
       '{"adapter": "auto", "criteria_version": "v1", "min_confidence": 0}',
       'text_generation'
FROM ai_engine_configs c
WHERE c.provider = 'openrouter' AND c.model_id = 'typesafe/jev-1.14'
ON CONFLICT (key) DO NOTHING;
```

### Cambiar de modelo sin deploy

- **Opción A, editar la config**: en la administración del motor, cambiar `model_id` de la config referenciada (afecta a toda app que use esa config). Cualquier config de OpenRouter creada desde el panel sirve tal cual: su clave literal es la que se usa.
- **Opción B, reapuntar** (recomendada): crear otra config con el modelo nuevo y cambiar el `config_id` de `vex_classifier`:

```sql
-- después de crear la config de 'openai/gpt-5-mini'
UPDATE ai_engine_applications
SET config_id = (SELECT id FROM ai_engine_configs WHERE provider = 'openrouter' AND model_id = 'openai/gpt-5-mini'),
    metadata = metadata || '{"adapter": "auto", "temperature": 0, "max_tokens": 20}'::jsonb,
    updated_at = now()
WHERE key = 'vex_classifier';
```

El servicio cachea la fila 30 s: el cambio se aplica solo en ese tiempo (o al instante con `invalidate()`). Con `adapter: 'auto'` el adaptador se elige solo según el modelo.

## Observabilidad

Span `verifier` (sin texto del usuario): `classifier_question`, `classifier_verdict`, `classifier_adapter` (`decisions` | `chat`), `classifier_model` (solo un id de catálogo `vendor/model[:variant]`; cualquier otra cosa se descarta en `redactTraceAttributes`), `classifier_degradation` y `duration_ms`. Motivos de degradación: `not_configured`, `inactive`, `no_model`, `adapter_unsupported`, `no_api_key`, `host_not_allowed`, `config_error`, `turn_cap`, `timeout`, `network_error`, `http_error`, `invalid_response`, `refusal`, `low_confidence`, `empty_input`.

## Evidencia

Specs sin red (cliente HTTP inyectado), corridos uno por invocación con config scratch `isolatedModules` (el `test:path` estándar murió por OOM del typecheck, ver nota):

```
src/ai-engine/vex-classifier.service.spec.ts               Tests: 44 passed, 44 total
src/ai-engine/observability/agent-trace.service.spec.ts    Tests: 18 passed, 18 total
src/ai-engine/tools/domains/capability-request.tools.spec.ts Tests: 19 passed, 19 total
```

Typecheck acotado (`tsc` con `files` = servicio, spec y `agent-trace.service.ts`): exit 0, 0 errores.

Casos nuevos cubiertos: `auto` + `typesafe/jev-1.14` → Decisions; `auto` + `openai/gpt-5-mini` → chat con `response_format`; `chat` forzado con `typesafe/*`; `decisions` forzado con modelo sin soporte → `adapter_unsupported`; adapter desconocido → `config_error`; JSON inválido → una reparación; dos inválidos (texto libre, valor fuera de criterio, claves extra) → `invalid_response`; refusal; 400 → sin `response_format`; `json_mode: false`; `model_id` vacío/espacios/null → `no_model`; origen de `base_url`; timeout/429/500 en ambos adaptadores; parámetros enviados solo en chat; redacción de la traza.

## Siguiente ciclo

- Conectar `isWritePromise` (preparado, sin uso).
- Si se quiere `min_confidence` con chat: pedir `logprobs` cuando el modelo lo admita.
- Opcional: exponer `adapter` y los parámetros en el modal de aplicaciones del motor (hoy `metadata` no lo edita el modal).

## Correcciones de la revisión (B1, B2, B3 y CI)

### Historia de usuario

Como **super admin** en la administración del motor de IA, quiero **apuntar el clasificador a cualquier config de OpenRouter del motor** para **cambiar de modelo sin deploy**, sin que **ninguna fila del motor pueda sacar secretos del servidor ni alcanzar la red interna**, y sin que **un modelo que falla alargue o encarezca el turno de Vex**.

Pasos en pantalla:
1. Motor de IA → Configuraciones → crear una config OpenRouter con la clave pegada en «API key» → al guardar, la clave sale enmascarada (`****abcd`).
2. Apuntar `vex_classifier` a esa config → en la traza `verifier` aparece `classifier_verdict` con un valor, no `no_api_key`.
3. Editar cualquier config y poner como URL base `http://169.254.169.254`, `https://localhost/v1` o `https://attacker.example.com/v1` → el formulario responde 400 «base_url is not allowed (…)» y no se guarda.
4. Con el modelo devolviendo 500 → Vex responde igual que con el clasificador apagado y el turno no tarda más de ~1,2 s por consulta.

Criterios de aceptación observables:
- Una config creada desde el panel funciona con el clasificador sin cambios.
- Ninguna URL base fuera de la lista se puede guardar; si ya existiera una en la fila, el clasificador no envía nada (`host_not_allowed`).
- Escribir `JWT_SECRET` en «API key» envía el texto `JWT_SECRET`, nunca el valor de la variable.
- Por turno, el clasificador no hace más POST que `max_calls_per_turn`; cada consulta termina dentro de `total_timeout_ms`.

### B1 — `api_key_ref` con la semántica del motor

- Antes: el clasificador leía `api_key_ref` como NOMBRE de variable de entorno; el motor (y el panel, que lo enmascara) como CLAVE literal.
- Ahora: una sola función, `resolveConfigApiKey` (`apps/backend/src/ai-engine/ai-config-security.ts`), usada por el motor (`AIEngineService.resolveApiKey`, mismo comportamiento: sus 68 specs siguen verdes) y por el clasificador: clave literal y, si está vacía, `AI_<PROVIDER>_API_KEY`.
- Diferencia documentada (no impuesta): la lectura «nombre de variable» evitaba guardar la clave en la tabla, que es más sano, pero partía la columna en dos significados. Se queda la del motor. Si algún día se quiere sacar la clave de la tabla, debe hacerse para todo el motor (p. ej. otro campo), no solo para el clasificador.
- Lecturas: el panel ya devuelve `api_key_ref` enmascarada en crear, listar, ver y editar (`maskApiKey`), y no hay `include` de la config en las lecturas de apps. El clasificador no registra ni traza la clave.

### B2 — SSRF y exfiltración de secretos

Servicio (`vex-classifier.service.ts`):
- Desaparece la lectura de variables con nombre arbitrario (`ENV_NAME`/`process.env[ref]`): la clave sale de la config del motor. El único nombre de variable posible es la plantilla fija `AI_<PROVIDER>_API_KEY` del motor.
- `base_url` solo con host en `VEX_CLASSIFIER_ALLOWED_HOSTS = ['openrouter.ai']`, https, puerto por defecto, sin credenciales; si no cumple → `host_not_allowed`, cero POST (antes caía en silencio a OpenRouter o usaba cualquier host https).
- `fetch` con `redirect: 'error'`: nunca sigue redirecciones.

DTO de superadmin (**cambio incluido en este PR, es parte del arreglo**): `CreateAIConfigDto.base_url` lleva `@IsAllowedAIBaseUrl()` y `UpdateAIConfigDto` lo hereda (`PartialType`). Regla `checkAiBaseUrl`:
- solo `https:`, sin usuario/contraseña, sin puerto distinto de 443;
- rechaza IP literal (v4/v6, incluidas formas decimales como `https://2852039166` que `URL` normaliza a `169.254.169.254`), `localhost`, nombres sin punto y sufijos `.localhost`, `.internal`, `.local`, `.localdomain`, `.lan`, `.home.arpa`;
- el host exacto debe estar en la lista permitida.

Decisión de seguridad — lista de hosts permitidos:
- Motor (DTO): `openrouter.ai`, `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.minimax.io`, `api.deepseek.com` (OpenRouter y los proveedores para los que el motor ya trae adaptador o URL por defecto). El despliegue puede añadir hosts exactos con `AI_ENGINE_ALLOWED_HOSTS` (separados por coma); la fila nunca. Los nombres privados se rechazan aunque estén en esa variable.
- Clasificador: solo `openrouter.ai` (sus rutas son las de OpenRouter, L1). Ampliarlo es un cambio de código a propósito.
- Sin resolución DNS: la lista solo tiene nombres públicos de proveedores; un rebinding exigiría controlar el DNS de esos dominios.
- **Cambio de comportamiento visible**: el DTO aceptaba `http://localhost:11434/v1` (Ollama local); ahora lo rechaza, tal como pide B2. Las filas existentes no se tocan (la validación es solo al crear/editar) y el motor las sigue cargando; si alguna usa un host fuera de la lista, editarla exigirá añadir ese host a `AI_ENGINE_ALLOWED_HOSTS` o quitar la URL. No revisé la base de prod: conviene listar `SELECT provider, base_url FROM ai_engine_configs WHERE base_url IS NOT NULL` antes del merge.

### B3 — tope y plazo reales

- Plazo total por llamada lógica (`retry_config.total_timeout_ms`, 1200 ms por defecto): cada POST usa como timeout el menor entre `timeout_ms` y el tiempo restante; agotado el plazo no se envía nada más (`timeout`).
- Cada POST (intento, reintento, reenvío sin `response_format` y vuelta de reparación) gasta un cupo de `max_calls_per_turn` antes de salir; sin cupo → `turn_cap`, sin enviar. Sin request id, la llamada es su propio turno: sigue acotada por el tope y el plazo.
- Peor caso por turno con valores por defecto: 3 POST y ≤ 1,2 s por consulta (antes: hasta 8 POST por consulta, 24 por turno, 6,4 s por consulta).
- También: el 400 a `response_format` se recuerda por modelo; un 200 con cuerpo no JSON es `invalid_response` sin reintento (L3); `null` en la configuración JSON cae al valor por defecto (M6); al superar 1000 turnos rastreados se borran los vencidos y luego los más viejos, nunca todos los contadores vivos.
- No se añadió `max_tokens` por defecto: en OpenRouter los tokens de razonamiento cuentan contra `max_tokens` y un valor pequeño puede dejar `content` vacío. Se fija por modelo en `metadata.max_tokens`.

### CI — typecheck de specs

- `capability-request.tools.spec.ts`: `withClassifier` comprueba que exista `handler` (opcional en `RegisteredTool`) y lo devuelve tipado; sin `any` ni `!`.
- `ai-chat.confirmation-reading.spec.ts`: `Object.assign` sobre la instancia ya tipada; su valor de retorno intersectaba los miembros privados de `AIChatService` y colapsaba a `never`.

### Evidencia

Specs (uno por invocación, config scratch `isolatedModules` + stub de `nodemailer`, porque el `node_modules/nodemailer` enlazado del checkout principal está vacío):

```
src/ai-engine/vex-classifier.service.spec.ts                         Tests: 68 passed, 68 total
src/domains/superadmin/ai-engine/dto/create-ai-config.dto.spec.ts    Tests: 22 passed, 22 total
src/ai-engine/tools/domains/capability-request.tools.spec.ts         Tests: 19 passed, 19 total
src/domains/store/ai-chat/ai-chat.confirmation-reading.spec.ts       Tests: 5 passed, 5 total
src/ai-engine/ai-engine.service.spec.ts                              Tests: 68 passed, 68 total
```

Specs nuevos que reproducen la revisión: `base_url` a `http://169.254.169.254`, `https://169.254.169.254`, `https://2852039166/`, `https://localhost`, `.internal`, IP privada, `[::1]`, host externo desconocido, proveedor no OpenRouter, http y otro puerto → `host_not_allowed`, 0 POST; `api_key_ref = 'JWT_SECRET'` → se envía el texto literal y el valor de `JWT_SECRET` no aparece en ninguna llamada; `provider = 'JWT_SECRET'` sin clave → `no_api_key`; modelo con 500 siempre → 3 POST en tres consultas del mismo turno (tope 3); la secuencia 429/400/…/200 inválido de la revisión → ≤ 3 POST; 500 lento con `total_timeout_ms: 150` → ≤ 2 POST y < 210 ms; modelo colgado con `timeout_ms: 5000` y `total_timeout_ms: 120` → `timeout` en < 180 ms con 1 POST; DTO rechaza las mismas URLs en crear y editar.

Typecheck:
- `npm run buildcheck:types` en este worktree termina en 10 s con un único `error TS2688: Cannot find type definition file for 'yauzl'` (la carpeta `@types/yauzl` del `node_modules` enlazado está vacía). Ese error global hace que `tsc` no compruebe nada más: es un falso verde, no evidencia.
- Mismo programa que `tsconfig.check.json` (mismo `include`) con `types` explícitos sin `yauzl`: 72 s, 3,7 GB, **6 errores, ninguno en archivos de este PR**, todos del `node_modules`/cliente Prisma compartido con el checkout principal: `@aws-sdk/client-sns` (2), `@aws-sdk/client-sqs`, `nodemailer`, `mailparser` no instalados, y `public_token` en `store_app_mediaWhereInput` (cliente Prisma generado desde otro schema; este PR no toca el schema). Los 12 errores de CI (TS2722 ×6, TS2339 ×6) ya no aparecen.
- Confirmación definitiva: el job «Typecheck de specs (buildcheck:types)» de CI, con instalación limpia, al publicar la rama.
