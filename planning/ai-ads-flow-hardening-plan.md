# Plan: Endurecer Flujos de IA en Creación de Anuncios

## Context

El wizard de creación de anuncios con IA en `apps/frontend/.../anuncio-create-wizard-page.component.ts` orquesta tres agentes: sugerencia de prompt (`marketing_ad_prompt_specialist`), generación de imagen (`marketing_ad_image_generator`) y redacción de post (`marketing_ad_post_copywriter`). Hoy presenta tres defectos confirmados por exploración: el sugeridor recomienda recursos NO seleccionados (ej. "agrega tu logo" cuando el logo no fue elegido), la generación de imagen recibe SKUs e IDs internos que podrían filtrarse en el render visual, y la redacción del post tiene tono de IA por defecto con emojis excesivos y poca voz profesional de marketing. Los tres defectos viven en los system prompts de `apps/backend/prisma/seeds/ai-engine-apps.seed.ts` y en `buildVariables` / `buildMarketingTextVariables` de `apps/backend/src/domains/store/marketing-ad-creatives/marketing-ad-creatives.service.ts`.

## General Objective

Endurecer los tres agentes de IA del wizard de anuncios para que respeten estrictamente los recursos seleccionados, nunca expongan datos internos del producto, y produzcan copys profesionales humanos en lugar de sonido genérico de IA.

## Specific Objectives

1. El agente `marketing_ad_prompt_specialist` recibe un inventario explícito de recursos disponibles (`available_resources_inventory`) y su system prompt prohíbe sugerir recursos no listados (logo, slider, QR, productos, custom).
2. El agente `marketing_ad_image_generator` deja de recibir SKU, IDs de producto e IDs de imagen en su contexto y su system prompt prohíbe explícitamente renderizar datos internos.
3. El agente `marketing_ad_post_copywriter` opera con un system prompt reescrito que impone voz de copywriter senior humano, máximo 1 emoji opcional, sin frases genéricas de IA, con ejemplos de "do/don't" en el template.
4. La seed re-ejecuta y actualiza los tres `ai_engine_apps` afectados sin recrear filas (idempotente vía upsert).
5. `buildVariables` y `buildMarketingTextVariables` quedan saneados: no concatenan SKU ni IDs hacia los modelos.
6. Pruebas manuales en wizard real confirman: sugeridor no menciona recursos no seleccionados, imagen generada no contiene SKU/ID visible, post no abre con "¡Descubre…!" ni se llena de emojis.

## Approach Chosen

**Defensa en profundidad: sanear datos en service + endurecer system prompts.**

- **Capa servicio:** `buildVariables` y `buildMarketingTextVariables` dejan de inyectar `SKU` e `id` en los strings de contexto que llegan al modelo. La info interna sigue persistiéndose en BD; solo no se envía al LLM.
- **Capa prompt (seed):** los tres system prompts se reescriben con reglas explícitas verificables: lista de recursos disponibles para el sugeridor, prohibición de exponer datos internos para imagen, reglas de tono profesional con ejemplos para post copy.
- **Inventario de recursos:** se agrega variable nueva `{{available_resources_inventory}}` al template del sugeridor que enumera literalmente ("Logo: SÍ/NO", "Slider: SÍ/NO", "QR tienda: SÍ/NO", "Productos seleccionados: N", "Recursos custom: N") basado en el conteo real de `dto.reference_images` y derivados.

`★ Insight ─────────────────────────────────────`
- **Defensa en profundidad:** sanear contexto en service evita filtrar SKU aunque el system prompt falle; el system prompt actúa como segunda barrera y mejora también el comportamiento creativo del modelo. Una sola capa nunca es suficiente con LLMs no deterministas.
- **Inventario explícito vs negación implícita:** decirle al modelo "no sugieras lo que no existe" funciona peor que entregarle una lista cerrada de lo que SÍ existe. Los LLMs respetan mejor enumeraciones positivas que prohibiciones abstractas.
- **Voz profesional vía ejemplos:** instrucciones tipo "tono profesional" son demasiado vagas; pares "EVITA / PREFIERE" con frases concretas guían el estilo de forma medible.
`─────────────────────────────────────────────────`

