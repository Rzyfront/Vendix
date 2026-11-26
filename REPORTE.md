# Reporte: clasificador de desempate de Vex (`vex_classifier`)

Rama `feat/vex-clasificador` (base `origin/develop` @ b2f40f016). Spec: `odd/tasks/vex-clasificador.md`. Sin push ni PR.

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
- Garantías sin cambios en ambos: timeout por llamada (`retry_config.timeout_ms`, 800 ms por defecto, 100–5000), máximo 1 reintento en 429/5xx/timeout/red, tope por turno (`rate_limit.max_calls_per_turn`), fail-closed (`unavailable`, nunca lanza), nunca reemplaza el texto de Vex.
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

Modelo y proveedor salen siempre de `ai_engine_configs` (fila de `config_id`). `base_url` es opcional: solo se usa su origen https (por defecto `https://openrouter.ai`); la ruta la pone el adaptador. `api_key_ref` es el NOMBRE de la variable de entorno; la clave nunca va en la tabla.

> Ejemplo para un entorno nuevo. Cambios en DB de staging/prod van por el flujo del motor (super admin) o por migración versionada, nunca SQL manual.

```sql
INSERT INTO ai_engine_configs (provider, sdk_type, label, model_id, base_url, api_key_ref, is_active, model_type)
VALUES ('openrouter', 'openai_compatible', 'OpenRouter · typesafe jev-1.14', 'typesafe/jev-1.14',
        'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', true, 'text')
ON CONFLICT (provider, model_id) DO NOTHING;

INSERT INTO ai_engine_applications
  (key, name, description, config_id, is_active, output_format, model_type,
   rate_limit, retry_config, metadata, ai_feature_category)
SELECT 'vex_classifier', 'Vex · clasificador de desempate',
       'Opinión tipada para desempatar; nunca reemplaza el texto de Vex.',
       c.id, true, 'json', 'text',
       '{"max_calls_per_turn": 3}',
       '{"timeout_ms": 800, "max_retries": 1}',
       '{"adapter": "auto", "criteria_version": "v1", "min_confidence": 0}',
       'text_generation'
FROM ai_engine_configs c
WHERE c.provider = 'openrouter' AND c.model_id = 'typesafe/jev-1.14'
ON CONFLICT (key) DO NOTHING;
```

### Cambiar de modelo sin deploy

- **Opción A, editar la config**: en la administración del motor, cambiar `model_id` de la config referenciada (afecta a toda app que use esa config).
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

Span `verifier` (sin texto del usuario): `classifier_question`, `classifier_verdict`, `classifier_adapter` (`decisions` | `chat`), `classifier_model` (solo un id de catálogo `vendor/model[:variant]`; cualquier otra cosa se descarta en `redactTraceAttributes`), `classifier_degradation` y `duration_ms`. Motivos de degradación: `not_configured`, `inactive`, `no_model`, `adapter_unsupported`, `no_api_key`, `config_error`, `turn_cap`, `timeout`, `network_error`, `http_error`, `invalid_response`, `refusal`, `low_confidence`, `empty_input`.

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