## Alternatives Considered

- **Solo editar system prompts sin sanear service:** rechazado. El LLM podría seguir filtrando SKUs si el contexto los incluye, especialmente en image gen donde el modelo puede transcribir literal texto del prompt. Defensa en profundidad es obligatoria.
- **Validación post-generación (filtrar emojis del post copy con regex):** rechazado como solución principal. Es frágil, no escala a otros idiomas de IA-sound, y trata el síntoma. La fuente está en el system prompt; arreglar ahí es más sostenible. Se puede sumar como red de seguridad futura si se requiere.
- **Mover lógica de recursos disponibles al frontend (que el frontend pase un string ya formateado):** rechazado. El backend ya tiene la info canónica de `reference_images` resueltas con `source_type`. Calcular ahí es más confiable y no duplica lógica.

## Critical Files

- `apps/backend/prisma/seeds/ai-engine-apps.seed.ts` — system prompts y templates de los tres ai_engine_apps de marketing (líneas 212–345)
- `apps/backend/src/domains/store/marketing-ad-creatives/marketing-ad-creatives.service.ts` — `buildVariables` (806–848), `buildMarketingTextVariables` (893–945), `productsContext` helper (947–963), `suggestPrompt` (198–234), `generatePostCopy` (860–891)
- `apps/frontend/src/app/private/modules/store/marketing/anuncios/pages/anuncio-create-wizard-page.component.ts` — solo verificación visual (sin edición); confirmar que el flujo no expone IDs en UI tras cambios backend

## Reusable Assets

- `apps/backend/src/ai-engine/ai-engine.service.ts` — `runApp` / `streamApp` ya soportan variables arbitrarias en template; no requiere extensión, basta con agregar la variable `available_resources_inventory` al objeto `variables` que se pasa.
- `apps/backend/prisma/seeds/run-seeds.ts` — runner de seeds idempotente existente, no requiere modificación, solo re-ejecutarlo.
- Helper interno `productsContext` (line 947) — se reusa modificándolo en sitio (eliminar SKU/ID), sin crear un helper paralelo.
- No se requieren componentes Angular nuevos; el cambio es 100% backend.

## Steps

1. **Sanear `buildVariables` y `buildMarketingTextVariables` para no enviar SKU ni IDs al LLM**
   Skills: vendix-backend-domain, vendix-ai-engine, vendix-ai-platform-core
   Resources: `npm run build -w apps/backend`
   Business decision: Datos internos del producto (SKU, IDs, image IDs) jamás se envían a un LLM externo. Solo nombre comercial, precio, descripción comercial. Aplica a los tres apps de IA de marketing.
   Why: Va primero porque sin sanear el contexto, cualquier cambio en system prompt sería bypaseable por el modelo (especialmente image gen, que puede transcribir texto literal). La capa de datos es la barrera dura; la prompt es la barrera blanda.
   Output: `productsContext()` ya no concatena ` | SKU: ${sku}` ni IDs. Las funciones devuelven strings con solo: índice, nombre, precio base, precio oferta, descripción corta. Comentarios en código solo donde la omisión sea no obvia.
   Verification: `grep -n "SKU:" apps/backend/src/domains/store/marketing-ad-creatives/marketing-ad-creatives.service.ts` devuelve cero resultados; `npm run build -w apps/backend` sale 0.

2. **Construir variable `available_resources_inventory` en `suggestPrompt`**
   Skills: vendix-backend-domain, vendix-ai-engine
   Resources: `npm run build -w apps/backend`
   Business decision: El sugeridor solo puede recomendar recursos efectivamente seleccionados por el usuario; nunca proponer logo si no fue añadido a la selección.
   Why: Necesita existir antes de actualizar el seed, porque el system prompt referenciará esta variable. Si no, el seed apuntaría a una variable inexistente.
   Output: En `suggestPrompt` (y donde aplique en `create()`/`streamGenerate()`), se computa un objeto/string `available_resources_inventory` con campos booleanos derivados de `reference_images.source_type`: `tiene_logo`, `tiene_slider`, `tiene_qr_tienda`, `productos_seleccionados` (count), `recursos_custom` (count), `qr_productos` (count). Se inyecta como variable adicional a `runApp`.
   Verification: Console.log temporal o test unitario rápido que confirme el shape correcto del inventario para un caso con logo seleccionado y otro sin. Quitar log antes de commit.

3. **Reescribir system prompt y template de `marketing_ad_prompt_specialist` (seed)**
   Skills: vendix-prisma-seed, vendix-ai-engine, vendix-ai-platform-core
   Resources: `npm run seed -w apps/backend` (o el comando equivalente del proyecto)
   Business decision: El sugeridor opera sobre un inventario cerrado. Está prohibido sugerir "agregar logo", "incluir slider", "usar QR de tienda", etc., si el campo correspondiente del inventario es `false`.
   Why: Va después de paso 2 porque depende de que la variable `available_resources_inventory` exista en runtime. Va antes del paso de imagen/post porque el sugeridor produce el prompt que alimenta los otros agentes; corregirlo primero corrige aguas abajo.
   Output: En `ai-engine-apps.seed.ts` líneas 257–296, el system prompt incluye párrafo explícito: "Solo puedes referenciar recursos listados en 'Recursos disponibles'. Si un recurso aparece como NO, jamás sugieras agregarlo, incluirlo, ni mencionarlo en el prompt visual. Si el usuario no tiene logo seleccionado, el diseño no menciona logo." El template incorpora bloque `Recursos disponibles:\n{{available_resources_inventory}}` antes de `Brief`.
   Verification: Re-ejecutar seed; consultar SQL `SELECT system_prompt FROM ai_engine_apps WHERE app_key='marketing_ad_prompt_specialist';` y validar que contiene la nueva cláusula. Prueba manual: en el wizard, con solo brief y un producto (sin logo seleccionado), la sugerencia no debe mencionar logo.

4. **Reescribir system prompt y template de `marketing_ad_image_generator` (seed)**
   Skills: vendix-prisma-seed, vendix-ai-engine
   Resources: `npm run seed -w apps/backend`
   Business decision: La imagen jamás renderiza SKUs, IDs internos, códigos de producto, ni nombres de variables internas. Si aparece texto en la pieza, solo es nombre comercial, precio (si la intención lo amerita), CTA y nombre de tienda.
   Why: Va después del paso 1 (datos saneados) y antes de validación E2E. Refuerza la prohibición a nivel modelo aunque ya esté saneado el contexto.
   Output: Líneas 212–255 del seed: system prompt agrega: "Nunca incluyas en la imagen códigos SKU, identificadores numéricos, claves internas, ni textos como 'ID', 'SKU', 'product_id', 'cod_', 'ref_'. Si el contexto sugiere algún identificador, ignóralo. El texto visible se limita a nombre comercial del producto, precio si aplica, CTA y nombre de tienda."
   Verification: Re-ejecutar seed; validar prompt en DB. Prueba manual: generar 2 imágenes; revisar visualmente que no aparezca ningún texto tipo SKU/código.

5. **Reescribir system prompt y template de `marketing_ad_post_copywriter` (seed) con voz profesional + restricción de emojis**
   Skills: vendix-prisma-seed, vendix-ai-engine
   Resources: `npm run seed -w apps/backend`
   Business decision: El post tiene voz de copywriter senior humano enfocado en ventas, no de asistente de IA entusiasta. Máximo 1 emoji y solo si aporta semánticamente (ej. 📍 para ubicación). Cero apertura tipo "¡Descubre…!", "¡No te pierdas…!", "🚀". Hashtags solo si encajan en la marca, máximo 3.
   Why: Es el último cambio de prompt porque es el más subjetivo y requiere iteración manual sobre resultados; los otros dos son más mecánicos.
   Output: Líneas 308–344 del seed: system prompt reescrito con secciones explícitas:
   - "ROL: copywriter senior de marketing humano, no asistente de IA."
   - "TONO: profesional, directo, comercial. Como un impulsador de ventas que conoce el producto."
   - "EVITA: emojis decorativos, exclamaciones múltiples, frases genéricas ('descubre', 'no te pierdas', 'imperdible', '¡llegó!'), hashtags decorativos, mayúsculas enfáticas."
   - "PERMITE: 0–1 emoji funcional, máximo 3 hashtags relevantes a la marca/categoría, llamados a acción claros y específicos."
   - Bloque "EJEMPLOS:\nEVITA: '¡Descubre nuestro increíble producto! 🚀✨🎉 #imperdible #love #venta'\nPREFIERE: 'Nueva línea disponible en tienda. Diseño minimalista, precio competitivo. Pasa esta semana.'"
   Verification: Re-ejecutar seed; validar prompt en DB. Prueba manual: generar 3 posts de distintos productos; ninguno debe abrir con exclamación + emoji ni superar 1 emoji total.

6. **Verificación integral del wizard real**
   Skills: buildcheck-dev, vendix-frontend
   Resources: `docker compose logs -f vendix-backend | grep -E "marketing_ad_(prompt_specialist|image_generator|post_copywriter)"`; navegador en `http://localhost:4200/private/store/marketing/anuncios/crear`
   Business decision: Solo se considera el cambio completo si los tres escenarios pasan en el wizard real con tienda con datos reales. Si alguno falla, retroceder al paso correspondiente, no replanificar.
   Why: Cierra el ciclo end-to-end. Los pasos 3–5 verifican prompt a nivel DB; este paso verifica salida del modelo en condiciones de uso real.
   Output: Tres casos validados:
   (a) Wizard sin logo seleccionado → sugerencia no menciona logo.
   (b) Inspección de imagen generada → sin SKU/ID renderizado.
   (c) Post copy → tono profesional, ≤1 emoji, sin "¡Descubre…!".
   Verification: Documentar en chat los 3 outputs reales generados con screenshots o copia del texto. Si alguno falla, fix iterativo del prompt del agente correspondiente.

## End-to-End Verification

1. **Build backend:** `npm run build -w apps/backend` sale 0.
2. **Seed idempotente:** `npm run seed -w apps/backend` corre sin errores; query `SELECT app_key, length(system_prompt) FROM ai_engine_apps WHERE app_key LIKE 'marketing_ad_%';` muestra los tres apps con system_prompt actualizado (longitud mayor que el actual).
3. **Wizard E2E manual:** flujo completo crear anuncio con tienda de prueba que NO tiene logo configurado en branding. Pasos:
   - Step 0: brief "promo producto X"
   - Step 1: seleccionar 1 producto, NO seleccionar logo ni slider
   - Step 2: pulsar "Sugerir anuncio" → leer la sugerencia → verificar que NO menciona logo
   - Step 2: generar imagen → inspeccionar visualmente → verificar que no aparece SKU ni código
   - Step 3: leer post copy → verificar tono profesional, ≤1 emoji, sin apertura genérica
4. **Logs backend:** `docker compose logs vendix-backend | grep "marketing_ad_prompt_specialist"` muestra que la variable `available_resources_inventory` se pasa correctamente al modelo.
5. **Grep de regresión SKU:** `grep -rn "SKU:\|product\.id\|product_id" apps/backend/src/domains/store/marketing-ad-creatives/marketing-ad-creatives.service.ts | grep -i "context\|prompt\|variables"` no debe mostrar inyección de IDs/SKUs hacia el LLM (sí puede aparecer en lógica DB).

## Knowledge Gaps

None.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
