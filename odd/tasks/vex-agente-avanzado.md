# Vex Plus — Vex como agente de operaciones de nivel ChatGPT/Claude web (análisis y plan)

Objetivo: llevar al agente **Vex** a capacidad agéntica de nivel web: una interfaz de chat de nivel profesional, lotes de escritura con una sola confirmación, skills y centro de ayuda con búsqueda vectorial, visualización y análisis con código, aprendizaje con video en el chat, contexto visible con compactación, memoria por tienda, voz y multimodal. Desde las decisiones del 2026-11-20 incluye además el **gobierno de IA de los dos agentes (Vex y Vexi)**: configuración agéntica solo en superadmin y, por plan, únicamente activar o desactivar el agente y sus capacidades y fijar cupos de mensajes, tokens y voz. El plan **no restringe herramientas** (N4): las limita el rol del usuario. La **voz en tiempo real sale del alcance** (N5): la voz es solo la lectura de cada respuesta por API.
Rama: ninguna todavía (documento de análisis, solo lectura). Entrega propuesta: `stacked-to-main` sobre `develop`, slices de ~400 líneas, una fase = una cadena de PR. Runner: `npm run test:path -w apps/backend -- src/<ruta>.spec.ts` (un spec por invocación); frontend se verifica con Playwright MCP contra el vhost (`ng test` está prohibido).
Estado: **plan actualizado con las decisiones D1–D8 y N1–N6 de Rafael (2026-11-20), pendiente de su aprobación para ejecutar**. Quedan 5 decisiones nuevas abiertas (N7–N11, §7), ninguna bloquea el arranque de la fase 1. Fuera de alcance: `apps/mobile` y la voz en tiempo real (se agregará en el futuro). Vexi entra **solo** en su configuración y sus capacidades por plan (F2), en el retiro de su voz en tiempo real (T17) y en el catálogo de voces (F8); el resto de sus funciones no cambia.

> Convención de evidencia: `BE` = `apps/backend`, `AE` = `apps/backend/src/ai-engine`, `FE` = `apps/frontend/src/app`, `VEX` = `FE/private/modules/store/vex`. Líneas tomadas de `develop` @ `e17e409e4` (2026-11-20); pueden moverse con cada merge. Evidencia levantada por exploradores de solo lectura (tres en el análisis inicial, uno más para §1.13 y §1.14, y tres más para §1.15, §1.16 y §1.17) y verificada por muestreo directo en los puntos que deciden el diseño (marcados ✔).

---

## 0. Resumen ejecutivo (no técnico)

1. Vex ya es un agente serio: opera más de 300 acciones del negocio, pide permiso antes de escribir, dibuja tablas y gráficos y recuerda tareas largas. No partimos de cero; partimos de ~60 %.
2. Lo que hoy lo frena frente a ChatGPT/Claude: una interfaz apretada y poco expresiva, pide permiso **cambio por cambio**, olvida lo que pasó hace más de 20 mensajes, no "ve" las imágenes, no conoce el centro de ayuda ni los videos y no recuerda las preferencias de la tienda.
3. El plan queda en **9 fases y 53 tareas**. Rafael ya tomó 14 decisiones (D1–D8 y N1–N6, §7).
4. **Fase 1, la interfaz de Vex a nivel «muy pro» (N6)**: es lo que más se ve y lo que menos riesgo tiene, y no depende de nada más. Al entrar, los paneles laterales están contraídos y el chat ocupa la pantalla; las conversaciones se guardan bien, se pueden **renombrar** y **borrar de verdad** (sin dejar copia); Vex detecta solo cuándo conviene guardar un recordatorio o una nota de bitácora y lo ofrece con un clic; se ve cuándo Vex está **escuchando**, **pensando**, **hablando** o **en silencio**; y los textos, sugerencias y ayudas quedan ordenados con el estilo de Vendix.
5. **Fase 2, ordenar la casa**: (a) toda la configuración agéntica de Vex y de Vexi (modelo, proveedor, voz) se maneja **solo desde superadmin**; en la tienda quedan únicamente los interruptores «Usar Vex» / «Usar Vexi», el historial de cambios y conversaciones y la memoria de la tienda; (b) el plan deja de ser un enredo de 8 claves: por agente solo **enciende o apaga** el agente y sus capacidades y fija **cupos de mensajes, tokens y voz**. Sin excepciones por tienda; (c) el plan **no restringe herramientas**: Vex tiene todas activas y lo que limita cada acción son los **permisos del rol** del usuario, validados en cada herramienta; (d) se **retira la voz en tiempo real** de Vex y de Vexi: la voz es la lectura de cada respuesta por API.
6. **Escritura en lote** (aprobada): Vex prepara todos los cambios, los muestra en una vista previa y los aplica con una sola confirmación, máximo 25 pasos. Lo irreversible (anular, eliminar, enviar campaña, emitir a la DIAN) sigue con su propia tarjeta. Si algo falla: «se aplicó hasta el paso N, el resto se omitió», con deshacer donde exista.
7. **Aprender con Vex**: busca en posts y videos, pregunta «¿video o paso a paso?», lo recuerda y arma rutas con un reproductor dentro del chat. Los videos **no se transcriben**: se buscan por el texto que ya tiene su publicación.
8. **Skills en base de datos**: las guías de «cómo se hace X en Vendix» se editan desde superadmin, con historial de versiones y auditoría, y Vex las encuentra por significado.
9. **Memoria por tienda**: Vex guarda preferencias de la tienda, como un bloc de notas corto que se carga en todas las conversaciones de esa tienda. El dueño la ve en la configuración de la tienda y puede **editarla y borrarla** libremente.
10. **Análisis con código (Python)**: corre en una función aislada de AWS, **no** en los servidores de Vendix. Motivo: nuestros servidores tienen acceso a los datos de todas las tiendas, y ahí no se ejecuta código escrito por una IA.
11. Costo de operación: centavos de dólar por conversación; el gasto fuerte es el modelo de lenguaje. Sin voz en tiempo real desaparece la única voz cara: leer una respuesta cuesta alrededor de un centavo.
12. Esfuerzo total estimado: **≈ 39–43 semanas-dev** (1 dev senior); con 2 devs, ≈ 5,5–6 meses. Frente a la versión anterior (34–38) sube ~5,5: la interfaz nueva (+6, de las que 1 ya estaba como «pulido del chat»), la validación por rol, el retiro seguro de la voz en tiempo real y el historial en la tienda (+3), menos lo que se elimina: excepciones por tienda, selector de herramientas del plan y voz en vivo (−2,5). Cada fase se puede entregar sola.
13. Quedan **5 decisiones nuevas** abiertas (N7–N11 en §7), todas con recomendación; ninguna bloquea el arranque de la fase 1.

---

## Historia de usuario

**Como** dueño o administrador de una tienda en el panel web (`/admin/vex`),
**quiero** pedirle a Vex trabajos completos —operar, analizar, aprender— en un chat claro y cómodo, y que los resuelva de principio a fin con una sola aprobación, mostrando gráficos, documentos y videos en el mismo chat,
**para** operar mi negocio conversando, sin entrar pantalla por pantalla ni repetir lo que ya le dije.

Pasos en pantalla (recorrido de prueba de punta a punta):
1. Abro `/admin/vex`: los dos paneles laterales (chats y bitácora) están **contraídos** y el chat ocupa el centro. Veo sugerencias que tienen que ver con mi tienda y un enlace «¿Cómo funciona Vex?».
2. Empiezo a escribir: el distintivo de Vex muestra que **está escuchando**. Envío y cambia a **pensando**; cuando responde, el texto aparece y, si pulso el altavoz, el distintivo muestra que **está hablando** y resalta el mensaje que lee. Al terminar vuelve a **silencio**. Ya no existe el botón «Voz en vivo».
3. Escribo «el viernes tengo que llamar a la distribuidora por el pedido atrasado». Debajo de la respuesta aparece «Recordatorio sugerido: Llamar a la distribuidora · viernes 9:00» con **Guardar**, **Editar** y **No**. Pulso Guardar y el recordatorio aparece en la bitácora sin escribir nada más.
4. Abro el panel de chats, le cambio el nombre a la conversación y recargo la página: sigo en la misma conversación, con el nombre nuevo. Borro otra conversación: un aviso me dice cuántos mensajes y archivos se borrarán y que no se puede deshacer; al confirmar desaparece y no vuelve al recargar.
5. Escribo: «Sube 5 % el precio de las bebidas, etiqueta como VIP a los 12 clientes que más compraron este mes y crea la orden de compra de lo que está bajo mínimo». Veo **una** tarjeta "Plan de cambios" con los tres grupos y cada cambio (antes → después). Desmarco uno, pulso **Aprobar todo**.
6. Veo el avance paso a paso y un resumen final: aplicados, fallidos y qué se puede deshacer.
7. Escribo «¿Cómo me fue frente al mes pasado?» y veo una gráfica de líneas, una torta por categoría y una tabla que puedo ordenar y exportar.
8. Arrastro la foto de una factura de proveedor: Vex la describe, me propone guardarla en la orden de compra #123 y, al aprobar, aparece en la ficha de esa orden.
9. Escribo «Quiero aprender a hacer un cierre de caja». Vex pregunta «¿Video o paso a paso?»; elijo video y aparece un reproductor con la ruta de 3 videos. Lo minimizo, sigo chateando y el video sigue sonando.
10. Al día siguiente, yo u otro administrador de la tienda pedimos aprender otra cosa: Vex ya no pregunta el formato, porque lo guardó en la memoria de la tienda. En Ajustes → Agentes IA → «Memoria de la tienda» veo cada recuerdo y puedo **editarlo** o **borrarlo**.
11. Tras una conversación larga veo el indicador «Contexto 82 %» y luego el aviso «Resumí la conversación anterior»; Vex sigue recordando lo acordado.
12. En Ajustes → Agentes IA de la tienda ya no hay «modo de voz» ni ningún ajuste técnico: solo los interruptores «Usar Vex» y «Usar Vexi» (con el motivo si el plan no lo incluye), el historial de cambios y conversaciones y la memoria de la tienda.
13. Un administrador cuyo rol no tiene permiso para anular órdenes le pide a Vex anular una: Vex responde «tu rol no permite anular órdenes» y no muestra tarjeta de confirmación. El dueño pide lo mismo y sí ve la tarjeta.

Recorrido del equipo Vendix (rol superadmin, en el panel de superadmin):
1. En IA → Agentes abro la ficha de Vex: veo y cambio su modelo, proveedor y voz en una sola pantalla; escucho la voz antes de guardar. Lo mismo, por separado, para Vexi. No existe «modo de voz» ni «voz en vivo».
2. En Suscripciones → Planes abro un plan y veo dos tarjetas, Vex y Vexi, cada una con el interruptor del agente, sus capacidades (encendida / apagada) y sus cupos de mensajes, tokens y voz; no hay selector de herramientas, ni cupo de acciones, ni excepciones por tienda; al final leo un resumen en texto de lo que recibe la tienda.
3. En IA → Skills edito la guía «Cierre de caja», la publico y veo el historial de versiones con su autor.

Criterios de aceptación observables: los de cada fase en §4. Lo técnico va debajo.

---

## 1. Diagnóstico del estado actual

### 1.1 Arquitectura

- Vex **no tiene chat propio**: es la fila `vex` de `ai_agents` + la app `vex_assistant`, y conversa por `store/ai-chat` con `agent_key='vex'` (`BE/prisma/seeds/ai-agents.seed.ts:51-55`). El prompt se edita en superadmin sin deploy (`BE/prisma/migrations/20261001120000_vex_agent_registration/migration.sql:77`).
- Motor: `AIEngineService` (`AE/ai-engine.service.ts`, ~2700 líneas) y `AIAgentService` con el bucle ReAct (`AE/ai-agent.service.ts:1370`, `while` en `:2055`). Presupuesto de Vex: 40 iteraciones / 300 s, ampliable a 60 / 600 s con plan abierto (`:144-147`); topes duros 60 / 600 s (`:154,164`).
- Acceso: solo OWNER/ADMIN, con `settings.vex.enabled === true` (default `false`) y la feature de plan `vex_agent` (`BE/src/domains/store/ai-chat/ai-chat.service.ts:1336-1358`; `FE/core/guards/vex-access.guard.ts:19-48`).
- Frontend: página completa `/admin/vex` de tres columnas (chats, hilo, bitácora), estado en signals (`VexChatStore`, 2064 líneas, `FE/private/modules/store/vex/state/vex-chat.store.ts:353-409`). Transporte, voz y tarjeta de confirmación se reutilizan de Vexi (`FE/core/services/vexi-*`, `FE/shared/components/vexi-dock/`).
- Tareas largas: objetivos durables con plan, presupuesto, lease y verificación (`ai_agent_objectives`, `BE/prisma/schema.prisma:7221`; `AE/tasks/agent-durable-session.service.ts`); tools `propose_plan`, `update_plan_step`, `verify_deliverables`, `ask_user`, `pause_plan`, `resume_plan` (`AE/interfaces/agent-plan.interface.ts:77-85`).

### 1.2 Modelos y proveedores

- Tres `sdk_type`: `openai_compatible` (OpenAI y OpenRouter, con ramas propias de imagen/video/STT), `anthropic_compatible` y `minimax_t2a` (`AE/interfaces/ai-provider.interface.ts:5-8`; selección en `AE/ai-engine.service.ts:197-205`). No hay adaptador Gemini propio.
- Configuración en BD y superadmin: `ai_engine_configs` (`schema.prisma:6877`), `ai_engine_applications` (`:6901`), `ai_agents` (`:6954`). Ventana de contexto en `settings.agent_context_window_tokens`, default 32 768 (`ai-engine.service.ts:896-898`).
- **Sin fallback entre proveedores**: solo reintentos por app (`ai-engine.service.ts:570-574`).
- Prompt caching solo con Anthropic (`AE/providers/anthropic-compatible.provider.ts:434,556,631`).

### 1.3 Tools

- ~339 tools declaradas, ~136 de escritura con confirmación (conteo por grep, aproximado), en casi todos los dominios; además un puente genérico `list_endpoints` / `call_endpoint` / `write_endpoint` (`AE/tools/bridge/api-bridge.tools.ts:758-767`).
- Descubrimiento híbrido (léxico + vectorial + RRF) con working set de 30 tools y `search_tools` (`AE/tools/tool-working-set.ts:11-29`; `AE/tools/tool-router.service.ts:566-615`).
- Vex deniega las 25 tools `ui_*` (`ai-agents.seed.ts:58-81`) y tiene 7 tools propias de bloques (`AE/tools/domains/vex-blocks.tools.ts:44-459`).
- Contrato de resultados y recuperación acotada: `ToolExecutionStatus` (`AE/tools/interfaces/tool.interface.ts:7-14`), `AgentRecoveryService` (`AE/tasks/agent-recovery.service.ts`).

### 1.4 Confirmaciones de escritura

- Toda escritura pasa por `enforceConfirmation` (`AE/tools/ai-tool-registry.ts:608`): permisos → validación → `preview()` → token de un solo uso en Redis, TTL 300 s, atado a usuario, tool, argumentos, hash del preview, organización, tienda y versión (`BE/src/domains/store/vexi/vexi-confirmation.service.ts:24-130`).
- **Una escritura por aprobación, a propósito** ✔: el bucle propone solo la primera escritura del turno y marca las demás `deferred: true` (`AE/ai-agent.service.ts:3935-3946`); `PlanApprovalService.approvePlan` cubre un único paso con el comentario «never grants a batch of writes» (`BE/src/domains/store/vex/services/plan-approval.service.ts:271-273`). El skill de la casa lo fija como regla: «never restore multi-write collection» (`skills/vendix-vex-agent/SKILL.md`, sección *One write per approval*).
- La infraestructura de plan de N pasos **sí existe**: token de plan (TTL 900 s), redención por paso con Lua, hashes por paso, reconfirmación de irreversibles (`plan-approval.service.ts:14,104-131,743-760`). El frontend ya pinta planes de varios pasos (`FE/.../vex/components/vex-plan-card/vex-plan-card.component.ts:155-251`).
- Idempotencia parcial: `ai_agent_effects` registra la intención antes de despachar, con `operation_id` único (`schema.prisma:7288-7313`); el propio esquema advierte que no es exactly-once (`:7287`).
- **No existe** transacción multi-escritura, compensación ni deshacer.
- Lotes dentro de una tool sí existen (p. ej. `tag_customers` con hasta 200 clientes, `odd/tasks/qui-1042-vex-crm.md` S8): cuentan como una escritura.

### 1.5 Bloques visuales

- Seis tipos: `table`, `chart`, `kpi`, `image`, `file`, `markdown` (`BE/src/domains/store/vex/services/vex-block.service.ts:21-28`; `FE/.../vex/vex.models.ts:3-9`). Gráficos: `bar|line|pie|doughnut|area|radar|scatter|gauge` con ECharts (`FE/.../vex-blocks/vex-block-chart.component.ts:169-256`).
- Persistentes y consultables por el agente: `ai_ui_blocks` (`schema.prisma:7141`), `vex_block_read`, `vex_block_transform` (filtra, agrupa, agrega). Límites: 5000 filas por bloque, 100 bloques por conversación (`vex-block.service.ts:31-39`).
- El despachador es un `@switch` rígido: un tipo desconocido no pinta nada (`FE/.../vex/components/vex-thread/vex-thread.component.ts:60-85`).
- **No existen** línea de tiempo, listas/tarjetas, gráfico de rosa, combinados ni exportación del bloque. Existe `app-timeline` compartido sin usar en Vex (`FE/shared/components/timeline/`).

### 1.6 Voz (lo que hay realmente)

- Dos motores, elegidos por tienda con `vexi.voice_engine` (default `pipeline`, `BE/src/domains/store/settings/defaults/default-store-settings.ts:631`):
  - **Pipeline** STT → LLM → TTS: STT con la app `vexi_voice_stt` (`gpt-4o-mini-transcribe`), TTS con `vexi_voice_tts` (`gpt-4o-mini-tts`, voz `shimmer`) (`BE/prisma/migrations/20260806140000_vexi_voice_pipeline_apps/migration.sql:92,109`; `BE/src/domains/store/vexi/vexi-speech.service.ts:24-25`).
  - **Realtime** voz a voz por WebRTC directo del navegador al proveedor; el backend solo emite el `client_secret` (`BE/src/domains/store/vexi/vexi-realtime.service.ts:50,225-290`). Respaldo en código: `gpt-realtime-2.1`, voz `marin`, base de OpenAI (`:51-53`).
- Proveedores cableados: OpenAI-compatible (STT, TTS, realtime) y **MiniMax T2A solo para TTS** (`AE/providers/minimax-speech.provider.ts:56`). Rafael acertó en los dos nombres; el matiz es que el modelo y la voz **sí** son configurables en superadmin (`ai_engine_configs.model_id`, `settings.voice`), y lo fijo en código son los respaldos y la **forma** del protocolo realtime (solo OpenAI).
- Existe la abstracción `AIProvider.generateSpeech/transcribeAudio` (`ai-provider.interface.ts:475-512`); el realtime no pasa por ella.
- Deuda: la app `vexi_realtime_voice` quedó apuntando a MiniMax, que no hace realtime, por eso el default es `pipeline` (`vexi-realtime.service.ts:923-950`).
- Vex no tiene voz propia: usa los servicios de Vexi y el motor se elige en la pestaña de Vexi (`FE/.../settings/vexi/vexi-settings.component.ts:83,310-324`). El usuario no elige voz.
- Medición: segundos de realtime contra `monthly_voice_seconds_cap` (`vexi-realtime.service.ts:785-795`).
- **Decisión N5 (2026-11-20)**: el motor **realtime se retira** de Vex y de Vexi; queda solo el pipeline (dictado + lectura de la respuesta por API). El inventario exacto de lo que existe y cómo se retira está en §1.16.

### 1.7 Adjuntos y multimodal

- **Subir archivos ya está habilitado en la UI**: botón, pegar y arrastrar, 5 archivos de 15 MB (`FE/.../vex/components/vex-composer/vex-composer.component.ts:25-26,94-104`).
- Desajuste: el frontend acepta `image/*,.pdf,.csv,.xlsx,.xls,.txt` y 15 MB; el backend solo imágenes y PDF hasta 10 MB (`BE/src/domains/store/vexi/vexi-attachments.service.ts:14-24`). CSV/XLSX fallan al subir.
- **El modelo nunca ve la imagen**: el historial es `{role, content: string}` (`ai-chat.service.ts:2107-2118`) y el presupuesto de contexto rechaza partes multimodales (`AE/context/agent-context-budget.ts:27` ✔). La vía actual es la tool `ai_extract_document`, que corre apps de visión por tipo de documento (`AE/tools/domains/ai-toolbox.tools.ts:49`).
- El contrato de mensajes ya admite `image_url` e `input_audio` (`ai-provider.interface.ts:20-40`).
- Guardar y asociar: `ai_attachments` tiene `linked_entity_type/id` (`schema.prisma:7167`) y existe el módulo documental `stored_files` + `dossiers` con `subject_type` genérico (`:16013,16042`), pero **no hay** tool ni endpoint para asociar un archivo a cliente u orden de venta; solo órdenes de compra tienen adjuntos propios (`purchase_order_attachments`, `:4356`).
- No hay visor de PDF en el frontend; el bloque `file` es un enlace de descarga.

### 1.8 Memoria

- Memoria procedimental (recetas): `ai_agent_recipes`, minadas de objetivos verificados, con revisión humana para ser globales (`schema.prisma:14891`; `AE/memory/`).
- Bitácora de recordatorios (`create_reminder`).
- **No existe** memoria de preferencias ni de hechos del usuario o la tienda.

### 1.9 Contexto

- Historial enviado: últimos 20 mensajes, solo texto (`ai-chat.service.ts:214,2106` ✔). Los `tool_calls` persistidos no vuelven al modelo.
- `ai_conversations.summary` existe pero nadie la escribe ni la lee ✔. No hay resumen ni compactación del historial; solo se omite prosa antigua (`agent-context-budget.ts:62-137`) y se compactan resultados de tools > 6000 caracteres a referencias paginables.
- El motor calcula `context_budget` y lo pone en el frame `done` (`ai-engine.service.ts:793,1023` ✔), pero el frontend no lo lee: `chunk.usage` está declarado sin consumidor (`FE/.../vex/services/vex-api.service.ts:227-231`).
- `ai_messages.cost_usd` se guarda en 0 (`ai-chat.service.ts:544`).

### 1.10 Conocimiento, skills y centro de ayuda

- pgvector instalado, `vector(1536)` con HNSW (`BE/prisma/migrations/20260326030000_add_ai_embeddings/migration.sql`), modelo `text-embedding-3-small`.
- Namespace global de conocimiento (`knowledge_scope='global'`) con tipos `tool | skill | process | recipe` (`AE/tools/tool-catalog.ts:12`). Hoy se pueblan `tool`, `process` y `recipe` (`AE/tools/tool-catalog-indexer.service.ts:78,178` ✔); **`skill` está declarado y vacío**.
- 23 playbooks en `AE/playbooks/content/*.md`, cargados en el arranque, buscables con `search_playbooks` / `load_playbook` a través del índice híbrido (`AE/playbooks/playbook.service.ts:88` ✔). Máximo 2 activos y 2000 tokens.
- Centro de ayuda: `help_articles` (`schema.prisma:7434`) y `videos` (`:7494`, fuentes `YOUTUBE|VIMEO|LOOM|DIRECT_S3`). Búsqueda por palabras, no vectorial. Los artículos se excluyen **a propósito** de los embeddings por tienda (`AE/embeddings/embedding-events.listener.ts:22-29` ✔); el motivo (duplicar un vector por tienda) ya no aplica porque hoy existe el namespace global.
- **No existen** series ni rutas de videos, transcripciones de video, vínculo artículo ↔ video, ni tool de Vex sobre ayuda o videos. Tampoco hay indexación semántica de videos.
- **Texto que ya tiene cada publicación de video** (base de D4): `title` (255), `summary` (500), `description` (texto libre, opcional), `tags[]`, `keywords[]`, `module` y la categoría (`video_categories`: `name`, `description`) (`schema.prisma:7480,7494-7524`; DTO en `BE/src/domains/superadmin/video-library/dto/create-video.dto.ts:30-87`). Los artículos tienen además `content` completo (`:7434`).
- **Skills en base de datos: no existen.** Los playbooks son archivos del release; lo más parecido en BD son las recetas (`ai_agent_recipes`) y el conocimiento global `ai_knowledge_documents` (`:7364`), que es «release-owned».
- Reutilizable: `app-video-player` (HTML5 e iframes, `FE/.../video-library/components/video-player/video-player.component.ts:17-145`) y `app-help-article-card`.

### 1.11 Sandbox

- Existe `run_readonly_script` (JS, solo puede llamar `list_products`) con broker, admisión, auditoría cifrada (`ai_agent_script_runs`, `schema.prisma:7315`) y supervisor gVisor + Deno (`infra/agent-sandbox/`). **Está apagado y nunca se desplegó** (`infra/agent-sandbox/README.md:3-7`). No hay Python.

### 1.12 Cupos y medición

- Features de plan: `text_generation`, `streaming_chat`, `conversations`, `tool_agents`, `rag_embeddings`, `async_queue`, `realtime_voice`, `vex_agent` (`BE/src/domains/store/subscriptions/types/access.types.ts:8-16`), con topes por feature (`:36-59`) en `subscription_plans.ai_feature_flags`.
- Consumo en Redis con deduplicación por `requestId` (`subscription-access.service.ts:388`); una unidad por tool exitosa, nunca por propuestas o errores (`ai-agent.service.ts:625-670`).
- El diagnóstico completo de estas claves y sus redundancias está en §1.14.
- Costos en `ai_engine_logs.cost_usd` y trazas en `ai_agent_trace_spans` (`schema.prisma:6974,7020`). Evals: `BE/test/agentic/golden-conversations.es.jsonl`.

### 1.13 Configuración agéntica: qué toca hoy la tienda y qué superadmin (base de D6)

Rutas de esta sección: `SET` = `BE/src/domains/store/settings`, `FSET` = `FE/private/modules/store/settings`, `SAI` = `FE/private/modules/super-admin/ai-engine`.

**En la tienda** hay exactamente tres ajustes, todos dentro del JSON `store_settings.settings` (`schema.prisma:1285-1292`). No existe por tienda modelo, proveedor, voz, idioma, prompt, temperatura, saludo ni tono.

| Ajuste | Clave | Tipo | Se escribe en | Se lee en | Control en pantalla |
|---|---|---|---|---|---|
| Motor de voz de Vexi (el «modo de voz») | `vexi.voice_engine`: `pipeline` \| `realtime`, default `pipeline` (`SET/defaults/default-store-settings.ts:631`) | **Agéntico** | `VexiSettingsDto.voice_engine` (`SET/dto/settings-schemas.dto.ts:2260-2269`) | Solo el frontend: `FE/core/store/store-settings/store-settings.facade.ts:163-165`, `vexi-dock.component.ts:456`. El backend lo guarda y no lo lee | Selector de radio en `FSET/vexi/vexi-settings.component.ts:77-111` (opciones `:283-300`, guarda `:324`) |
| Activar Vexi | `vexi.enabled`, default `false` (`default-store-settings.ts:613-632`) | Interruptor | `VexiSettingsDto.enabled` (`settings-schemas.dto.ts:2249-2258`; `settings.service.ts:501-517`) | `BE/src/domains/store/vexi/guards/vexi-enabled.guard.ts:57` | `vexi-settings.component.ts:45` |
| Activar Vex | `vex.enabled`, default `false` (`default-store-settings.ts:640`) | Interruptor | `VexSettingsDto` (`SET/dto/update-settings.dto.ts:46-57`; `settings.service.ts:520-535`) | `BE/src/domains/store/vex/guards/vex-enabled.guard.ts` | `FSET/ai-agents/vex-settings.component.ts` (además muestra plan y consumo, solo lectura, `:97-190`) |

- El selector de motor no es cosmético: `pipeline` ejecuta escrituras con confirmación y `realtime` solo consulta (`store-settings.interface.ts:637-652`). Hoy la tienda decide eso sin saberlo, y Vex hereda el motor de Vexi (§1.6).
- Contenedor de las dos pestañas: `FSET/ai-agents/ai-agents-settings.component.ts`; ruta en `FE/routes/private/store_admin.routes.ts:862-875`.
- No verificado: configuración de canales de Vexi (ecommerce, WhatsApp) a nivel tienda.

**En superadmin** ya vive todo lo demás, pero repartido en tres modales (`SAI/ai-engine.component.ts:71`, pestañas `configs`, `apps`, `tools`, `jobs`, `agents`):

| Qué | Dónde se guarda | Dónde se edita |
|---|---|---|
| Proveedor, modelo, voz **realtime**, VAD, ruido | `ai_engine_configs` + `settings` (`schema.prisma:6877`) | `SAI/components/ai-engine-config-modal.component.ts:74,111-119,294,309,347` |
| Prompt de app, voz **TTS**, temperatura, tope de tokens, rate limit | `ai_engine_applications` (`:6901`), voz en `metadata.speech.voice` | `SAI/components/ai-engine-app-modal.component.ts:148,180,317,327,346-360` |
| Prompt del agente, tools permitidas y denegadas, iteraciones, timeout | `ai_agents` (`:6954`) | `SAI/components/ai-engine-agent-modal.component.ts:110-175` |

- Resolución en runtime, sin capa por tienda: proveedor `app.config_id` → primera config activa del tipo → default global (`AE/ai-engine.service.ts:272-310`); voz TTS `overrides.voice || metadata.speech.voice` (`:2285`); voz realtime `dto.voice || config.settings.voice || DEFAULT_VOICE` (`BE/src/domains/store/vexi/vexi-realtime.service.ts:217`).
- Duplicados: la **voz** vive en dos sitios según el motor (`config.settings.voice` y `app.metadata.speech.voice`); **temperatura y tope de tokens** existen en la config y en la app, y la ruta de agente lee solo los de la app (`ai-engine.service.ts:1919-1922`).
- Campos sin efecto: `ai_agents.requires_confirmation_default` se guarda y no se aplica (comentario en `schema.prisma:6934-6937`); `ai_agents.app_key` no tiene FK.
- Conclusión: para saber «qué modelo y qué voz usa Vex» hay que abrir tres modales y además la pestaña de la tienda. No hay una ficha del agente.

### 1.14 Capacidades de IA por plan: por qué «es un terror» (base de D8)

Rutas: `SUB` = `BE/src/domains/store/subscriptions`, `SAS` = `FE/private/modules/super-admin/subscriptions`.

**Cómo está hecho.** `subscription_plans.ai_feature_flags` es un JSON libre (`schema.prisma:12308`), junto a `feature_matrix` (`:12307`), `workflow_limits` (`:12311`) e `is_ai_plan` (`:12320`). El DTO lo acepta como `Record<string, any>` (`BE/src/domains/superadmin/subscriptions/dto/plan.dto.ts:113-114`); la única validación está en `plans.service.ts:38-260`. Se edita en `SAS/pages/plans/plan-form.component.ts:307` con `SAS/components/ai-feature-matrix.component.ts:199-282`. El gate es `SubscriptionAccessService.canUseAIFeature` (`SUB/services/subscription-access.service.ts:179`) con cupos en Redis (`:388`, `:1480`).

**Las 8 claves de hoy** (`SUB/types/access.types.ts:8-16`, cupos en `:104-150`):

| Clave | Rótulo en superadmin | A quién gobierna en realidad | Cupo |
|---|---|---|---|
| `text_generation` | Generación de texto | Plataforma (cualquier llamada del motor) | `monthly_tokens_cap` |
| `streaming_chat` | Chat en streaming | Vexi | `daily_messages_cap` |
| `conversations` | Conversaciones | Vexi | ninguno |
| `tool_agents` | Agentes con herramientas | Vexi | `monthly_tool_calls_cap` |
| `rag_embeddings` | RAG y embeddings | Plataforma | `indexed_docs_cap` |
| `async_queue` | Jobs IA asíncronos | Plataforma (interno) | `monthly_jobs_cap` |
| `realtime_voice` | «Modo voz de Vexi» | **Vexi y Vex** | `monthly_voice_seconds_cap` |
| `vex_agent` | Vex (agente) | Vex | `monthly_tool_calls_cap` + extras `daily_messages_cap`, `monthly_tokens_cap` |

**Los 11 problemas encontrados:**

1. **Nombres técnicos, no de producto.** Las claves describen la tubería (`streaming_chat`, `async_queue`, `rag_embeddings`), no lo que el cliente compra. Quien arma un plan tiene que saber cómo está construido el motor.
2. **Vexi repartido en cuatro claves, Vex en una.** Vexi depende de `streaming_chat` + `conversations` + `tool_agents` + `realtime_voice`; Vex es `vex_agent` con tres cupos adentro. No hay simetría ni forma de ver «qué recibe cada agente».
3. **La voz mezcla los dos agentes.** `realtime_voice` se rotula «Modo voz de Vexi» (`ai-feature-matrix.component.ts:252`) pero también enciende la voz de Vex: `vexi-voice-authority.service.ts:126-129` exige `realtime_voice` **y** `vex_agent` o `tool_agents` según el agente ✔. Un solo cupo de segundos para ambos.
4. **La clave se llama «realtime» y cubre también la voz que no es realtime.** Las apps `vexi_voice_stt` y `vexi_voice_tts` (pipeline) usan la categoría `realtime_voice`.
5. **El mismo nombre de cupo mide cosas distintas.** `monthly_tool_calls_cap` existe en `tool_agents` y en `vex_agent`; `daily_messages_cap` y `monthly_tokens_cap` existen en `streaming_chat`/`text_generation` y otra vez como extras de `vex_agent`. En el seed comercial, el tope diario de Vex reutiliza el valor del chat de Vexi (`BE/prisma/seeds/plan-commercial-lines.seed.ts:74-120`).
6. **Cero significa ilimitado.** Un cupo ausente o `<= 0` no limita (`subscription-access.service.ts:1491-1493` ✔), pero los planes sin IA guardan `enabled:false` con cupos en `0`. Si alguien activa solo el interruptor, la función queda sin límite. El propio formulario lo advierte.
7. **Campos que se configuran y nadie lee.** `agents_allowed` (solo validado al guardar, ausente del tipo de backend), `retention_days` (sin lector), `conversations` (sin cupo). `is_ai_plan` solo afecta precios y landing (`public-plans.service.ts:185`), no el acceso.
8. **Tres capas de tools.** `tools_allowed` en el plan (el selector solo cuelga de `tool_agents`, `ai-feature-matrix.component.ts:133-153`, aunque `vex_agent` también lo usa en backend), más `ai_agents.allowed_tools/denied_tools`, más permisos del usuario.
9. **Doble interruptor sin explicación.** El plan habilita el agente y la tienda también (`vex.enabled`, `vexi.enabled`). Ninguna pantalla dice por cuál de los dos está apagado.
10. **La lista de claves está copiada a mano en cuatro sitios.** Tipo en backend (`access.types.ts:8`), tipo en frontend (`SAS/interfaces/subscription-admin.interface.ts:22`), y dos fusionadores que enumeran los campos (`subscription-resolver.service.ts:338-461`, `promotional-apply.service.ts:500-576`). Ya causó un bug: el formulario borraba `realtime_voice` al guardar (comentario en `SAS/utils/ai-feature-flags.util.ts:1-26`). Hay además claves legadas (`chat_enabled`, `max_tokens_per_month`, `rag_enabled`, `:120-165`).
11. **Los valores por defecto se contradicen.** El formulario nuevo trae `tool_agents` y `vex_agent` apagados y sin tools (`ai-feature-flags.util.ts:50-100`); los seeds comerciales los traen encendidos con `tools_allowed:['*']`, sin tope de acciones y con topes de tokens de 200 M a 20 000 M (`plan-commercial-lines.seed.ts:20-23,35-72`). `subscription-plans-production.seed.ts:76,135,197` omite `vex_agent`.

### 1.15 Tools: cómo se validan hoy contra el rol y dónde las recorta el plan (base de N4)

**Lo que ya existe (validación por rol)**

- Cada tool declara `requiredPermissions?: string[]` con nombres de permiso (`store:products:read`) (`AE/tools/interfaces/tool.interface.ts:107`).
- **Dos controles** ✔: al armar el catálogo del turno, el modelo solo recibe las tools que el usuario puede usar (`AE/ai-agent.service.ts:1515` → `isPermitted`, `AE/tools/ai-tool-registry.ts:263-270`); y al ejecutar, antes de validar argumentos y antes de confirmar, se vuelve a comprobar y se lanza `AI_AGENT_004` (`ai-tool-registry.ts:506-519`). En escrituras hay un tercero: se revalida al emitir la propuesta (`:380-400`) y otra vez al redimir el token (`BE/src/domains/store/vex/vex.controller.ts:212`).
- **Permisos frescos**: se leen de la base de datos en cada request, no del token (`BE/src/domains/auth/strategies/jwt.strategy.ts:65-139`), y se normalizan descartando los inactivos (`BE/src/common/interceptors/request-context.interceptor.ts:67,149`).
- **Sin atajos en la capa de IA**: el registro no lee `is_owner` ni `is_super_admin`; la comparación es un `includes` exacto, sin comodines. (El `PermissionsGuard` HTTP sí deja pasar a super_admin, `BE/src/domains/auth/guards/permissions.guard.ts:~44`.)
- **Otras rutas de ejecución, todas pasan por el mismo control**: tareas durables (permisos vivos ∩ `authority_snapshot`, `ai-agent.service.ts:1325,1494`; `AE/tasks/agent-durable-session.service.ts:574-596`), playbooks (`AE/playbooks/playbook.service.ts:600`), verificador (`agent-verifier.service.ts:971`), programador de tools (`tool-scheduler.service.ts:66,389`), MCP (`BE/src/domains/store/mcp/mcp-auth.service.ts:47-81`) y el puente de API (`AE/tools/bridge/api-bridge.tools.ts:415,704,843`).
- Tests que lo fijan: `AE/tools/ai-tool-registry.spec.ts:137` («el borde no relaja el permiso») y `:509`.

**Dónde recorta hoy el plan (lo que N4 elimina)**

- `resolvePlanToolAllowlist` lee `tools_allowed` de la feature `vex_agent` (Vex) o `tool_agents` (los demás) (`ai-agent.service.ts:550-603`) y el turno usa la **intersección** entre permisos y plan (`:1519-1531` ✔). Con el gate bloqueado, el turno queda sin ninguna tool (`:597`).
- `tools_allowed` vive en el tipo (`BE/src/domains/store/subscriptions/types/access.types.ts:42`, «doble gate» en `:111-114`), se fusiona en `subscription-resolver.service.ts:338-461` y `promotional-apply.service.ts:514`, se valida en `BE/src/domains/superadmin/subscriptions/services/plans.service.ts:250` y lo lee además la política del sandbox (`AE/sandbox/sandbox-policy.service.ts:390-428`).
- Cupo de acciones: `monthly_tool_calls_cap`, una unidad por tool exitosa (`ai-agent.service.ts:625-670`).
- `ai_agents.allowed_tools / denied_tools` (`BE/src/domains/superadmin/ai-engine/ai-agents.service.ts:28,59,69`) **no** es del plan: es configuración técnica del agente en superadmin (hoy solo excluye de Vex las 25 tools `ui_*`, que manejan la pantalla del dock de Vexi y no aplican en la página de Vex).

**Lo que falta para que el rol sea el único límite**

1. **Una tool sin permiso declarado queda abierta a todos** (`ai-tool-registry.ts:267`, `if (!tool.requiredPermissions?.length) return true`). De ~54 archivos de dominio, 12 no declaran ninguno: `business`, `ai-toolbox`, `reports`, `search`, `reminders`, `code-execution`, `discovery`, `playbook`, `planning`, `recipe`, `tasks`, `vex-blocks` (conteo por grep, aproximado). Los cuatro primeros leen datos del negocio; el resto es andamiaje del agente. Además faltan declaraciones sueltas en `pricing`, `products`, `variants` y `subscriptions`. Hoy esto no es una fuga porque Vex es solo para dueño y administrador; lo sería el día que se abra a otros roles (N9).
2. **El dueño depende de la semilla**: no hay atajo de dueño, así que si una tool exige un permiso que no está sembrado en el rol, el dueño se queda sin esa tool sin ningún aviso. No hay test que cruce «permisos que piden las tools» contra «permisos que existen y tiene el dueño».
3. **El modelo no sabe qué se le ocultó**: las tools sin permiso se filtran del catálogo, así que Vex responde con un «no puedo» genérico en vez de «tu rol no permite X».
4. **Puente de API**: `call_endpoint` / `write_endpoint` comparan contra el catálogo de endpoints; no se verificó con qué identidad despacha `internal-http.ts:34` ni si hereda el atajo de super_admin del guard HTTP.
5. **Workers y subagentes**: no se leyó cómo se puebla el contexto (`tenant-context-runner.service.ts:44,142`); sin permisos el control falla cerrado (bueno), pero falta el test que lo fije.

### 1.16 Voz en tiempo real: qué existe hoy (base de N5)

No hay piloto ni lista de tiendas: una tienda usa voz en tiempo real solo si se cumplen tres cosas a la vez: el plan tiene `realtime_voice.enabled`, la tienda eligió `vexi.voice_engine = 'realtime'` (el default es `pipeline`) y la app `vexi_realtime_voice` apunta a un proveedor que haga realtime. Los comentarios del propio código dicen que en producción no había tal proveedor (`BE/src/domains/store/settings/defaults/default-store-settings.ts:617-631`). **Cuántas tiendas lo tienen elegido no se consultó** (lo reporta el conteo previo de T17).

| Pieza | Dónde | Qué hace |
|---|---|---|
| Endpoints | `BE/src/domains/store/vexi/vexi-realtime.controller.ts:31,40,54,77` | `POST store/vexi/realtime/session` (secreto efímero), `tool-call`, `session/close` |
| Servicio | `BE/src/domains/store/vexi/vexi-realtime.service.ts` (1106 líneas; `:232`, `:60`, `:773-793`) | Pide el `client_secret` al proveedor, lee la app `vexi_realtime_voice`, **cobra los segundos al cerrar la sesión** |
| Registro | `vexi.module.ts:11-12,62,81`; DTO `dto/create-realtime-session.dto.ts`, `dto/realtime-tool-call.dto.ts` | — |
| Transporte | No hay gateway WebSocket: es WebRTC del navegador al proveedor | `FE/core/services/vexi-realtime.service.ts` (644 líneas; `RTCPeerConnection` `:315`, SDP `:358`) |
| **Vex** (página) | `VEX/components/vex-composer/vex-composer.component.ts:143-147,180-187,215-267` ✔ | Botón «Voz en vivo» / «Detener voz» y su tarjeta de propuesta |
| **Vexi** (dock) | `FE/shared/components/vexi-dock/vexi-dock.component.ts:442,456,1079`; `vexi-panel.component.ts:1448` | Rama realtime según el ajuste de la tienda |
| Ajuste de tienda | `FE/.../settings/vexi/vexi-settings.component.ts:72-83,269-320`; `SET/dto/settings-schemas.dto.ts:2261-2269` | Selector «Motor de voz» |
| Superadmin | `SAI/interfaces/ai-engine.interface.ts:130,238-257`; `SAI/components/ai-engine-config-modal.component.ts:288-297,491,569` | Selector de voces realtime |
| Planes y precios | `ai_feature_flags.realtime_voice` (migración `20260806160000_backfill_realtime_voice_plan_flag`: `trial-default`, `pro`, `enterprise`, `dev-annual` con 7200 / 1800 / 36000 / 7200 s); `FE/public/pricing/components/plan-comparison-table/feature-labels.ts` | Flag y texto comercial público |
| Datos | App `vexi_realtime_voice` (migración `20260806120000_vexi_realtime_voice_app`); consentimientos con `channel = 'realtime'` (`vexi-voice-consent.service.ts:33,222,878`) | No hay columnas ni enums de realtime en `schema.prisma` |
| Tests | `vexi-realtime.service.spec.ts` (1330 líneas), `vexi-realtime.controller.spec.ts`, `FE/core/store/vexi/vexi-voice.state.spec.ts` | — |

**Lo que NO es tiempo real y se conserva** (es la voz que queda): dictado `POST store/vexi/voice/{chunk,transcribe,warm}` (`vexi-voice.controller.ts:34,56,78,99`, app `vexi_voice_stt`); lectura `vexi-speech.service.ts:131,230` (app `vexi_voice_tts`, MiniMax `speech-2.8-hd` o `gpt-4o-mini-tts`); confirmaciones por voz (`vexi.controller.ts:297-373`).

**El enredo que hay que deshacer con cuidado**: esas tres piezas que se conservan están **colgadas de la clave `realtime_voice`**: las dos apps tienen `ai_feature_category = 'realtime_voice'` (migración `20260806140000`, líneas 149 y 170) y sus endpoints llevan `@RequireAIFeature('realtime_voice')` (`vexi-voice.controller.ts:78,99`; `vexi.controller.ts:311,333`). Apagar o borrar esa clave para «quitar el realtime» dejaría sin dictado y sin lectura a todas las tiendas. No se encontró dónde se cuentan hoy los segundos de lectura: el único consumo explícito en segundos es el de realtime.

### 1.17 Interfaz del chat de Vex: estado actual (base de N6)

**Paneles laterales**

- `/admin/vex` se declara **fuera** del layout del panel, a pantalla completa (`FE/routes/private/store_admin.routes.ts:28-39`): el menú principal de Vendix no se monta ahí; la única salida es el enlace «← Panel». Las «barras laterales» de Vex son dos: chats a la izquierda (`w-72` abierto, `w-14` contraído) y «Bitácora empresarial» a la derecha (`VEX/components/vex-log-sidebar/vex-log-sidebar.component.ts:75`).
- En escritorio **ambos arrancan abiertos** ✔: `readFlag` devuelve `localStorage === 'true'`, y sin valor guardado eso es «no contraído» (`VEX/vex-page.component.ts:12-34`, claves `vex.chats_collapsed` y `vex.log_collapsed`). En móvil arrancan cerrados y se abren como cajón.

**Historial de conversaciones**

- Solo se cargan las **50 más recientes**, sin paginación (`VEX/state/vex-chat.store.ts:49,1362`); el buscador filtra esas 50 en el navegador (`:401`), aunque el servidor ya acepta búsqueda (`BE/src/domains/store/ai-chat/ai-chat.service.ts:348-350`).
- **Al recargar se pierde la conversación abierta**: `_active_id` arranca en `null` y no está en la URL.
- La conversación se crea con el primer mensaje; **si esa creación falla, el turno se aborta en silencio** (`vex-chat.store.ts:1503,1545-1560`).
- El título es el primer mensaje cortado a 40 caracteres (`:48`); el título automático del servidor nunca se usa (`ai-chat.service.ts:564-570,1187-1196`).
- **Renombrar**: el endpoint existe (`PATCH conversations/:id/title`, `ai-chat.controller.ts:223`, servicio `:1228`), sin validación de largo ni de vacío; **no hay botón ni llamada en el frontend**.
- **«Eliminar chat» no elimina** ✔: llama a `PATCH …/archive` (`vex-chat.store.ts:609`; `ai-chat.service.ts:1212-1225`), y el listado solo excluye el estado `deleted` (`ai-chat.service.ts:342-346`), así que **el chat «eliminado» vuelve a aparecer al recargar**. Tampoco pide confirmación.
- Si el stream falla, el mensaje queda con el texto fijo «Vex no pudo completar la respuesta.» y sin reintentar (`vex-chat.store.ts:1857-1885`). A favor: existe reanudación del stream (`BE/src/domains/store/ai-chat/chat-stream-replay.ts`).

**Qué cuelga de una conversación** (base del borrado de verdad; `BE/prisma/schema.prisma`)

| Dato | Relación con la conversación | Hoy al «eliminar» |
|---|---|---|
| `ai_messages` (texto, `tool_calls`, plan en `metadata`) | FK con `onDelete: Cascade` (`:7121`) | Se conserva (solo se archiva) |
| `ai_ui_blocks` (tablas, gráficos, hasta 5000 filas) | `conversation_id` sin FK (`:7141-7160`) | Se conserva |
| `ai_attachments` + objeto en S3 (`s3_key`) | `conversation_id` sin FK (`:7167-7190`) | Se conserva, también en S3 |
| `ai_agent_objectives`, `ai_agent_tasks`, `ai_agent_tool_results`, `ai_agent_effects` | Objetivo con `onDelete: Restrict` (`:7194-7245`) | Se conserva; un `DELETE` directo fallaría |
| `ai_engine_logs` (uso y costo) | `conversation_id` texto sin FK (`:6981`) | Se conserva |
| Embeddings | No hay embeddings derivados de conversaciones (`ai_embeddings` indexa entidades del negocio, `:7345`) | — |
| Memoria | No existe todavía (llega en F4) | — |
| Recordatorios creados desde el chat | `user_reminders`, sin vínculo a la conversación (`:15226-15258`) | Se conserva |

**Seguimientos (recordatorios y bitácora)**

- Datos: `user_reminders` (`title`, `note`, `remind_at`, `status`, `link_type/id/label`, `source: manual | vex`). Tools: `list_reminders`, `create_reminder`, `update_reminder`, `complete_reminder`, `delete_reminder` (`AE/tools/domains/reminders.tools.ts:168-319`).
- El panel derecho ya reutiliza el servicio de recordatorios del dashboard (`VEX/state/vex-log.store.ts`). La bitácora compacta del dashboard (QUI-580, PR #1207: lista ordenada por vencimiento, barra de tiempo, modal de detalle) es el patrón visual a reutilizar. La «Bitácora empresarial» del panel mezcla esos recordatorios con el feed de acciones del agente (`BE/src/domains/store/vex/vex-activity-feed.service.ts:107`).
- **Detección automática: no existe.** No hay regla en el prompt, analizador posterior al turno ni sugerencias derivadas de la conversación: el único camino es que el usuario diga «recuérdame…». No se revisó el texto del prompt de `vex_assistant` guardado en base de datos.
- Plan vecino: `odd/tasks/calendario-tributario-bitacora.md` (recordatorios fiscales con `source = fiscal`, pendiente de aprobación) escribe en la misma tabla; no toca el chat.

**Estados visuales**

- Pensando: tres puntos que rebotan, solo hasta que llega el primer texto (`VEX/components/vex-thread/vex-thread.component.ts:~145-163`); después nada indica que sigue escribiendo.
- Dictado: el micrófono cambia de icono; **sin onda ni cronómetro** (`vex-composer.component.ts:~120-140`).
- **Vex hablando: sin ningún indicador**. El servicio de voz expone el estado `speaking` (`FE/core/services/vexi-voice-pipeline.service.ts:103,122`) y la página de Vex no lo usa.
- Usuario escribiendo y silencio: no hay estado. No hay un distintivo de Vex en el hilo.

**Textos, sugerencias y consistencia**

- Bienvenida con **4 sugerencias fijas** en código, iguales para toda tienda y rol (`VEX/components/vex-welcome/vex-welcome.component.ts:5-10,44`). No hay recorrido guiado ni explicación de cómo funciona Vex.
- Los textos están repartidos en las plantillas; no hay archivo único de textos. Rótulos mezclados («Contraer chats» / «Expandir bitácora»).
- Design system: los colores usan tokens (bien), pero botones, estados vacíos y cargadores están armados a mano en vez de usar los componentes compartidos; hay un `<style>` local con píxeles (`vex-composer.component.ts:197`), `bg-black/40` y `text-white` fijos (`vex-page.component.ts:63,69`; `vex-plan-card.component.ts:103`), y el borrado no usa el modal de confirmación compartido.

---

## 2. Brechas por requerimiento

| # | Requerimiento | Ya existe | Falta |
|---|---|---|---|
| 1 | Autonomía y escritura en lote | Bucle de 40–60 iteraciones, objetivos durables, plan multi-paso, token de plan, hashes por paso, `ai_agent_effects`, tarjeta de plan de varios pasos, 23 playbooks | Aprobación que cubra N pasos (hoy bloqueada a 1 a propósito), ejecutor de lote ordenado con parada en fallo, compensación/deshacer, resumen de auditoría del lote, playbooks lanzables por el usuario, tareas en segundo plano que puedan escribir (hoy solo leen) |
| 2 | Skills con embeddings | Índice global híbrido, tipo `skill` reservado, playbooks ya indexados como `process` | Skills en base de datos con versiones y auditoría, editor en superadmin, poblar `skill`, cubrir todos los módulos (hoy 23 procesos), enlazar skill ↔ artículo/video, evals de recuperación |
| 3 | Visualización y análisis | 6 bloques, 8 tipos de gráfico, transformaciones de bloque, reportes | Timeline, listas/tarjetas, rosa, combinados, embudo, exportar; cálculo decimal confiable como tool; Python aislado; registro de bloques extensible |
| 4 | Aprendizaje | Artículos, videos con su texto de publicación, reproductor reutilizable | Índice vectorial de ayuda y de videos (con el texto del post, sin transcribir), series/rutas, tools de ayuda, bloques de artículo y video, mini reproductor persistente, memoria de la tienda |
| 5 | Paridad de chat | `context_budget` calculado en backend, columna `summary` | Indicador en UI, compactación automática, historial fiel (tools y bloques), razonamiento visible |
| 6 | Voz configurable | Interfaz `generateSpeech`, modelo y voz en superadmin, MiniMax y OpenAI, dictado y lectura por pipeline | Catálogo de voces en superadmin, voz asignada por agente **solo** en superadmin, proveedor vía OpenRouter/Gemini, cupo propio de lectura. La voz en tiempo real **se retira** (N5, §1.16) |
| 9 | Gobierno de IA (alcance nuevo, D6, D8, N1–N5) | `ai_engine_configs`, `ai_agents`, `ai_feature_flags` por plan, validación por rol al listar y al ejecutar cada tool | Configuración agéntica de Vex y Vexi únicamente en superadmin; por plan solo activar/desactivar y cupos de mensajes, tokens y voz, separados por agente; tools sin restricción de plan y con permiso declarado en todas; tienda con solo interruptores, historial y memoria (§1.13–§1.16, §3.10–§3.12) |
| 10 | Interfaz «muy pro» (alcance nuevo, N6) | Página de tres columnas, endpoint de renombrar, tools de recordatorios, estado `speaking` del servicio de voz, reanudación del stream | Paneles contraídos al entrar, historial paginado y restaurable, renombrar en pantalla, borrado físico, detección continua de seguimientos, estados visuales (escucha, piensa, habla, silencio), textos y ayudas, componentes del design system (§1.17, §3.13) |
| 7 | Multimodal | Subida en UI, `ai_attachments`, OCR por tool, contrato con `image_url`, módulo documental | Visión nativa en el bucle, CSV/XLSX/DOCX, tool de guardar y asociar, vista de documentos en la ficha, visor de PDF |
| 8 | Capacidad global | Recuperación acotada, trazas, evals, caching | Fallback de modelo, costo real por mensaje, evals por fase, memoria |

---

## 3. Arquitectura propuesta

Principio rector: **extender el motor existente, no crear uno paralelo**. Cada capacidad entra como tools, bloques, filas de configuración o adaptadores sobre los contratos actuales. Todas las migraciones son aditivas (tablas y columnas nuevas, sin `DROP`, `TRUNCATE` ni mutación de filas).

### 3.1 Escritura en lote (R1)

- **Tool nueva `propose_write_batch`** (solo Vex): el modelo entrega `steps[{tool, arguments, label, depends_on?}]`. El servidor, por cada paso: verifica permiso del usuario, valida argumentos y ejecuta el `preview()` real de la tool. Si un paso no pasa, no hay lote: se devuelve el error para que el modelo corrija.
- **Persistencia**: tabla `ai_agent_write_batches` (tienda, usuario, conversación, objetivo, estado, pasos con hash canónico de argumentos + hash de preview + versión de tool, aprobado en, resumen). Reutiliza `setStepHashes` y `ai_agent_effects` (columna nueva `batch_id`).
- **Una confirmación**: un único frame `plan_approval` con todos los pasos. `PlanApprovalService.approvePlan` deja de recortar a `slice(0, 1)` **solo** para planes nacidos de `propose_write_batch`; el flujo de plan oculto de una escritura queda igual.
- **Ejecución**: ordenada y secuencial, cada paso por `AIToolRegistry.executeTool` con permisos revalidados en el momento, `operation_id` idempotente por paso y **parada en el primer fallo** (los pasos siguientes quedan `omitidos`, no se reintentan solos). Un paso con efecto desconocido bloquea el lote y pide revisión.
- **Transaccionalidad honesta**: no hay transacción global, porque cada servicio de dominio abre la suya. El lote es una **saga**: o todo se aplica, o se informa exactamente qué quedó aplicado. No se promete atomicidad.
- **Compensación**: campo opcional `compensate` en `RegisteredTool` (acción inversa declarada por la tool: archivar lo creado, restaurar el valor anterior). El resumen ofrece «Deshacer» solo en pasos compensables y durante una ventana corta; el resto se informa como «no reversible desde Vex».
- **Límites (D1, aprobado)**: máximo 25 pasos por confirmación y 500 registros afectados por lote; pasos `irreversible` fuera del lote, con tarjeta propia.
- **Fallo parcial (D2, aprobado)**: el mensaje al usuario es «se aplicó hasta el paso N, el resto se omitió», con «Deshacer» donde exista compensación. Nunca se promete todo-o-nada.
- **Auditoría**: una fila resumen en `audit_logs` (`metadata.source='ai_agent'`, `batch_id`) más una por paso en `ai_agent_effects`; el feed de actividad muestra el lote.
- **Playbooks lanzables**: `approval: 'batch'` en el contrato de playbook y una galería «Tareas» en la bienvenida de Vex que inicia el playbook como objetivo durable. Las tareas en segundo plano siguen sin escribir: preparan el lote y esperan la aprobación.
- **Frontend**: `vex-batch-card` (agrupa por tipo, casilla por paso, antes → después, avance en vivo, resumen con deshacer). Reutiliza `VexiConfirmationCardComponent` para las filas.

### 3.2 Conocimiento: skills y centro de ayuda (R2, R4)

- **Un solo índice**: `ai_knowledge_documents` + `ai_embeddings` global. Se amplía el CHECK de tipos con `help_article`, `help_video` y `learning_path`, y se empieza a poblar `skill`. Hoy `ai_knowledge_documents` es propiedad del release (`release_hash`); las skills y la ayuda entran como contenido **administrado** (editable sin deploy), y el indexador debe distinguir ambos orígenes para que un release no borre lo administrado.
- **Skills en base de datos (D5)**: Skill = «cómo se hace X en Vendix»: pantallas, requisitos, tools candidatas, errores comunes, artículo y video relacionados.
  - Tabla global `ai_agent_skills` (`key` único, título, módulo, cuerpo en markdown, tools candidatas, `help_article_id` / `video_id` opcionales, `agent_keys` a los que aplica, estado `draft | published | archived`, `version`, autor y fecha). No es por tienda: se registra en el servicio Prisma global, sin `store_id`.
  - **Versionado**: tabla `ai_agent_skill_versions`, solo inserción: cada guardado crea una versión inmutable (cuerpo completo, autor, nota del cambio). «Restaurar» crea una versión nueva con el contenido antiguo; nunca se reescribe historia.
  - **Auditoría**: cada crear, publicar, archivar y restaurar deja fila en `audit_logs` (quién, cuándo, versión anterior → nueva).
  - **Vectorización**: al publicar, un evento reindexa la skill en el índice global (`knowledge_type='skill'`, hoy reservado y vacío) con el mismo embedding de 1536 dimensiones; al archivar se retira del índice. Solo lo publicado es buscable; el borrador nunca llega a Vex.
  - **Validación al guardar**: el mismo validador de playbooks (tope de tokens, tools que existen, enlaces a artículo/video válidos); una skill inválida no se puede publicar.
  - **Superadmin**: listado con filtro por módulo y estado, editor con vista previa, historial con comparación entre versiones, y «Probar búsqueda» (escribo una pregunta y veo qué skills devuelve y con qué puntaje).
  - **Semilla inicial**: migración con inserciones idempotentes (`ON CONFLICT (key) DO NOTHING`) del contenido base; lo editado después en superadmin no se pisa en el siguiente deploy.
  - Tools `search_skills` / `load_skill` (mismo límite de tokens que playbooks). Los 23 playbooks siguen en el repo: llevan contrato ejecutable (`approval`, pasos) que debe pasar por revisión de código.
- **Ayuda**: indexador por evento de publicación y backfill; los artículos se trocean por secciones.
- **Videos sin transcripción (D4)**: el video se indexa con el texto que ya tiene su publicación en Vendix (ver campos en §1.10). Sin STT, sin columnas de transcripción, sin subir subtítulos. El indexador concatena esos campos en un documento por video. Como la calidad de la búsqueda depende de ese texto, superadmin ve el aviso «texto insuficiente para búsqueda» en los videos que queden por debajo de un mínimo de caracteres.
- **Rutas**: tablas `video_series` y `video_series_items` (orden, video, artículo opcional), CRUD en superadmin; `help_articles.video_id` opcional; `user_learning_progress` (usuario, serie, video, segundos, completado).
- **Tools de Vex**: `search_help` (devuelve artículos, videos y rutas con puntaje), `get_help_article`, `get_learning_path`, `mark_learning_progress`.
- **Bloques nuevos**: `help_article` (render igual al centro de ayuda), `video` y `learning_path` (lista de reproducción con progreso).
- **Reproductor persistente**: `VexMediaDockService` en la página de Vex. El bloque `video` monta `app-video-player` en un contenedor que sobrevive al scroll del hilo; estados: en línea, minimizado (flotante en una esquina) y pantalla completa. La lista de reproducción avanza sola con el evento `ended`.

### 3.3 Memoria de la tienda (R4, R8, D7)

Decisión D7: memoria **por tienda**, en base de datos, con el modelo mental de un archivo `MEMORY.md`: una lista corta de preferencias que Vex escribe y que se carga **en todas las sesiones** de esa tienda, sea quien sea el usuario.

- Tabla `ai_agent_memories` (`store_id`, `agent_key`, `user_id` **nulo**, `key`, `content`, `kind`: preferencia/hecho, `origin`: `agent | manual`, `source_conversation_id` nulo, `created_by_user_id`, `updated_by_user_id`, último uso), registrada en `StorePrismaService`. Única por tienda + agente + `user_id` + clave.
- **Preparada para pasar a por usuario**: `user_id` existe desde el primer día y hoy siempre es nulo (= memoria de la tienda). El cargador ya resuelve «memorias de la tienda + las del usuario actual»; activar memoria por usuario después es empezar a escribir `user_id`, sin migración ni cambio de contrato. `created_by_user_id` guarda quién la originó aunque el alcance sea la tienda.
- **Carga**: todas las memorias de la tienda se inyectan como un bloque «Memoria de la tienda» en el snapshot de Vex (`buildVexSnapshot`) al inicio de cada sesión. Tope duro: 40 entradas y 2000 caracteres; al llegar al tope Vex debe reemplazar o fusionar, no acumular. No usa embeddings: es poco texto y se carga completo, igual que un `MEMORY.md`.
- Tools `remember` y `forget` (sin tarjeta de confirmación, pero Vex avisa «Lo recordaré para esta tienda»).
- Primera clave: `learning.format = video | post`. Al ser por tienda, la preferencia la heredan todos los usuarios de esa tienda (aceptado en D7).
- **Pantalla (decisión N3)**: en la **tienda**, Ajustes → Agentes IA → «Memoria de la tienda»: un detalle donde el dueño y el administrador ven cada recuerdo (texto, quién lo originó, cuándo) y pueden **editarlo, borrarlo, borrar todo y agregar uno a mano**, libremente. Lo editado o agregado a mano queda con `origin = manual`, se desvincula de la conversación de origen y respeta los mismos topes. No hay vista en superadmin: es contenido del negocio.
- **Vínculo con el borrado de conversaciones (N6)**: `source_conversation_id` permite que, al borrar de verdad una conversación (§3.13), se borren también los recuerdos que nacieron de ella y que nadie editó a mano; el aviso de borrado dice cuántos son.
- Nunca se memoriza: credenciales, datos de pago, documentos de identidad de terceros, ni contenido que venga de un documento o de un dato leído (solo lo que el usuario dice en el chat, o lo que el dueño escribe en la pantalla).

### 3.4 Contexto visible y compactación (R5)

- **Medidor**: el frame `done` ya trae `context_budget`; se reenvía al cliente y se pinta un anillo «Contexto N %» en el composer.
- **Compactación**: al superar el 75 % de la ventana, un job resume los mensajes antiguos con un modelo económico y guarda el resultado en `ai_conversations.summary` + `summary_through_message_id` (columna nueva). El contexto del turno pasa a ser: resumen + hechos del objetivo durable + últimos N mensajes. Se inserta un mensaje de sistema visible «Resumí la conversación anterior» con opción de ver el resumen.
- **Historial fiel**: los mensajes del asistente llevan al modelo una línea compacta por tool ejecutada y por bloque emitido (id, tipo, filas), para que no se pierdan entre turnos.
- **Pulido**: marcador para bloques desconocidos y costo real en `ai_messages.cost_usd`. Renombrar, agrupar por fecha, resaltado de código y error con su causa real pasan a la fase de interfaz (§3.13, F1).
- **Fallback de modelo**: `fallback_config_id` en la app; ante error del proveedor o timeout se reintenta una vez con el modelo de respaldo.

### 3.5 Multimodal y documentos (R7)

- **Ingesta unificada**: `vexi-attachments.service` acepta además CSV, XLSX, DOCX y TXT (extracción a texto, guardada como derivado en S3), usa `S3PathHelper` y verifica la firma de bytes (patrón de `StoredFilesService`). Frontend y backend comparten una sola lista de tipos y tamaño.
- **Visión nativa**: si la configuración del modelo declara `settings.supports_vision`, las imágenes del turno viajan como partes `image_url` (URL firmada corta o base64); el estimador de contexto suma un costo fijo por imagen en vez de rechazar. Sin visión, se mantiene `ai_extract_document`.
- **Lectura de archivos**: tool `read_attachment` (texto paginado de PDF/XLSX/CSV; las hojas de cálculo se materializan como bloque `table`).
- **Guardar y asociar**: tool de escritura `attach_document_to_record(attachment_id, entity_type, entity_id, doc_type)` con vista previa. Promueve el adjunto a `stored_files` y lo agrega al `dossier` del registro (`subject_type`: `customer`, `order`, `purchase_order`, `supplier`, `expense`, `product`); para órdenes de compra escribe además en `purchase_order_attachments` para que aparezca donde hoy se ven. Permiso por entidad, igual que el controlador de cada una.
- **Verlo**: pestaña «Documentos» en la ficha de cliente y de orden, alimentada por el `dossier`. Visor de PDF e imagen en el chat (`app-image-lightbox` existe; PDF con el visor nativo del navegador en un modal).

### 3.6 Visualización y análisis (R3)

- **Registro de bloques**: mapa `kind → componente` en lugar del `@switch`, con marcador para tipos desconocidos.
- **Bloques nuevos**: `timeline` (reutiliza `app-timeline`), `list` (tarjetas), y en `chart`: rosa, barras apiladas, combinado barra + línea, embudo, mapa de calor. Exportar bloque a XLSX/CSV e imagen.
- **Cálculo confiable sin sandbox**: tool `compute` (expresiones con aritmética decimal: porcentajes, variaciones, márgenes, proyecciones simples) y ampliación de `vex_block_transform` (columnas derivadas, comparación entre periodos, unión de dos bloques). El modelo deja de hacer aritmética "de cabeza".
- **Análisis con código**: tool `run_analysis` (Python: pandas, numpy, statsmodels básicos). Contrato **datos entran → JSON sale**: recibe ids de bloques, artefactos o adjuntos de la misma conversación, el servidor los materializa como archivos de entrada y la salida (tablas, series, cifras) se valida contra un esquema y se convierte en bloques. El sandbox **no dibuja** (los gráficos los pinta el frontend), no tiene red, ni credenciales, ni acceso a la base de datos, ni llama tools.

#### Opciones de sandbox

| Opción | Seguridad | Costo | Multi-tenant | Operación | Veredicto |
|---|---|---|---|---|---|
| A. Supervisor gVisor + Deno ya diseñado, agregando Python en WASM (Pyodide) | Alta en diseño, **sin certificar**; nunca desplegado | Host Linux dedicado fijo (~15–30 USD/mes) | Cápsula efímera por ejecución | Alta: host propio, parches, monitoreo de huérfanos, QA de aislamiento | Válida si no se quiere depender de un servicio gestionado; pandas en WASM es lento y pide subir el tope de 256 MB |
| **B. AWS Lambda con imagen Python, en VPC sin salida a internet y rol IAM vacío** | Alta: microVM Firecracker gestionada por AWS; sin red ni secretos | Por uso: ~0,0002 USD por ejecución de 10 s a 1 GB | Entorno reutilizable entre invocaciones → mitigar con raíz de solo lectura, limpieza de `/tmp`, proceso hijo nuevo y muerte del grupo de procesos por ejecución | Baja: sin servidores | **Elegida (D3)** |
| C. SaaS de sandboxes (microVM por sesión) | Alta, pero los datos del comercio salen a un tercero | Suscripción + uso (cientos de USD/mes) | Bueno | Muy baja | Descartar por datos y costo fijo |
| D. Ejecución de código nativa del proveedor del modelo | Depende del proveedor; los datos van a su contenedor | Incluido o por sesión | Opaco | Nula | Descartar: ata a Vex a un proveedor y deja la auditoría fuera de Vendix |
| E. En el proceso de Nest o en el worker del backend (`vm`, WASM local, proceso hijo) | Inaceptable: comparte host, red y secretos con la app | — | — | — | Prohibido por `skills/vendix-agent-sandbox-security`; descartada en D3 |

**Decisión D3: opción B, AWS Lambda aislada. No se usan los workers existentes del backend.**

Rafael preguntó si era mejor ejecutar el código en workers propios. No: el worker de Vendix es la **misma imagen y el mismo comando** que la API, con otro rol (`docker-compose.yml:99`), carga el mismo `.env` (`:128-129`), tiene la `DATABASE_URL` (`:131`) y vive en la misma red que la base de datos y Redis (`:146-147`). Código generado por una IA corriendo ahí tendría a su alcance los datos de **todas** las tiendas y las llaves de la plataforma (BD, S3, proveedores, firma DIAN). Un aislamiento hecho a mano dentro de ese host es justo lo que el skill `vendix-agent-sandbox-security` prohíbe (opción E). La Lambda arranca sin red, sin rol y sin secretos: aunque el código sea hostil, no hay nada que robar ni a dónde enviarlo.

Reparto de responsabilidades:
- **Worker propio (cola `ai-agent`)**: solo **orquesta**. Encola la ejecución, materializa los datos de entrada de esa conversación, invoca la Lambda con `lambda:InvokeFunction`, aplica el tiempo máximo, valida la salida contra el esquema y la convierte en bloques. Nunca ejecuta el código.
- **Lambda**: solo **ejecuta**. Recibe datos + código, devuelve JSON. VPC sin salida a internet, rol IAM vacío, raíz de solo lectura, `/tmp` limpio y proceso hijo nuevo por ejecución.

Va **detrás del broker existente** (`SandboxBrokerService`: admisión por tienda, límites, auditoría cifrada en `ai_agent_script_runs`). Se conserva lo ya construido (autoridad en el host, límites, auditoría) y se cambia solo el adaptador de ejecución. El contrato «datos entran → JSON sale» elimina el RPC de tools dentro del sandbox, que es la parte más difícil de asegurar del diseño A. Las compuertas de QA del skill (egreso, sistema de archivos, 100 ejecuciones alternando tres tiendas) siguen siendo obligatorias antes de encenderlo.

### 3.7 Voz: lectura de la respuesta por API (R6, D6, N5)

Decisión N5: **no hay voz en tiempo real**. La voz de Vex y de Vexi es una sola cosa: el texto de la respuesta se convierte en audio con una llamada al proveedor (TTS) y se reproduce. La latencia no es un criterio: se puede sintetizar la respuesta completa cuando termina de escribirse.

- **Cómo la usa la persona**: un altavoz en cada respuesta («Leer») y un interruptor en el composer «Leer las respuestas en voz alta» (preferencia del navegador, no de la tienda). El **dictado** (mantener el micrófono, voz → texto) se conserva como forma de escribir; no es conversación en vivo.
- **Catálogo en superadmin**: tabla `ai_voice_profiles` (config de proveedor, id de voz, nombre, idioma, muestra de audio, activo). Sin columna de capacidades: todas las voces son de lectura. Superadmin arma el catálogo: agrega proveedores, registra voces, las escucha y las activa.
- **La voz se asigna por agente, solo en superadmin**: la ficha del agente (§3.10) elige el perfil de voz de Vex y de Vexi por separado. No existe «modo de voz» que elegir, ni en la tienda ni en superadmin.
- **Una sola fuente para la voz**: el perfil reemplaza `app.metadata.speech.voice` (§1.13), que queda como respaldo de solo lectura durante la transición. `config.settings.voice` (voces realtime) deja de mostrarse.
- **Proveedores de TTS**: adaptadores sobre `AIProvider.generateSpeech`: los dos actuales + audio por OpenRouter + Gemini TTS. La disponibilidad real de modelos de solo voz en OpenRouter se verifica en la tarea; si no los expone, Gemini entra con adaptador directo. El frame `audio` ya existe.
- **Cupo de voz, replanteado**: una fila por agente, «Voz: lectura de respuestas», con interruptor y cupo en **segundos de audio generado al mes** (el formulario lo muestra en minutos). Se mide al sintetizar (`vexi-speech.service.ts:230`), dato que hoy no se cuenta. El dictado no descuenta cupo: es entrada, cuesta ~10 veces menos y lo protege el límite de frecuencia de su app. Al agotarse el cupo, la respuesta llega en texto con el aviso «Se acabó la lectura en voz de este mes».
- **Por qué desaparece el problema del cupo compartido**: el cupo único de hoy mezclaba la voz cara (tiempo real, 0,05–0,30 USD/min) con la barata. Sin tiempo real solo queda la lectura (~0,015–0,02 USD/min): cada agente recibe su fila con el valor que el plan ya tenía (`monthly_voice_seconds_cap`), y el peor caso de darle ese valor a los dos agentes es del orden de 1–2 USD al mes por tienda en el plan con más voz.
- **Retiro de la voz en tiempo real**: procedimiento seguro en §3.12.

### 3.8 Infraestructura

| Pieza | Estado | Acción |
|---|---|---|
| pgvector | Instalado, 1536 dimensiones | Reutilizar; sin cambio de dimensión |
| S3 | `S3Service` + `S3PathHelper` | Reutilizar; prefijo nuevo para derivados de adjuntos |
| Colas | `ai-embedding`, `ai-agent`, `ai-recipe-miner` | Jobs nuevos: indexar ayuda y skills, compactar conversación, orquestar la llamada al sandbox |
| Redis | Cupos y tokens | Contadores por agente y cupo (§3.11) |
| Sandbox | No desplegado | Función Lambda + VPC sin salida (D3); el worker solo la invoca |
| Proveedores | OpenAI, OpenRouter, Anthropic, MiniMax | + adaptador adicional de lectura en voz (TTS) |

### 3.9 Datos y migraciones

Todas aditivas en esquema: tablas y columnas nuevas, sin `DROP`, `TRUNCATE` ni `DELETE`. Las columnas y claves que se dejan de usar (`ai_feature_flags`, `vexi.voice_engine`, `tools_allowed`) **se conservan** como respaldo; retirarlas es una decisión posterior con snapshot. El borrado de conversaciones (F1) **no** es una migración: lo ejecuta la aplicación, una conversación a la vez y por id.

| Migración | Fase | Contenido | Mutación de filas |
|---|---|---|---|
| M1 | F1 | `ai_conversation_purges` (constancia sin contenido del borrado y cola de objetos S3 por borrar) | No |
| M2 | F2 | `plan_ai_entitlements` | No |
| M3 | F2 | Copia de `ai_feature_flags` a `plan_ai_entitlements` (sin `tools_allowed` ni cupo de acciones) | **Sí, solo inserciones** idempotentes; cabecera `-- DATA IMPACT:` con filas esperadas por plan; `ai_feature_flags` no se toca |
| M4 | F2 | Desactivar la app de voz en tiempo real | **Sí**: `UPDATE ai_engine_applications SET is_active = false WHERE key = 'vexi_realtime_voice'` (1 fila); cabecera `-- DATA IMPACT:`; no se borra la fila ni su config; `store_settings` no se modifica |
| M5 | F3 | `ai_conversations.summary_through_message_id`; `ai_engine_applications.fallback_config_id` | No |
| M6 | F4 | `ai_agent_memories` | No |
| M7 | F4 | `help_articles.video_id`; `video_series`, `video_series_items`, `user_learning_progress`; CHECK de tipos de conocimiento ampliado | No (el CHECK se reemplaza por uno más amplio) |
| M8 | F4 | `ai_agent_skills`, `ai_agent_skill_versions` + semilla inicial de skills | Solo inserciones idempotentes (`ON CONFLICT DO NOTHING`) |
| M9 | F5 | `ai_agent_write_batches`; `ai_agent_effects.batch_id` | No |
| M10 | F6 | `ai_attachments.derived_text_key`, `ai_attachments.stored_file_id` | No |
| M11 | F8 | `ai_voice_profiles` + catálogo inicial; `ai_agents.voice_profile_id` | Inserciones idempotentes + `UPDATE ai_agents … WHERE key IN ('vex','vexi')` |
| M12 | F1–F9 | Apps y prompts nuevos (`vex_title_generator`, `vex_context_summarizer`, `vex_analysis`), actualizaciones del prompt de `vex_assistant` (la primera, en F1: regla de seguimientos) | `UPDATE … WHERE key = 'vex_assistant'` con cabecera `-- DATA IMPACT:`; una migración por fase que lo toque |

Cada migración carga antes el skill `vendix-prisma-migrations`, es idempotente, lleva alerta en commit y PR, y las que mutan filas (M3, M4, M11, M12) requieren aprobación explícita de Rafael, snapshot de producción y dry-run con datos representativos. Ya no existen `videos.transcript`, `ai_user_memories` (D4, D7), `ai_agents.voice_engine` ni `ai_agent_store_overrides` (N2, N5).

### 3.10 Configuración agéntica solo en superadmin (D6, N1, N2)

Regla: **la tienda no configura nada agéntico**. Modelo, proveedor, voz, prompt, tools técnicas, iteraciones y tiempos de Vex y de Vexi se definen únicamente en superadmin, **iguales para todas las tiendas**. Lo único que varía entre tiendas es lo que da su plan (§3.11).

- **Ficha única del agente** (superadmin → IA → Agentes): una pantalla por agente que reúne lo que hoy está en tres modales (§1.13): modelo y proveedor (la app y su config), modelo de respaldo, voz, prompt, tools técnicas, iteraciones y tiempo. Edita las mismas tablas; no crea una segunda fuente. Los campos duplicados (temperatura y tope de tokens de la config) se muestran como «no usado por agentes» y los que no tienen efecto (`requires_confirmation_default`) se ocultan. No hay «modo de voz» (N5).
- **Resolución en el servidor**: servicio `AgentRuntimeConfigService` que devuelve la configuración efectiva del agente para una tienda (modelo, voz y qué permite el plan). El frontend la recibe del backend al abrir el agente; deja de leer `vexi.voice_engine` desde los ajustes de la tienda. Hoy esa decisión se toma en el navegador (§1.13).
- **Sin excepciones por tienda (N2)**: superadmin **no** fija excepciones ni pilotos por tienda. No existe `ai_agent_store_overrides`. Si una tienda necesita algo distinto, se le cambia el plan. Las promociones de plan que ya existen (`subscription-resolver`, `promotional-apply`) siguen funcionando: son parte del plan, no una excepción de configuración.
- **Qué se quita de la tienda**: el selector de motor de voz (`vexi-settings.component.ts:77-111`), su default (`default-store-settings.ts:631`), el selector en la fachada (`store-settings.facade.ts:163-165`) y la lectura del dock (`vexi-dock.component.ts:456`). La propiedad `voice_engine` del DTO (`settings-schemas.dto.ts:2260-2269`) se conserva una versión como opcional e ignorada, para que un navegador con la versión vieja no reciba un error al guardar.
- **Qué se queda en la tienda (N1), y nada más**: Ajustes → Agentes IA con tres bloques.
  1. **Interruptores** «Usar Vex» y «Usar Vexi», cada uno con el motivo cuando no se puede encender («tu plan no incluye Vex»).
  2. **Historial**, con dos pestañas de solo lectura. *Cambios*: quién encendió o apagó cada agente, las acciones que los agentes aplicaron en la tienda (lo que hoy alimenta la «Bitácora empresarial», `vex-activity-feed.service.ts:107`, y `audit_logs` con `source = 'ai_agent'`), las ediciones de la memoria y las constancias de conversaciones borradas (sin su contenido). *Conversaciones*: listado de las conversaciones de la tienda con cada agente (agente, usuario, título, fecha, mensajes). Supuesto a confirmar: qué ve el dueño de las conversaciones de otros usuarios (decisión N8).
  3. **Memoria de la tienda** (N3, §3.3), que llega con F4.
  Supuesto a confirmar: el estado del plan y las barras de consumo, que hoy se muestran ahí en solo lectura, se conservan (decisión N7).
- **Transición sin migración de ajustes**: como la voz en tiempo real se retira (N5), no hay nada que copiar de `vexi.voice_engine`: todas las tiendas quedan en la única voz que existe. La clave vieja queda en el JSON sin lector.
- **Un solo «por qué está apagado»**: la tienda y superadmin muestran el mismo estado calculado: apagado por el plan o por la tienda.

### 3.11 Capacidades de IA por plan: agente, capacidades y cupos (D8, N2, N4)

Objetivo: que armar un plan sea leer dos tarjetas, **Vex** y **Vexi**, cada una con su interruptor, pocas capacidades de encender o apagar y tres cupos: mensajes, tokens y voz. Sin claves técnicas, sin lista de herramientas, sin cupos compartidos a escondidas, sin campos muertos.

**Reglas (N2 y N4)**

- El plan **activa o desactiva** el agente y cada capacidad, y **limita cantidad**: mensajes, tokens y segundos de lectura en voz. Nada más.
- El plan **no restringe herramientas**. Vex tiene todas las tools activas; el único límite de qué puede hacer es el rol del usuario (§3.12). Desaparecen `tools_allowed`, el selector de tools y el **cupo de acciones** (`monthly_tool_calls_cap`): las acciones se siguen contando como métrica, no como límite.
- No hay excepciones por tienda: el plan es la única palanca.

**Modelo**

- **Catálogo de capacidades en código, una sola vez**: un archivo en `libs/shared-types` que consumen backend y frontend (elimina las cuatro copias de §1.14). Cada capacidad declara: agente (`vex | vexi | platform`), clave, nombre en español, si lleva cupo y su unidad. Agregar una capacidad es agregar una entrada; el formulario, el gate y los fusionadores la toman del catálogo.
- **Tabla `plan_ai_entitlements`**: `plan_id`, `agent_key`, `capability_key`, `enabled`, `cap_value` (entero, **`NULL` = sin límite**, `0` = cero), `on_limit` (`block | warn`). Única por plan + agente + capacidad. Se acaba «cero significa ilimitado».
- **Un cupo por fila, con una sola unidad.**
- **Promociones**: `subscription-resolver` y `promotional-apply` siguen fusionando base + override + overlay, pero recorriendo el catálogo en vez de una lista escrita a mano.

**Las filas** (valor por defecto editable en cada plan; mantiene la recomendación previa de D8)

| Agente | Fila | Tipo | Reemplaza a | Planes con el agente | Plan más alto |
|---|---|---|---|---|---|
| **Vex** | Agente | interruptor + **mensajes/día** | `vex_agent` + extra `daily_messages_cap` | ✔ | ✔ |
| Vex | Consumo del modelo | **tokens/mes** | extra `monthly_tokens_cap` | ✔ | ✔ mayor |
| Vex | Voz: lectura de respuestas | interruptor + **segundos/mes** | parte de `realtime_voice` | ✔ | ✔ mayor |
| Vex | Archivos e imágenes | interruptor | nueva (F6) | ✔ | ✔ |
| Vex | Análisis con código | interruptor | nueva (F9) | — | ✔ |
| Vex | Modelo avanzado (de frontera) | interruptor | nueva | — | ✔ |
| **Vexi** | Agente | interruptor + **mensajes/día** | `streaming_chat` + `conversations` + `tool_agents` | ✔ | ✔ |
| Vexi | Consumo del modelo | **tokens/mes** | la parte de Vexi de `text_generation` | ✔ | ✔ mayor |
| Vexi | Voz: lectura de respuestas | interruptor + **segundos/mes** | parte de `realtime_voice` | ✔ | ✔ mayor |
| **Plataforma** | IA en los módulos (textos, extracción de documentos) | tokens/mes | `text_generation` | ✔ | ✔ mayor |
| Plataforma | Búsqueda inteligente | registros indexados | `rag_embeddings` | ✔ | ✔ mayor |

- **Incluido siempre que el agente esté activo, sin fila**: todas las herramientas (según el rol), escritura en lote, aprender (ayuda, videos, skills), memoria de la tienda y detección de seguimientos. No son palancas del plan.
- **Capacidades con interruptor y sin cupo propio** (archivos, análisis con código, modelo avanzado): consumen mensajes y tokens como cualquier turno. Sus topes de seguridad (tamaño de archivo, tiempo y memoria de una ejecución, ejecuciones simultáneas) son límites técnicos globales del motor, no del plan. Que estas tres sean palancas del plan es la decisión N10.
- **Fuera de N4**: las dos filas de Plataforma no son de los agentes; «registros indexados» es el cupo técnico que ya existe y se conserva.
- **Desaparecen del formulario**: `conversations`, `tool_agents` y su cupo de acciones (se funden en el agente Vexi), `async_queue` (límite técnico interno, pasa a configuración del motor), `agents_allowed`, `retention_days`, `tools_allowed` y la voz en vivo. `is_ai_plan` se mantiene solo como etiqueta comercial y se rotula así.
- Vex sigue siendo solo para dueño y administrador (D8); abrirlo a otros roles es la decisión N9.

**Pantalla del plan en superadmin**: reemplaza `ai-feature-matrix`. Dos tarjetas (Vex, Vexi) y una tercera «IA en los módulos»; cada fila = interruptor y, si lleva cupo, el número con su unidad escrita + qué pasa al llegar al tope. Casilla «sin límite» explícita. Botón «copiar de otro plan». Resumen en lenguaje natural al final («Vex: 200 mensajes al día, 50 M de tokens al mes, 60 minutos de lectura en voz, sin análisis con código»). Una fila apagada no pide cupo.

**Transición sin sustos**

1. M2 crea la tabla; M3 copia cada plan con el mapeo de la columna «Reemplaza a». `tools_allowed` y el cupo de acciones no se copian (hoy los planes comerciales traen `'*'` y sin tope de acciones, §1.14, así que nadie pierde nada). El cupo de voz se copia con su valor actual a la fila de voz de cada agente (§3.7). El cupo de tokens de Vexi nace con el valor de `text_generation` del plan.
2. **Modo sombra**: el resolutor nuevo calcula en paralelo y el gate sigue decidiendo con `ai_feature_flags`; cada diferencia se registra. Se pasa al modelo nuevo cuando el registro lleva una semana en cero.
3. Los contadores de Redis se separan por agente; los del periodo en curso se respetan hasta el corte para no regalar ni quitar cupo.
4. `ai_feature_flags` queda en la tabla sin lector, como respaldo.

### 3.12 Herramientas limitadas por el rol y retiro de la voz en tiempo real (N4, N5)

**Herramientas: el rol es el único límite (N4)**

- **Se quita el recorte del plan**: `resolvePlanToolAllowlist` deja de filtrar (`ai-agent.service.ts:550-603,1519-1531`); se retiran `tools_allowed` del tipo, de los dos fusionadores, de la validación del plan y de la política del sandbox (§1.15). El gate del agente se conserva con un solo significado: agente apagado o cupo de mensajes/tokens agotado, que corta el turno **antes** de empezar con un mensaje claro, en vez de dejarlo sin tools.
- **Se cierra el «abierto por defecto»**: el contrato de `RegisteredTool` exige declarar una de dos cosas: `requiredPermissions` o `access: 'public'` con un motivo escrito. Una tool que no declara ninguna **no se registra** y el arranque falla en desarrollo y CI. Las tools de los 12 archivos sin permiso (§1.15) se clasifican una por una: las que leen o escriben datos del negocio reciben el permiso del controlador equivalente; el andamiaje (descubrimiento, plan, bloques) se marca `public`; los recordatorios se marcan `public` porque ya están limitados al propio usuario.
- **El dueño nunca queda bloqueado por la semilla**: test que recorre el catálogo y falla si una tool pide un permiso que no existe en `permissions` o que el rol dueño no tiene.
- **Vex explica el límite**: el snapshot del turno incluye la lista de **áreas** que el rol no puede usar (nombres, sin tools). Vex responde «tu rol no permite anular órdenes; pídeselo al dueño» en vez de un «no puedo» genérico, y no propone tarjeta.
- **Mismas reglas en todas las rutas**: tests que fijan el control en el puente de API (identidad con la que despacha y sin atajo de super_admin), en workers y subagentes (sin permisos = falla cerrado) y en tareas durables (permisos vivos ∩ los del momento de crear la tarea).
- `ai_agents.denied_tools` se conserva como exclusión **técnica** en la ficha del agente (las `ui_*` no existen en la página de Vex); no es una palanca comercial y se rotula así.

**Retiro seguro de la voz en tiempo real (N5)**

Principio: nadie se queda sin voz. Quien usaba voz en vivo pasa a dictado + lectura, que ya funcionan para todas las tiendas.

1. **Antes de tocar nada, contar** (consulta de solo lectura, sin migración): cuántas tiendas tienen `vexi.voice_engine = 'realtime'` y cuántos segundos de tiempo real se consumieron en los últimos 30 días. Si es cero, el retiro es invisible; si no, esas tiendas reciben un aviso dentro del panel.
2. **Separar la voz que se queda de la clave `realtime_voice`** (§1.16): dictado, lectura y confirmaciones por voz pasan a depender de la capacidad «Voz: lectura de respuestas» del agente. Este paso va **primero** y con un test que fija que una tienda sigue pudiendo dictar y escuchar.
3. **Primera entrega, apagar la entrada**: el frontend deja de ofrecer voz en vivo (botón de Vex, rama del dock de Vexi, selector de la tienda, selector de voces realtime de superadmin); cualquier valor de `voice_engine` se trata como `pipeline` (la fachada ya lo hace con todo lo que no sea `realtime`, `store-settings.facade.ts:163-164`). En el servidor, `POST …/realtime/session` responde «no disponible» con un error tipado; `tool-call` y `session/close` **siguen vivos** en esta entrega, para que una sesión abierta en un navegador sin recargar termine bien y se cobren sus segundos.
4. **Segunda entrega, una versión después**: se desmontan los tres endpoints. El código del servicio (backend y frontend) y sus tests se conservan en el repo, sin rutas ni botones, porque la voz en tiempo real volverá; M4 marca inactiva la app `vexi_realtime_voice` sin borrarla.
5. **Lo que no se toca**: los valores `realtime` guardados en los ajustes de las tiendas, los consentimientos con `channel = 'realtime'` (se siguen pudiendo leer) y la config del proveedor.
6. **Texto comercial**: la tabla pública de precios y los rótulos del plan dejan de decir «voz en tiempo real» y pasan a «lectura de respuestas en voz». Es un cambio visible para clientes y prospectos: se confirma el texto con Rafael en la tarea.

### 3.13 Interfaz de Vex a nivel «muy pro» (N6)

Principio: el chat es el protagonista; todo lo demás aparece cuando hace falta. Solo frontend web (Angular zoneless + signals), con componentes y tokens del design system de Vendix.

**Disposición**

- Al entrar a `/admin/vex`, **los dos paneles arrancan contraídos siempre**, en cualquier tamaño de pantalla, ignorando lo que hubiera guardado. Dentro de la visita se abren y cierran libremente; no se recuerda entre visitas. El hilo queda centrado con un ancho de lectura cómodo (~768 px).
- El panel de bitácora contraído muestra un contador de recordatorios pendientes y destella cuando se guarda uno nuevo, para que no haga falta abrirlo.

**Historial confiable**

- La conversación abierta vive en la URL (`/admin/vex/c/:id`): recargar, compartir el enlace con uno mismo o usar atrás/adelante conserva el lugar.
- Lista con carga progresiva al hacer scroll y búsqueda en el servidor (ya soportada), agrupada por fecha (Hoy, Ayer, Últimos 7 días, por mes).
- Si no se puede crear la conversación o enviar el mensaje, el texto **no se pierde**: queda en el hilo con «No se envió · Reintentar». Si la respuesta se corta, se ofrece «Reintentar» con la causa real.
- Título generado por un modelo económico después de la primera respuesta (app `vex_title_generator`); un título puesto a mano nunca se sobrescribe (`metadata.title_source = 'user'`).
- **Renombrar** en línea desde la lista y desde el encabezado del hilo, sobre el endpoint existente, al que se le agrega validación (1 a 80 caracteres).

**Borrar de verdad**

`DELETE store/ai-chat/conversations/:id`, solo para el dueño de la conversación y solo conversaciones de Vex; el dock de Vexi no cambia. Pide confirmación con el modal compartido y con las cifras reales («Se borrarán 42 mensajes, 3 archivos y 1 recuerdo. No se puede deshacer»). No se puede borrar una conversación con una tarea o un lote en ejecución: primero se detiene.

| Se borra físicamente | No se borra, y por qué |
|---|---|
| Mensajes, con sus `tool_calls`, planes y razonamiento (`ai_messages`) | **Lo que Vex aplicó en el negocio** (precios, órdenes, etiquetas) y su registro en Auditoría: son hechos de la tienda, no de la conversación |
| Bloques de la conversación: tablas, gráficos, KPIs (`ai_ui_blocks`) | **Documentos que el usuario guardó en un registro** (factura asociada a una orden, F6): pertenecen a ese registro |
| Adjuntos y sus derivados de texto, **en la base y en S3** (`ai_attachments`) | **Recordatorios y notas de bitácora** guardados desde la conversación: son del usuario y viven en su bitácora (decisión N11) |
| Resumen de compactación (`ai_conversations.summary`) y la fila de la conversación | **Uso y costo** (`ai_engine_logs`): se conservan tokens, costo, modelo y fecha, **anonimizados**: se les quita el vínculo a la conversación. Hacen falta para facturación y cupos |
| Tareas durables de esa conversación con sus resultados de tools y trazas (`ai_agent_objectives`, `ai_agent_tasks`, `ai_agent_tool_results`, `ai_agent_trace_spans`) | **Recetas globales** ya aprobadas que se aprendieron de ella: son anónimas y revisadas por una persona |
| Recuerdos de la memoria de la tienda que nacieron de ella y nadie editó a mano (desde F4) | **Copias de seguridad de la base**: lo borrado sale de ellas cuando rotan, no antes. **Registros del proveedor del modelo**: fuera del control de Vendix |
| Tokens y planes pendientes en Redis, y el búfer de reanudación del stream | **Constancia del borrado** (`ai_conversation_purges`): quién, cuándo y cuántos elementos; sin título ni contenido |

- **Cómo**: un servicio `ConversationPurgeService` borra en orden (lo que cuelga con `Restrict` primero), dentro de una transacción para la base de datos, y deja en `ai_conversation_purges` la lista de objetos S3 pendientes; un job los borra con reintentos y vacía la lista al terminar. Así un fallo de S3 no deja archivos huérfanos ni una conversación a medio borrar.
- **Por verificar en la tarea, antes de borrar `ai_agent_effects`**: que cada escritura aplicada deje hoy su fila en `audit_logs`. Si no es así, los efectos se conservan desvinculados (cambio de FK a `SET NULL`, solo esquema) en lugar de borrarse.
- El estado `archived` deja de usarse desde Vex. Los chats que hoy están archivados siguen apareciendo en la lista (ya ocurre) y el usuario puede borrarlos de verdad; no se borran solos.

**Detección continua de seguimientos**

- **En cada turno, sin llamada extra al modelo**: una tool de solo lectura `suggest_followup` (tipo: `reminder` con fecha o `log_entry` sin fecha; título, nota, fecha, registro relacionado, frase que lo motivó) y una regla en el prompt de Vex: evaluar en cada turno si hay un compromiso con fecha, un pendiente con un cliente o proveedor, un acuerdo, o una acción aplicada que conviene revisar después.
- **En pantalla**: una ficha debajo de la respuesta, «Recordatorio sugerido: Llamar a la distribuidora · viernes 9:00», con **Guardar**, **Editar** y **No**. Guardar es la aprobación: crea el recordatorio con el servicio existente y aparece al instante en la bitácora. Las sugerencias se guardan en `ai_messages.metadata`, así sobreviven a recargar.
- **Sin estorbar**: máximo una sugerencia por turno; no se repite lo ya guardado ni lo descartado (huella de tipo + título + fecha); «No sugerir en este chat» lo apaga. Cuando el usuario lo pide de forma explícita («recuérdame…»), Vex lo crea directo, como hoy.
- **Red de seguridad, solo si hace falta**: si las conversaciones de oro muestran que el modelo deja pasar seguimientos, se agrega un clasificador económico que corre después del turno únicamente cuando el texto trae señales (fechas, «mañana», «pendiente», «quedamos en»). Meta medible: detectar ≥ 85 % de los seguimientos de un conjunto etiquetado de 40 turnos, con ≥ 80 % de sugerencias correctas.
- **Extensible**: el mismo mecanismo ofrecerá «Recordar para la tienda» cuando exista la memoria (F4). La bitácora del panel reutiliza la fila compacta y el modal de detalle de QUI-580, y convive con los recordatorios fiscales del plan `calendario-tributario-bitacora` (misma tabla, otro `source`). Las fechas se interpretan en la zona horaria de la tienda.

**Estados visuales: un distintivo de Vex con cinco estados**

Un componente `vex-presence` (el ícono de Vex animado) en el encabezado del hilo y junto al composer, gobernado por una sola señal de estado:

| Estado | Cuándo | Efecto |
|---|---|---|
| **Escuchando (texto)** | La persona teclea en el composer; vuelve a silencio tras ~1,2 s sin teclear | Halo suave que late con el tecleo |
| **Escuchando (voz)** | Dictado activo | Onda que sigue el volumen real del micrófono + cronómetro |
| **Pensando / trabajando** | Desde que se envía hasta el primer texto, y mientras corre una tool | Órbita continua + la línea de progreso que ya existe («Consultando ventas…») |
| **Hablando** | Vex escribe la respuesta o la lee en voz | Barras tipo ecualizador, distintas de la onda de escucha; al leer en voz se resalta el mensaje que suena y aparece «Detener» |
| **Silencio** | Nada de lo anterior | Ícono quieto y la etiqueta «En silencio» |

Cada estado tiene también texto (`aria-live`), no depende solo del color, y con «reducir movimiento» del sistema las animaciones se cambian por íconos fijos. Fuentes de la señal: tecleo del composer, `pipeline.recording()`, `is_agent_typing`, `stream_progress` y el estado `speaking` del servicio de voz.

**Textos, sugerencias y ayudas**

- Sugerencias de bienvenida **según la tienda**: rol, industria, módulos visibles y pendientes reales (caja sin cerrar, stock bajo mínimo, recordatorios de hoy), en vez de las cuatro fijas.
- «¿Cómo funciona Vex?»: una ayuda corta junto al composer (qué puede hacer, por qué pide confirmación, cómo guarda recordatorios, qué recuerda, cómo se borra una conversación) y un recorrido de primera visita con el sistema de tours existente.
- Un solo archivo de textos de Vex (`vex-copy.ts`), verbos y rótulos uniformes, estados vacíos con la misma voz.
- **Design system**: botones, estados vacíos, cargadores y confirmaciones con los componentes compartidos; sin píxeles ni colores fijos; jerarquía tipográfica única; código con resaltado y botón copiar.

---

## 4. Plan por fases

Orden: primero lo que más se ve y menos arriesga (F1), luego ordenar la base (F2), y después valor/esfuerzo con riesgo creciente. Tamaños: **S** ≤ 2 días, **M** 3–6 días, **L** 1,5–3 semanas. Cada tarea de backend nombra su spec focalizado; las de frontend se verifican con Playwright MCP sobre `https://vendix.com` siguiendo la historia de usuario. Todas las fases cierran con conversaciones de oro nuevas en `BE/test/agentic/golden-conversations.es.jsonl`.

### F1 — Interfaz de Vex a nivel «muy pro» (N6) · ≈ 6 semanas · riesgo bajo (T4: **alto**)

Criterio de la fase: entro a `/admin/vex` y veo el chat a pantalla completa con los paneles contraídos; renombro una conversación, recargo y sigo en ella; borro otra y no vuelve; Vex me ofrece guardar un recordatorio sin que yo lo pida; y en todo momento sé si Vex escucha, piensa, habla o está en silencio.

**Por qué va primero**: es lo más visible y casi todo es frontend sobre endpoints que ya existen. **No depende de ninguna otra fase.** Tres puntos de contacto, ninguno bloqueante: (1) los recuerdos de la memoria aún no existen, así que el borrado y las sugerencias de tipo «recordar» se completan en T31 (F4) sobre la extensión que F1 deja lista; (2) los estados visuales no rediseñan el botón «Voz en vivo»: lo retira T17 (F2), que no depende del resto de F2 y puede ir en paralelo; (3) la regla de seguimientos cambia el prompt de Vex por migración (M12), que necesita aprobación y snapshot como toda mutación de filas. Única tarea de alto riesgo: T4, porque borra datos guardados.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T1 | Paneles contraídos al entrar | `VEX/vex-page.component.ts:12-40,63-70`, `VEX/components/vex-chats-sidebar/`, `vex-log-sidebar/` | En 1440 px y en móvil, al abrir `/admin/vex` los dos paneles están contraídos y el hilo centrado; con `vex.chats_collapsed = 'false'` guardado de antes, también; al recargar vuelven a estar contraídos; el panel de bitácora contraído muestra el número de pendientes | Playwright | S |
| T2 | Historial confiable | `FE/routes/private/store_admin.routes.ts:33-39` (ruta `c/:id`), `VEX/state/vex-chat.store.ts:49,401,1362,1503,1545-1560,1857-1885`, `VEX/services/vex-api.service.ts:304-365`, `BE/src/domains/store/ai-chat/ai-chat.service.ts:564-570` (título generado), app `vex_title_generator` (M12) | Con 60 conversaciones, el scroll carga más y el buscador encuentra la más vieja; recargar conserva la conversación abierta; sin red, el mensaje queda con «No se envió · Reintentar» y no se pierde el texto; una respuesta cortada ofrece «Reintentar» con la causa real; el título describe el tema, no los primeros 40 caracteres | `store/ai-chat/ai-chat.conversation-title.spec.ts` + Playwright | M |
| T3 | Renombrar y agrupar por fecha | `BE/src/domains/store/ai-chat/ai-chat.controller.ts:223` + DTO nuevo (1–80 caracteres), `vex-api.service.ts`, `vex-chats-sidebar.component.ts`, encabezado del hilo | Doble clic o menú «Renombrar» edita el nombre en línea; se conserva al recargar y el título automático no lo pisa; un nombre vacío o de más de 80 caracteres muestra el error; los chats se agrupan en Hoy, Ayer, Últimos 7 días y por mes | `store/ai-chat/ai-chat.rename.spec.ts` + Playwright | S |
| T4 | Borrar de verdad (**alto riesgo**) | M1, `BE/src/domains/store/ai-chat/conversation-purge.service.ts` (nuevo), `ai-chat.controller.ts` (`DELETE conversations/:id`), `S3Service`, job de borrado en S3, `vex-chat.store.ts:609`, modal de confirmación compartido | El aviso dice cuántos mensajes y archivos se borran; tras confirmar, la conversación no reaparece al recargar ni en el historial de la tienda; sus archivos ya no existen en S3; la consulta por id responde 404; otro usuario u otra tienda no puede borrarla; lo que Vex había aplicado sigue en Auditoría; con una tarea en curso el botón pide detenerla primero; una conversación de Vexi no se ve afectada | `store/ai-chat/conversation-purge.service.spec.ts` (cada tabla de §3.13, fallo de S3 con reintento, aislamiento por usuario y tienda) | M |
| T5 | Detección continua de seguimientos | `AE/tools/domains/followup.tools.ts` (nuevo, `suggest_followup`), prompt `vex_assistant` (M12), `ai-chat.service.ts` (persistir en `metadata`), `VEX/components/vex-followup-chip/` (nuevo), `VEX/state/vex-log.store.ts`, fila y modal de QUI-580 | Al decir «el viernes llamo al proveedor» aparece la ficha de recordatorio sugerido; Guardar lo crea y se ve en la bitácora sin recargar; No la descarta y no vuelve a salir; en un conjunto etiquetado de 40 turnos detecta ≥ 85 % con ≥ 80 % de aciertos; un turno sin compromiso no muestra ficha | `ai-engine/tools/domains/followup.tools.spec.ts` + conversaciones de oro | M |
| T6 | Estados visuales de Vex | `VEX/components/vex-presence/` (nuevo), `vex-composer.component.ts:~120-140`, `vex-thread.component.ts:~145-190`, `FE/core/services/vexi-voice-pipeline.service.ts:103,122` | Tecleo → «escuchando»; dicto → onda que se mueve con mi voz y cronómetro; envío → «pensando» con el progreso; responde o lee en voz → «hablando», con el mensaje leído resaltado y «Detener»; al terminar → «En silencio»; con «reducir movimiento» activado, íconos fijos con su texto | Playwright (una captura por estado) | M |
| T7 | Textos, sugerencias y ayudas | `VEX/components/vex-welcome/vex-welcome.component.ts:5-10,44`, `VEX/vex-copy.ts` (nuevo), `BE/src/domains/store/vex/` (sugerencias según snapshot), sistema de tours | Las sugerencias cambian con la tienda (una con stock bajo ve «¿Qué debo reabastecer?»; una sin inventario no); «¿Cómo funciona Vex?» explica confirmaciones, recordatorios, memoria y borrado; el recorrido aparece solo la primera vez | `store/vex/vex-suggestions.service.spec.ts` + Playwright | M |
| T8 | Alineación con el design system y pulido del hilo | `VEX/components/*` (botones, estados vacíos, cargadores, modales compartidos), `vex-composer.component.ts:197`, `vex-page.component.ts:63,69`, `vex-plan-card.component.ts:103`, `vex-markdown` | Ningún botón, estado vacío ni cargador hecho a mano; ningún color ni medida fija; código con resaltado y «Copiar»; la página se ve igual de ordenada en claro, oscuro y con la marca de la tienda | Playwright + `skills/vendix-zoneless-signals` (script de auditoría) | M |

T4 lleva **verificador independiente** y marca para RDD (borrado de datos guardados, S3). Toda tarea de frontend carga `vendix-zoneless-signals` y `vendix-ui-ux`.

### F2 — Gobierno de IA: planes claros, tools por rol y configuración solo en superadmin (D6, D8, N1–N5) · ≈ 7,5 semanas · **alto riesgo**

Criterio de la fase: en superadmin armo un plan leyendo dos tarjetas (Vex / Vexi) con su interruptor y sus cupos de mensajes, tokens y voz, sin lista de herramientas; elijo modelo y voz de cada agente en una sola ficha; en la tienda solo hay interruptores, historial y memoria; un usuario sin permiso no puede hacer con Vex lo que no puede hacer en el panel; y ya no existe la voz en vivo. Ninguna tienda pierde el dictado ni la lectura en voz el día del deploy.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T9 | Catálogo único de capacidades y tabla de derechos | `libs/shared-types` (catálogo), M2, `SUB/types/access.types.ts`, `SAS/interfaces/subscription-admin.interface.ts` | La lista de capacidades existe en un solo archivo; backend y frontend la importan; no contiene herramientas ni cupo de acciones | `store/subscriptions/types/ai-capabilities.spec.ts` | M |
| T10 | Resolutor de derechos y cupos por agente | `SUB/services/subscription-access.service.ts`, `subscription-resolver.service.ts`, `promotional-apply.service.ts`, `guards/ai-access.guard.ts`; modo sombra | En modo sombra, superadmin ve un informe «diferencias entre modelo viejo y nuevo» que llega a cero; `NULL` = sin límite, `0` = nada | `store/subscriptions/services/ai-entitlements.resolver.spec.ts` | L |
| T11 | Migración de planes existentes | M3 (`-- DATA IMPACT:`), `BE/prisma/seeds/plan-commercial-lines.seed.ts`, `subscription-plans.seed.ts`, `subscription-plans-production.seed.ts` | Cada plan actual muestra en la pantalla nueva los mismos accesos y cupos de mensajes, tokens y voz que tenía; el dry-run lista filas por plan | `store/subscriptions/services/ai-entitlements.migration.spec.ts` | M |
| T12 | Pantalla del plan en superadmin | `SAS/components/ai-plan-matrix/` (reemplaza `ai-feature-matrix.component.ts`), `SAS/pages/plans/plan-form.component.ts`, `SAS/utils/ai-feature-flags.util.ts`, `BE/src/domains/superadmin/subscriptions/dto/plan.dto.ts`, `plans.service.ts` | Dos tarjetas (Vex, Vexi) + «IA en los módulos»; cupo con unidad, casilla «sin límite», «copiar de otro plan» y resumen en texto; no hay selector de herramientas, cupo de acciones ni excepción por tienda; guardar no borra ninguna capacidad | `superadmin/subscriptions/plans.service.entitlements.spec.ts` + Playwright | M |
| T13 | Herramientas sin recorte del plan y con permiso de rol en cada una (N4) | `AE/ai-agent.service.ts:550-603,1519-1531`, `AE/tools/ai-tool-registry.ts:263-270,506-519`, `AE/tools/interfaces/tool.interface.ts:107`, los 12 archivos de `AE/tools/domains/` sin permiso (§1.15) + `pricing`, `products`, `variants`, `subscriptions`, `AE/tools/bridge/api-bridge.tools.ts`, `AE/sandbox/sandbox-policy.service.ts:390-428`, `access.types.ts:42`, semilla de permisos | Un plan no puede quitarle a Vex ninguna herramienta; un administrador sin permiso de anular órdenes recibe «tu rol no permite anular órdenes» y ninguna tarjeta, y el dueño sí la ve; registrar una tool sin permiso ni marca `public` hace fallar el arranque; el dueño tiene todos los permisos que pide alguna tool | `ai-engine/tools/ai-tool-registry.role-gate.spec.ts` (catálogo completo: toda tool declara acceso; todo permiso existe y lo tiene el dueño; puente, worker y durable fallan cerrado) | L |
| T14 | Cupos y consumo por agente: mensajes, tokens y lectura en voz | `BE/src/domains/store/vexi/vexi-voice-authority.service.ts:126-129`, `vexi-speech.service.ts:230` (medir segundos generados), `vexi-voice.controller.ts:78,99`, `vexi.controller.ts:311,333`, `SUB/contracts/ai-usage-groups.contract.ts`, `FSET/ai-agents/` | Apagar la voz de Vexi en un plan no apaga la de Vex; al agotar el cupo de voz la respuesta llega en texto con «Se acabó la lectura en voz de este mes» y el dictado sigue funcionando; al agotar mensajes o tokens Vex lo dice antes de empezar el turno | `store/vexi/vexi-voice-authority.service.spec.ts` | M |
| T15 | Ficha única del agente en superadmin | `SAI/components/ai-engine-agent-modal.component.ts` (pasa a ficha), `BE/src/domains/superadmin/ai-engine/ai-agents.controller.ts`, `AE/agent-runtime-config.service.ts` (nuevo) | En una sola pantalla veo y cambio modelo, proveedor y voz de Vex y de Vexi; el cambio aplica a todas las tiendas sin deploy; no hay «modo de voz» | `ai-engine/agent-runtime-config.service.spec.ts` | M |
| T16 | Tienda mínima: solo interruptores, historial y memoria (N1) | `SET/dto/settings-schemas.dto.ts:2260-2269`, `SET/defaults/default-store-settings.ts:631`, `FSET/vexi/vexi-settings.component.ts:77-111,283-324`, `FSET/ai-agents/ai-agents-settings.component.ts`, `vex-settings.component.ts:97-190`, `FE/core/store/store-settings/store-settings.facade.ts:163-165` | En Ajustes → Agentes IA solo veo los dos interruptores con su motivo, «Historial» y «Memoria de la tienda»; no hay «motor de voz» ni ningún ajuste técnico; un `PATCH` con `voice_engine` desde una pestaña vieja no da error y no cambia nada | `store/settings/settings.service.vexi.spec.ts` + Playwright | S |
| T17 | Retiro seguro de la voz en tiempo real (N5) | Consulta previa de uso; `VEX/components/vex-composer/vex-composer.component.ts:143-147,180-187,215-267`, `FE/shared/components/vexi-dock/vexi-dock.component.ts:442,456,1079`, `vexi-panel.component.ts:1448`, `BE/src/domains/store/vexi/vexi-realtime.controller.ts:40,54,77`, `vexi.module.ts:62,81`, `SAI/interfaces/ai-engine.interface.ts:130,238-257`, `SAI/components/ai-engine-config-modal.component.ts:288-297`, `FE/public/pricing/components/plan-comparison-table/feature-labels.ts`, M4 | No existe «Voz en vivo» en Vex, en el dock de Vexi, en la tienda ni en superadmin; una tienda que tenía `realtime` dicta y escucha la lectura como las demás; una sesión abierta antes del deploy se cierra y cobra bien; la página de precios ya no ofrece voz en tiempo real | `store/vexi/vexi-realtime.retirement.spec.ts` (sesión nueva = «no disponible»; `close` sigue cobrando; tienda con `realtime` recibe pipeline) + los specs de pipeline existentes en verde | M |
| T18 | Historial de cambios y conversaciones en la tienda (N1) | `FSET/ai-agents/history/` (nuevo), `BE/src/domains/store/vex/vex-activity-feed.service.ts:107`, `AuditService`, `ai-chat.service.ts:338-346` (listado de la tienda) | En «Historial → Cambios» veo quién encendió o apagó cada agente, lo que los agentes aplicaron y las conversaciones borradas (sin contenido); en «Conversaciones» veo el listado de la tienda; nada es editable; otra tienda no ve nada de esta | `store/vex/agent-history.service.spec.ts` + Playwright | M |
| T19 | Estado único «por qué está apagado» | `AE/agent-runtime-config.service.ts`, `FSET/ai-agents/`, ficha de tienda en superadmin | Tienda y superadmin muestran el mismo motivo: el plan o la tienda | `ai-engine/agent-runtime-config.status.spec.ts` | S |
| T20 | Corte al modelo nuevo, reglas y evals | Retiro del lector de `ai_feature_flags` tras la sombra; `skills/vendix-subscription-gate`, `vendix-saas-billing`, `vendix-settings-system`, `vendix-vexi-agent`, `vendix-vex-agent`, `vendix-ai-agent-tools`, `vendix-agent-voice-consent`; conversaciones de oro (cupo agotado por agente, acción negada por rol, tienda sin voz en vivo) | Las reglas de la casa describen el plan sin herramientas, el rol como límite y la voz solo por API; el gate ya no lee el JSON viejo | specs de forma de los graders | S |

Esta fase lleva **verificador independiente** (suscripciones, dinero, permisos, migración de datos) y marca para RDD. T14, T16 y T17 tocan Vexi: cada tarea agrega un test que fija el comportamiento previo de Vexi en dictado, lectura y confirmaciones por voz.

### F3 — Chat de nivel web: contexto y continuidad (R5, R8) · ≈ 2 semanas · riesgo bajo

Criterio de la fase: en una conversación de más de 60 mensajes veo el indicador de contexto subir, el aviso de resumen, y Vex sigue respondiendo bien sobre algo dicho al principio.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T21 | Medidor de contexto | `BE/src/domains/store/ai-chat/ai-chat.service.ts` (reenviar `context_budget`), `VEX/services/vex-api.service.ts`, `vex-chat.store.ts`, `vex-composer.component.ts` | Anillo «Contexto N %» que cambia tras cada respuesta; aviso al pasar 75 % | `ai-chat/ai-chat.context-budget.spec.ts` | S |
| T22 | Compactación automática | `AE/context/conversation-compactor.service.ts` (nuevo), `ai-chat.service.ts` (`buildContextWindow`), M5, app `vex_context_summarizer` | Mensaje «Resumí la conversación anterior» con enlace al resumen; la conversación no falla por desborde; al borrar la conversación el resumen también se borra | `ai-engine/context/conversation-compactor.service.spec.ts` | M |
| T23 | Historial fiel de tools y bloques | `ai-chat.service.ts` (`buildContextWindow`), `AE/context/agent-context-budget.ts` | Al preguntar «¿qué hiciste hace un rato?» Vex enumera las acciones y bloques reales | `ai-chat/ai-chat.context-window.spec.ts` | M |
| T24 | Fallback de modelo y costo real | `AE/ai-engine.service.ts`, ficha del agente (T15), `ai-chat.service.ts:544` | Con el proveedor principal caído, Vex responde con el de respaldo; superadmin ve costo por mensaje | `ai-engine/ai-engine.fallback.spec.ts` | M |

### F4 — Aprender con Vex: ayuda, videos, memoria de tienda y skills (R2, R4, D4, D5, D7, N3) · ≈ 5,5 semanas · riesgo bajo

Criterio de la fase: «quiero aprender a hacer un cierre de caja» → pregunta de formato → reproductor con la ruta; al repetir otro día, con cualquier usuario de la tienda, ya no pregunta; el dueño edita ese recuerdo en Ajustes y Vex usa el texto nuevo. Superadmin edita una skill y Vex usa la versión nueva sin deploy.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T25 | Índice vectorial de artículos | M7 (CHECK), `AE/tools/tool-catalog.ts`, `AE/embeddings/help-knowledge-indexer.service.ts` (nuevo), `BE/src/domains/help-center/articles/articles.service.ts` (evento al publicar) | Un artículo recién publicado aparece en la respuesta de Vex sin deploy | `ai-engine/embeddings/help-knowledge-indexer.service.spec.ts` | M |
| T26 | Índice de videos con el texto de su publicación (sin transcribir) | `help-knowledge-indexer.service.ts` (documento = `title` + `summary` + `description` + `tags` + `keywords` + `module` + categoría), `BE/src/domains/superadmin/video-library/` (evento al publicar, aviso de texto insuficiente) | Vex encuentra un video por una palabra de su descripción o de sus etiquetas; superadmin ve qué videos tienen texto insuficiente | `ai-engine/embeddings/help-knowledge-indexer.videos.spec.ts` | S |
| T27 | Series y rutas de aprendizaje | M7, `BE/src/domains/video-library/series/` (nuevo), `FE/private/modules/super-admin/video-library/` | Superadmin crea una serie ordenando videos; se ve en el centro de ayuda | `video-library/series/video-series.service.spec.ts` | M |
| T28 | Tools de ayuda | `AE/tools/domains/help.tools.ts` (nuevo), consultas de descubrimiento, prompt `vex_assistant` (M12) | Vex responde «cómo hago X» citando el artículo o video real, nunca inventado | `ai-engine/tools/domains/help.tools.spec.ts` | M |
| T29 | Bloques `help_article`, `video`, `learning_path` | `vex-block.service.ts`, `vex-blocks.tools.ts`, `VEX/components/vex-blocks/` | El post se ve como en el centro de ayuda; el video se reproduce dentro del chat | `store/vex/services/vex-block.service.spec.ts` | M |
| T30 | Reproductor persistente | `VEX/services/vex-media-dock.service.ts` (nuevo), `vex-page.component.ts`, reutiliza `app-video-player` | Minimizar, pantalla completa, seguir chateando sin que se corte, avance automático al siguiente video, progreso guardado al recargar | Playwright | L |
| T31 | Memoria de la tienda, visible y editable (D7, N3) | M6, `AE/memory/agent-memory.service.ts` (nuevo), `AE/tools/domains/memory.tools.ts` (nuevo), `vexi-context.service.ts` (`buildVexSnapshot`), `FSET/ai-agents/memory/` (detalle «Memoria de la tienda»), `conversation-purge.service.ts` (T4), `followup.tools.ts` (T5) | Vex dice «Lo recordaré para esta tienda»; en una conversación nueva, con otro usuario de la misma tienda, ya la aplica; en Ajustes el dueño **edita** un recuerdo y la siguiente respuesta usa el texto nuevo, lo **borra** y Vex deja de aplicarlo, y **agrega** uno a mano; otra tienda no la ve; al borrar la conversación de origen, sus recuerdos no editados se borran; aparece la ficha «Recordar para la tienda» | `ai-engine/memory/agent-memory.service.spec.ts` | M |
| T32 | Skills en base de datos, indexadas | M8 (tablas + semilla), `AE/skills/` (repositorio, validador, eventos), `tool-catalog-indexer.service.ts` (tipo `skill`), `AE/tools/domains/skill.tools.ts` | Para 40 preguntas de proceso, la skill correcta está entre las 3 primeras en ≥ 90 %; un borrador nunca aparece | `ai-engine/skills/skill-retrieval.spec.ts` | L |
| T33 | Administración de skills en superadmin | `BE/src/domains/superadmin/ai-engine/ai-skills.controller.ts` (nuevo), `SAI/` (pestaña `skills`: listado, editor, historial, probar búsqueda), `AuditService` | Edito y publico una skill y Vex responde con la versión nueva; veo quién cambió qué y restauro una versión anterior | `superadmin/ai-engine/ai-skills.service.spec.ts` + Playwright | M |

### F5 — Escritura en lote y tareas prediseñadas (R1, D1, D2) · ≈ 6 semanas · **alto riesgo**

Criterio de la fase: tres cambios de dominios distintos se aprueban con un solo clic y el resumen dice exactamente qué se aplicó.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T34 | Contrato y persistencia del lote | M9, `AE/tasks/write-batch.service.ts` (nuevo), `AE/tools/domains/write-batch.tools.ts` (`propose_write_batch`) | Una tarjeta con todos los cambios y su antes → después; más de 25 pasos se parte en varias confirmaciones; un paso que el rol no permite impide proponer el lote y Vex lo explica | `ai-engine/tasks/write-batch.service.spec.ts` | L |
| T35 | Aprobación única y ejecutor | `plan-approval.service.ts` (`approvePlan`), `ai-agent.service.ts` (rama de propuestas de Vex), `vex.controller.ts` | Un clic aplica todo en orden; si el paso 3 falla, el resumen dice «se aplicó hasta el paso 2, el resto se omitió»; un doble clic no duplica nada; un irreversible sale en tarjeta propia | `store/vex/services/plan-approval.batch.spec.ts` | L |
| T36 | Compensación y deshacer | `tool.interface.ts` (`compensate`), 8–10 tools de mayor uso, `write-batch.service.ts` | El resumen ofrece «Deshacer» en los pasos compensables y lo restaura; el resto dice «no reversible desde Vex» | `ai-engine/tasks/write-batch.compensation.spec.ts` | L |
| T37 | Tarjeta de lote | `VEX/components/vex-batch-card/` (nuevo), `vex-chat.store.ts`, `vex-api.service.ts` | Casillas por paso, avance en vivo, resumen final; al recargar la página el estado se conserva | Playwright | M |
| T38 | Auditoría y medición del lote | `write-batch.service.ts`, `AuditService`, `vex-activity-feed.service.ts`, resolutor de T10 | El lote aparece en Auditoría y en el historial de la tienda (T18) con autor, pasos y resultado; el lote consume mensajes y tokens como un turno normal y no existe cupo de acciones (N4) | `ai-engine/tasks/write-batch.audit.spec.ts` | S |
| T39 | Playbooks lanzables | `AE/playbooks/playbook.interface.ts` (`approval: 'batch'`), `VEX/components/vex-welcome/`, 5 playbooks convertidos | Galería «Tareas» en la bienvenida; al elegir una, Vex pregunta lo mínimo y termina con un lote | `ai-engine/playbooks/playbook-validator.spec.ts` | M |
| T40 | Reglas, skills y evals del lote | `skills/vendix-vex-agent/SKILL.md`, `skills/vendix-ai-agent-tools/SKILL.md`, conversaciones de oro (lote feliz, paso denegado por rol, fallo parcial, doble aprobación, irreversible fuera del lote) | Las reglas de la casa dicen lo que el código hace | specs de forma de los graders | S |

Esta fase lleva **verificador independiente** (dinero, permisos, datos) y marca para RDD.

### F6 — Multimodal y documentos (R7) · ≈ 4 semanas · riesgo medio

Criterio de la fase: arrastro una factura, Vex la describe, la guardo en una orden y la veo en la ficha.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T41 | Ingesta unificada | `vexi-attachments.service.ts`, M10, `vex-composer.component.ts` | CSV, XLSX y DOCX suben sin error; el límite y los tipos son los mismos en pantalla y servidor | `store/vexi/vexi-attachments.service.spec.ts` | M |
| T42 | Visión nativa | `ai-chat.service.ts`, `agent-context-budget.ts`, `ai-agent.service.ts`, ficha del agente (bandera de visión del modelo) | Subo una foto de una vitrina y Vex describe lo que hay; con modelo sin visión sigue funcionando por OCR | `ai-engine/context/agent-context-budget.multimodal.spec.ts` | M |
| T43 | Tool `read_attachment` | `AE/tools/domains/ai-toolbox.tools.ts` | Subo un Excel de 2000 filas y Vex lo muestra como tabla y responde sobre él | `ai-engine/tools/domains/ai-toolbox.read-attachment.spec.ts` | M |
| T44 | Guardar y asociar | `AE/tools/domains/documents.tools.ts` (nuevo), `StoredFilesService`, `dossiers`, `purchase-orders.service.ts`, `conversation-purge.service.ts` (lo guardado en un registro no se borra con la conversación) | Tarjeta «Guardar factura.pdf en la orden de compra #123»; al aprobar, el archivo aparece en la orden y sigue ahí después de borrar la conversación | `ai-engine/tools/domains/documents.tools.spec.ts` | M |
| T45 | Documentos en fichas y visor | `FE/private/modules/store/customers/`, `orders/`, modal visor en `VEX/` | Pestaña «Documentos» en cliente y orden; PDF e imagen se abren dentro del chat | Playwright | M |

### F7 — Visualización y cálculo confiable (R3, parte 1) · ≈ 3 semanas · riesgo bajo

Criterio de la fase: una pregunta de análisis devuelve gráfica + tabla + cifras que cuadran con el reporte del módulo.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T46 | Registro de bloques y tipos nuevos | `vex-thread.component.ts`, `vex-blocks/` (timeline, list), `vex-block.service.ts`, `vex-blocks.tools.ts` | Línea de tiempo de una orden, listado en tarjetas; un bloque desconocido muestra un aviso, no un hueco | `store/vex/services/vex-block.service.spec.ts` | M |
| T47 | Gráficos avanzados y exportar | `vex-block-chart.component.ts`, `vex-blocks.tools.ts`, exportador XLSX/CSV | Rosa, apiladas, combinado, embudo; botón «Exportar» descarga el archivo con los mismos datos | `ai-engine/tools/domains/vex-blocks.tools.spec.ts` | M |
| T48 | Tool `compute` y transformaciones | `AE/tools/domains/compute.tools.ts` (nuevo), `vex-block.service.ts` (`transform`) | Variación mes contra mes y margen idénticos al módulo de analítica (regla `vendix-analytics-metrics`) | `ai-engine/tools/domains/compute.tools.spec.ts` | M |

### F8 — Catálogo de voces en superadmin (R6, D6, N5) · ≈ 1,5 semanas · riesgo bajo

Criterio de la fase: en superadmin registro una voz, la escucho, se la asigno a Vex y la siguiente respuesta leída de Vex en cualquier tienda sale con esa voz. La tienda no tiene ningún control de voz y no existe voz en vivo.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T49 | Catálogo de voces y asignación por agente | M11, `SAI/` (pestaña `voices` + selector en la ficha del agente), `AE/agent-runtime-config.service.ts`, `vexi-speech.service.ts` | Lista de voces con «Escuchar»; asignar una a Vex cambia su voz sin tocar la de Vexi | `store/vexi/vexi-speech.service.spec.ts` | M |
| T50 | Proveedores de lectura en voz adicionales | `AE/providers/` (adaptador nuevo), `ai-engine.service.ts:197-205` | Superadmin registra un proveedor nuevo, lo prueba con «Test» y sus voces quedan disponibles en el catálogo | `ai-engine/providers/<proveedor>-speech.provider.spec.ts` | M |

### F9 — Análisis con código en AWS Lambda aislada (R3, parte 2, D3) · ≈ 4–5 semanas · **alto riesgo**

Criterio de la fase: «proyecta las ventas del próximo mes con mis últimos 12 meses» devuelve gráfica y cifras calculadas con código, y el superadmin ve la ejecución auditada.

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T51 | Función Lambda y adaptador de invocación | `infra/agent-sandbox/python/` (imagen, VPC sin salida, rol IAM vacío), `AE/sandbox/` (adaptador detrás del broker; el worker solo encola e invoca) | Con el sandbox apagado, Vex dice que el análisis avanzado no está disponible y usa `compute`; el código nunca corre en el backend ni en el worker | `ai-engine/sandbox/sandbox-lambda-client.service.spec.ts` | L |
| T52 | Tool `run_analysis` | `AE/tools/domains/code-execution.tools.ts`, `vex-block.service.ts`, app `vex_analysis` (M12) | Proyección, correlación y segmentación devuelven bloques; el código usado se puede ver en un desplegable; en un plan sin «Análisis con código» Vex lo dice y usa `compute` | `ai-engine/tools/domains/code-execution.analysis.spec.ts` | M |
| T53 | Certificación de aislamiento | Pruebas de egreso, sistema de archivos, memoria, tiempo y 100 ejecuciones alternando tres tiendas sobre la Lambda real | Informe firmado; sin él, la feature queda apagada | Compuertas del skill `vendix-agent-sandbox-security` | M |

**Totales: 9 fases, 53 tareas, ≈ 39–43 semanas-dev.**

| Fase | Tareas | Semanas | Riesgo |
|---|---|---|---|
| F1 Interfaz de Vex | T1–T8 (8) | ≈ 6 | Bajo (T4 alto) |
| F2 Gobierno de IA | T9–T20 (12) | ≈ 7,5 | Alto |
| F3 Chat de nivel web | T21–T24 (4) | ≈ 2 | Bajo |
| F4 Aprender con Vex | T25–T33 (9) | ≈ 5,5 | Bajo |
| F5 Escritura en lote | T34–T40 (7) | ≈ 6 | Alto |
| F6 Multimodal | T41–T45 (5) | ≈ 4 | Medio |
| F7 Visualización | T46–T48 (3) | ≈ 3 | Bajo |
| F8 Catálogo de voces | T49–T50 (2) | ≈ 1,5 | Bajo |
| F9 Sandbox | T51–T53 (3) | ≈ 4–5 | Alto |
| F10 Code Mode (planeada el 2026-11-22, fuera del total) | T60–T74 (15: 12 de la etapa 1 y 3 de la etapa 2) | ≈ 10–12 (+ 3–4 la etapa 2) | Alto |

Dependencias: **F1 no depende de nada** y arranca primero. F2 va antes de F5, F6, F8 y F9 porque cuelgan sus capacidades de la pantalla nueva de planes (T38, T49, T52) y F8 necesita la ficha del agente (T15); dentro de F2, T13 y T17 no dependen de la matriz y pueden adelantarse. F3 y F4 **no** dependen de F2: con un segundo dev, F1 y F2 corren en paralelo y luego F3 y F4. T31 (F4) completa lo que F1 deja preparado (recuerdos en el borrado y en las sugerencias). F4 necesita T21–T23 solo para conversaciones largas; F6 y F7 antes de F9 (adjuntos y bloques alimentan el análisis).

Cambios de esfuerzo frente a la versión anterior (34–38 semanas, 8 fases, 44 tareas): **+ 6** por la fase de interfaz (N6), de las que 1 ya existía como «pulido del chat» en la fase de chat, que baja de 3 a 2; **+ 1,5** por la validación por rol en cada tool y el fin del recorte por plan (N4); **+ 1** por el retiro seguro de la voz en tiempo real (N5) y **+ 0,5** por el historial en la tienda (N1); **− 1,5** por eliminar excepciones por tienda, selector de tools y cupo de acciones (N2, N4); **− 1** en la fase de voces, sin voz en vivo ni abstracción realtime (N5). Neto ≈ + 5,5.

### F10 — Code Mode: scripts que componen herramientas y descubrimiento progresivo (S14) · etapa 1 ≈ 10–12 semanas · **alto riesgo**

#### F10.0 Resumen (no técnico)

1. Hoy, para una pregunta que cruza varios módulos, Vex pide los datos de a uno y cada respuesta intermedia pasa por el modelo: más espera y más tokens.
2. Con F10, Vex escribe un programa corto que pide esos datos, los cruza y devuelve solo el resultado; el programa corre encerrado en AWS, sin internet ni llaves, y nunca elige la tienda: la fija el backend.
3. Vex ya busca sus herramientas en vez de cargarlas todas; F10 lo completa para que lea el detalle solo de las que va a usar.
4. La etapa 1 solo lee. Escribir desde el programa es la etapa 2, que aquí solo se planea.
5. Todo arranca apagado y se enciende por plan solo cuando una suite de ataque entre tiendas falle siempre y la medición confirme el ahorro.
6. Esfuerzo: etapa 1 ≈ 10–12 semanas-dev (≈ 3 de descubrimiento y ≈ 8–9 de scripts); etapa 2 ≈ 3–4.

> Planeada el 2026-11-22 sobre `develop` @ `7f974a79c` (F1–F9 ya integradas, PR #1309–#1319). Rafael aprobó la idea ese día (L13). Convención de rutas del documento (`BE`, `AE`, `FE`, `VEX`) más `INFRA` = `infra/agent-sandbox`. ✔ = verificado directamente por el orquestador; el resto lo levantaron exploradores de solo lectura (L14).

Criterio de la fase: una pregunta que cruza tres módulos se responde con un script en una sola vuelta, con menos tokens que hoy medidos en el banco de tareas, y la suite de ataque entre tiendas falla siempre.

#### F10.1 Historia de usuario

**Como** dueño o administrador de una tienda en el panel web (`/admin/vex`),
**quiero** hacer preguntas que crucen varios módulos y recibir la respuesta en una sola vuelta,
**para** decidir rápido sin esperar ni pagar por cada consulta intermedia.

Pasos en pantalla:
1. Con «Scripts con herramientas» encendido en mi plan, escribo «De las 3 categorías que más vendieron este mes, ¿qué productos tienen margen bajo y stock para más de 60 días?». Veo «Consultando datos · paso 2 de 4» y luego una tabla y tres cifras.
2. Abro «Ver cómo lo calculé»: veo el programa y la lista de consultas que hizo, en solo lectura.
3. Escribo «bájales el precio 5 %»: Vex no escribe desde el programa; me muestra la tarjeta de confirmación de siempre.
4. Un usuario de otra tienda pregunta lo mismo y ve solo los datos de su tienda.
5. Con la capacidad apagada, Vex responde lo mismo consultando herramienta por herramienta, más lento y sin errores.
6. Superadmin ve cada ejecución en la auditoría: tienda, usuario, programa, consultas, duración y resultado.

Criterios de aceptación observables: los de cada tarea en F10.4.

#### F10.2 Diagnóstico: lo que existe y lo que falta

**Ejecutor JS que llama tools (base de la etapa 1)**
- ✔ `run_readonly_script` (`AE/tools/domains/code-execution.tools.ts:31-59`): `readOnly`, fuente JS/TS de hasta 32 KiB y una lista `tools` cuyo enum solo admite `list_products` (`:52`); el handler delega en `broker.run` (`:58`); se registra en `AE/ai-engine.module.ts:186`.
- ✔ Lista blanca fija en código: `SANDBOX_READONLY_ALLOWLIST = ['list_products']`, con la regla «Release-owned semantic audit. Never extend this from env, prompts or DB» (`AE/sandbox/sandbox-policy.service.ts:19-22`). `eligible()` exige además el permiso exacto `store:products:read` y un hash fijo del esquema de parámetros (`:145-160`; `allowedName` en `:554`).
- ✔ Protocolo `SandboxStart` / `SandboxCall` / `SandboxReply` con `execution_id`, `nonce` y `seq` (`AE/sandbox/interfaces/sandbox-protocol.interface.ts:29-53`) y `SANDBOX_LIMITS` (`:17-28`): 30 s de reloj, 2 s de CPU, 256 MB, 20 llamadas, 5000 filas, 2 MiB de entrada, 64 KiB de salida y 32 KiB de fuente. El broker fuerza concurrencia 1 (`AE/sandbox/sandbox-broker.service.ts:106-115`) y valida cada mensaje: claves exactas, `nonce`, `seq` estrictamente secuencial, nombre de tool y ≤ 16 KiB (`:377-400`).
- Autoridad en el host en cada llamada (`onCall`, `sandbox-broker.service.ts:160-296`): la tool debe estar en el manifiesto y ser elegible; `policy.authorize` corre antes (`:197`), después (`:221-230`) y al final (`:306`); el despacho va por `registry.executeToolResult` (`:214`) y el resultado se audita antes de volver al guest (`:243`). La tienda sale de `RequestContextService` (`:38,50-54`), no del script: `resolveAuthority` reconstruye usuario, roles, tienda y gate de plan desde la base y fuerza `is_super_admin` e `is_owner` a falso (`sandbox-policy.service.ts:272-440`).
- Auditoría cifrada en `ai_agent_script_runs` (`AE/sandbox/sandbox-audit.repository.ts:333-420`): fuente cifrada, vencimiento de 7 días, ACL del dueño y, por llamada, `seq`, tool, hash de argumentos y estado.
- **Apagado y nunca desplegado**: el transporte es stdio hacia un supervisor gVisor + Deno (`AE/sandbox/sandbox-client.service.ts:53-61,143-151`) que solo arranca en Linux con rutas y digests configurados (`:15-37`). Ningún archivo de despliegue define `AI_SANDBOX_*` y la imagen dice «Linux QA build ONLY» (`INFRA/Dockerfile:1`). Apagado, responde `SANDBOX_UNAVAILABLE` sin lanzar (`sandbox-broker.service.ts:41-49,406-423`).
- ✔ Vex solo ofrece `run_readonly_script` y `run_analysis` en turnos durables (`AE/ai-agent.service.ts:1585-1590`).

**F9: la receta de Lambda que se copia**
- `SandboxLambdaClientService` invoca con `InvokeCommand` síncrono (`RequestResponse`, `maxAttempts: 1`), carga el SDK de forma diferida y su transporte es inyectable (`AE/sandbox/sandbox-lambda-client.service.ts:25,72-102`). Se enciende con `AI_ANALYSIS_SANDBOX_ENABLED` más ARN, región y un digest certificado que debe coincidir con el desplegado (`:122-139`).
- Contrato `vendix.analysis/v1`, «datos entran → JSON sale» (`AE/sandbox/interfaces/analysis-protocol.interface.ts:15`), con eco de `execution_id`, `nonce` y digest. **La Lambda no llama tools ni tiene camino de vuelta al backend.**
- ✔ IaC en `INFRA/python/template.json`: VPC propia sin IGW, NAT ni endpoints; grupo de seguridad sin ingreso; rol que solo gestiona las ENI que exige la VPC; 1024 MB, 30 s y concurrencia reservada (`:105-108`). `backend-invoke-policy.json` limita `lambda:InvokeFunction` a esa función. **No usa el modo de aislamiento por tenant de Lambda**: los entornos de ejecución se reutilizan entre tiendas y el aislamiento descansa en el proceso hijo y la limpieza de `/tmp`.
- `run_analysis` se registra en `BE/src/domains/store/vex/vex.module.ts:120` detrás de la capacidad `vex.code_analysis` (`:124-135`).

**Descubrimiento progresivo: ya existe a medias**
- ✔ `ToolRouterService` está cableado (`AE/ai-engine.module.ts:108,157`). En cada turno el modelo recibe: el núcleo de Vex, 13 tools (bloques, `compute`, `read_attachment`, `suggest_followup`; `AE/tools/tool-router.service.ts:59-75`); el descubrimiento (`search_tools`, `list_capabilities`, `call_endpoint`, `write_endpoint`, `explain_capability`; `AE/tools/tool-working-set.ts:32-38`); una precarga por significado de hasta 8 tools más las usadas en los últimos 3 turnos, hasta 30 **con esquema completo** (`:11-27`); y un índice `dominio: nombres` de **todas** las tools autorizadas en el prefijo cacheable (`buildToolIndexDigest`, `tool-router.service.ts:524`).
- El catálogo ya está indexado en pgvector (`AE/tools/tool-catalog-indexer.service.ts:31,62`; tipo `tool` en `ai_knowledge_documents` / `ai_embeddings`, 1536 dimensiones) y se busca con `KnowledgeSearchService.rank(…, 'tool')` (`AE/embeddings/knowledge-search.service.ts:81`). Todo se busca sobre las tools autorizadas del turno: permisos ∩ plan ∩ agente − denegadas (`tool-router.service.ts:44-46`).
- Una tool autorizada pero no cargada se carga y se ejecuta en la misma vuelta (`AE/ai-agent.service.ts:2767,3107-3260`): cargar es optimización, no permiso.
- ✔ Si el índice cubre menos del 90 % o no hay evidencia, el router sirve el **catálogo completo** (`tool-router.service.ts:326-331`), y esa caída no queda registrada por turno.
- Registro: ~489 tools declaradas (conteo por grep de `domain:` en `AE/tools`, sin prueba que lo fije), no 300; `register()` rechaza una tool sin regla de acceso (`AE/tools/ai-tool-registry.ts:29,93`) y el permiso del rol se revalida al ejecutar (`:521,575-600`, `AI_AGENT_004`).

**Medición, planes y lotes**
- ✔ El costo en tokens de las definiciones **no se mide**: el span de contexto guarda `definition_tokens: null` y `context_tokens: null` (`AE/ai-agent.service.ts:1871-1875`). `ai_engine_logs` sí guarda por llamada tokens de entrada, salida, lectura y escritura de caché y `cost_usd`; el evento `ai.agent.router` cuenta tools ofrecidas frente a autorizadas.
- Capacidades por plan (F2): `AI_CAPABILITIES` en `BE/src/domains/store/subscriptions/types/ai-capabilities.ts:80` (Vex: `agent`, `model_tokens`, `voice_readout`, `files`, `code_analysis` en `:135`, `advanced_model`), filas en `plan_ai_entitlements` y espejo en `FE/shared/constants/ai-capabilities.ts`.
- Lotes (F5): `propose_write_batch` (`AE/tools/domains/write-batch.tools.ts:9`), propuesta en `BE/src/domains/store/vex/services/write-batch.service.ts:206,356` y ejecución en `write-batch-executor.service.ts:99,277`: base de la etapa 2.
- ✔ Conversaciones de oro y graders en `BE/test/agentic/` (`golden-conversations.es.jsonl`, `b-routing.spec.ts`), y un evaluador sin modelo en `AE/evals/followups/`.

**Lo que falta**
1. Un ejecutor JS en Lambda: el único handler es Python (`INFRA/python/handler.py`) y el runner Deno solo corre bajo el supervisor gVisor local.
2. Un canal para que el script llame tools: la Lambda de F9 no tiene camino de vuelta (a propósito), su cliente está tipado para análisis y el bucle del broker está atado al stdio (`run(start, onCall, signal)`).
3. Una lista blanca de lectura más amplia que `list_products`, hoy fija en cuatro sitios.
4. `describe_tool` y fichas cortas: `search_tools` carga hasta 10 esquemas completos, no hay nivel «nombre + una línea» y el índice crece con cada tool autorizada.
5. Medir los tokens de definiciones y registrar por turno la caída al catálogo completo.
6. Una suite de ataque entre tiendas: hoy no existe un archivo dedicado; la cobertura está repartida en las specs de política y broker.
7. Aislamiento por tienda de los entornos de la Lambda.
8. Scripts en turnos normales: hoy solo en turnos durables.

#### F10.3 Diseño

Patrón de referencia: Cloudflare Code Mode da al modelo una sola tool que recibe código. Dentro del sandbox expone `codemode.search()` y `codemode.describe()`; cada llamada a un conector cruza al host, que la intercepta y aplica aprobaciones y auditoría. La red está bloqueada (`globalOutbound: null`) y el código nunca recibe credenciales. Ante una aprobación, la ejecución queda `paused` con acciones `pending` y se repite el mismo código con los resultados anotados por número de secuencia. El *programmatic tool calling* de Anthropic sigue la misma idea dentro del contenedor del proveedor (no verificado hoy). F10 copia el patrón en casa: el ejecutor es la Lambda y el host es el backend de Vendix. El descubrimiento queda del lado del modelo, porque ya existe con filtro por rol (b); el script solo llama tools que declaró al iniciar.

**a) Canal del puente Lambda ↔ backend**

| Opción | Cómo funciona | Seguridad | Latencia y costo | Operación | Veredicto |
|---|---|---|---|---|---|
| **A. Re-invocación con llamadas pendientes y repetición determinista** | El script corre hasta que todas sus llamadas quedan esperando; la Lambda devuelve `pending`; el backend las ejecuta con la autoridad de la sesión, las anota en un diario que solo él guarda y vuelve a invocar con el mismo código y el diario; el script se repite desde el inicio y lo ya anotado se responde del diario | **La de F9**: sin red, sin llaves, rol solo para ENI; la Lambda solo devuelve JSON que el backend valida | Una invocación por ronda (≤ 6), ~30–80 ms en caliente más el tiempo de las tools; ~0,00001 USD por script | Baja: copia de la receta y de la certificación de F9 | **Recomendada** |
| B. Red privada sin internet hacia una pasarela de tools | La Lambda llama por HTTP a un endpoint interno del backend con un token por ejecución | Abre una ruta de red desde código hostil hacia el host que tiene la base y las llaves (el mismo argumento de D3, `docker-compose.yml:99,128-131,146-147`); el token está en manos del script; la pasarela vive en el proceso que tiene los secretos | Una sola invocación y llamadas síncronas | Alta: peering o ALB privado (~16–20 USD/mes), autenticación, TLS y otro frente que vigilar | Descartada |
| C. Funciones durables de Lambda (checkpoint gestionado y `waitForCallback`) | El mismo patrón de A, gestionado por AWS; el backend responde con `SendDurableExecutionCallbackSuccess` | Según la documentación de AWS, el SDK guarda checkpoints contra la API de Lambda desde dentro de la función: pide permisos IAM y salida hacia esa API, lo que rompe el candado (por confirmar en T63) | Esperas sin costo de cómputo | Media | Descartada por el candado |
| D. Cola intermedia (SQS o Redis) | La Lambda publica llamadas y espera respuestas | Exige red y credenciales dentro del sandbox | Media | Media | Descartada |
| E. Ejecución nativa de un proveedor (Anthropic, Cloudflare) | El script corre en la nube del proveedor | Los datos del comercio salen a un tercero y Vex queda atado a él (opción D de §3.6) | — | Nula | Descartada: Rafael pidió hacerlo en casa |

**Recomendación: A.** Conserva intacto el candado de F9: aunque el código sea hostil, la Lambda no tiene nada que robar ni adónde enviarlo, y el backend sigue siendo la única autoridad. La ventaja de B (una invocación, sin repetir el script) no compensa: un script hace a lo sumo 20 llamadas y repetirlo cuesta milisegundos.

Protocolo `vendix.codemode/v1`, que reutiliza los mensajes y límites de `SANDBOX_LIMITS`:
1. **Inicio, en el backend**: crea la ejecución (`execution_id`, `nonce`, tienda, organización y usuario de la sesión), congela la autoridad, el manifiesto (≤ 20 tools autorizadas de la lista blanca) y un diario vacío que vive **solo en el servidor** (Redis con vencimiento igual al tiempo máximo, más la auditoría).
2. **Ronda *k*, en la Lambda**: se invoca con `TenantId` = hash opaco de la tienda y recibe código, manifiesto, diario, reloj congelado y semilla. Arranca un intérprete nuevo y ejecuta. Cada `tools.<nombre>(args)` recibe un `seq`. Si el diario tiene ese `seq` con la misma tool y el mismo hash de argumentos, responde lo anotado; si no coincide, falla con `CODEMODE_REPLAY_DIVERGENCE`; si no está, queda pendiente. Cuando no queda trabajo devuelve `pending` (≤ 8 llamadas), `completed` (resultado y logs) o `error`.
3. **Entre rondas, en el backend**, cada llamada pendiente pasa por lo que ya existe: `validateFrame`, el manifiesto, `policy.authorize` con autoridad re-derivada de la base, el esquema de argumentos (los campos de tienda u organización se rechazan), `registry.executeToolResult` dentro de `RequestContextService.runIsolated` con el contexto de la sesión, el filtro de tamaño y filas y la auditoría. Recién entonces se anota en el diario y se invoca la siguiente ronda. Si la sesión ya no tiene la misma tienda, la ejecución se aborta. **El diario que viaja a la Lambda es una copia: el backend nunca lee un diario que venga de ella.**
4. **Determinismo**: `Date` congelado al inicio, `Math.random` con semilla por ejecución y sin temporizadores. Un `Promise.all` de llamadas cae en la misma ronda, así el orden de `seq` es estable entre repeticiones.

Ejecutor dentro de la Lambda: un intérprete JS compilado a WASM (QuickJS), dentro de un proceso hijo nuevo por ronda y alojado por Node. Solo existen los globales inyectados (`tools`, `console`, JSON y matemática): no hay `require`, `process`, sistema de archivos ni red. Cada ronda tiene límite de memoria e interrupción por CPU, una segunda pared dentro de la microVM. La alternativa, Node con `--permission`, es más débil; T63 lo confirma con un benchmark. El cómputo pesado sigue en `run_analysis` (Python, F9).

Configuración de la función `vendix-agent-codemode`: la plantilla de F9 (VPC sin salida, rol solo para ENI, raíz de solo lectura, concurrencia reservada y política de invocación limitada a su ARN) más el **modo de aislamiento por tenant** (`TenancyConfig` = `PER_TENANT`). Según la documentación de AWS, en ese modo un entorno de ejecución nunca se reutiliza entre tenants. Además, no se puede cambiar después de crear la función, no admite concurrencia aprovisionada ni SnapStart, y cobra la creación de cada entorno nuevo. T63 verifica que esté disponible en la región de Vendix.

**b) Descubrimiento progresivo: completar lo que existe**

Turno 0 propuesto para Vex:
1. Prompt y memoria de la tienda.
2. Núcleo de Vex (13) más `search_tools`, `describe_tool` (nueva) y `run_code` (si la capacidad está encendida), con esquema completo.
3. La precarga por significado (top 8) pasa a **fichas cortas** sin esquema: nombre, una línea y si lee o escribe.
4. El índice `dominio: nombres` se mide en T60. Si pesa más de lo que ayuda, se reduce a `dominio: n herramientas` más los nombres más usados.
5. `describe_tool(nombre)` devuelve la declaración TypeScript generada desde el esquema JSON, con los ejemplos de `discovery.examples`. Con eso, el modelo la llama directo o la usa dentro de un script.
6. La regla dura se mantiene: una tool autorizada no cargada se puede llamar igual.

- **Filtro por rol**: búsqueda, fichas, `describe_tool`, índice y manifiesto del script salen de las mismas definiciones autorizadas del turno. Una tool que el rol no tiene no aparece en ninguno y, si se nombra, la respuesta es «tu rol no permite…».
- **Caché**: cambiar la lista de tools entre vueltas invalida el prefijo cacheado en algunos proveedores. `describe_tool` entrega la ficha como resultado de tool, sin tocar la lista de definiciones, y T60 mide `cache_read_tokens` antes y después.
- **Catálogo completo de respaldo**: se conserva, pero cada caída queda registrada con su motivo en la telemetría del turno, con alerta si pasa del 5 % de los turnos.

**c) Ruteo directo o script**

| Caso | Ruta |
|---|---|
| 1–2 lecturas, o una tool con filtros | Directo |
| Cualquier escritura (etapa 1) o algo que la persona debe confirmar | Directo, con su tarjeta |
| 3 o más lecturas encadenadas: paginar, recorrer N ids, cruzar dominios, comparar periodos de varias fuentes | Script |
| Datos intermedios que el modelo no necesita leer (más de ~50 filas) | Script; vuelve el resultado o un bloque |
| Estadística pesada (proyección, regresión) | `run_analysis` (Python, F9) sobre los bloques que produzca el script |

- La regla vive en el prompt de Vex (M14), en la descripción de `run_code` y en conversaciones de oro; el servidor la hace cumplir: `run_code` rechaza toda tool que no sea `readOnly`, que sea `clientSide`, que pida confirmación o que sea irreversible. Scripts **también en turnos normales**, con aviso de progreso y máximo 3 por turno (N15).
- **Lo que vuelve al modelo**: `{status, result ≤ 8 KiB, logs ≤ 2 KiB, llamadas, filas vistas}`. Si el script arma un bloque (tabla o gráfico), se valida con `vex-block.service.ts` y se pinta directo al usuario; al modelo llegan el id, el número de filas y una vista previa de 5 filas. **Los datos van a la pantalla, no al contexto.**
- **Lista blanca**: sigue en código, nunca en el entorno, los prompts ni la base (`sandbox-policy.service.ts:19`). La genera desde el registro un script de release: `readOnly`, sin `clientSide`, sin confirmación, con permiso declarado, y sin las tools que llaman a terceros (DIAN, pasarelas de pago, correo, modelos de IA). Se revisa en cada release con un snapshot que falla si cambia sin revisión.

**d) Límites**

| Límite | Valor | Origen |
|---|---|---|
| Fuente | 32 KiB | `SANDBOX_LIMITS.source_bytes` |
| Llamadas a tools por script | 20 | `SANDBOX_LIMITS.calls` |
| Rondas (invocaciones) por script | 6 | nuevo |
| Llamadas pendientes por ronda | 8 | nuevo |
| Tools en el manifiesto | 20 | `authorize` (`sandbox-policy.service.ts:272`) |
| Filas por resultado de tool | 5000 | `SANDBOX_LIMITS.rows` |
| Diario enviado a la Lambda | ≤ 2 MiB, lejos del tope de 6 MB de la invocación síncrona | `SANDBOX_LIMITS.input_bytes` |
| CPU por ronda / reloj total | 2 s / 30 s | `SANDBOX_LIMITS` |
| Memoria del intérprete / de la función | 256 MB / 512 MB | `SANDBOX_LIMITS.memory_mb` / nuevo |
| Resultado al modelo | 8 KiB más bloques por id (salida total ≤ 64 KiB) | nuevo / `SANDBOX_LIMITS.output_bytes` |
| Scripts por turno | 3 | nuevo |
| Concurrencia reservada de la función | 5 | nuevo (F9 usa 3) |

**e) Auditoría**
- Reutiliza `ai_agent_script_runs` (fuente cifrada, 7 días, ACL del dueño, una fila por llamada) y le agrega: ejecutor (`lambda-js`), rondas, ids de solicitud de Lambda, hash de tenant, motivo de corte y bytes devueltos. Esto se hace con M15, solo si el esquema actual no lo cubre.
- Cada llamada interna pasa por el registro: deja su span hijo del span del script y se mide como acción (una por tool exitosa, regla actual).
- La persona ve «Ver cómo lo calculé» con el código y las consultas; superadmin ve la ejecución completa.

**f) Costos y medición de tokens**
- **Lambda**: 512 MB × ~0,3 s × ~4 rondas ≈ 0,6 GB-s ≈ 0,00001 USD por script, más el cargo por entorno nuevo del aislamiento por tenant (precio por confirmar). Es ruido frente al modelo, como en F9.
- **Tokens**: el ahorro sale de dos lados. Uno, un turno 0 más liviano (fichas en vez de esquemas, índice reducido si conviene). Dos, tareas de varios pasos sin datos intermedios en el contexto: un resultado en vez de N, y menos vueltas al modelo. Hoy no hay cifra real, porque `definition_tokens` es nulo; el «~100 k tokens por turno» de §5 es un supuesto que T60 reemplaza por la medición.
- **Medición antes y después (T60 y T70)**:
  - Banco de 30 tareas: las conversaciones de oro de Vex más 15 de varios pasos («top 10 por margen en 3 categorías», «clientes que compraron X y no Y este mes», «órdenes atrasadas por repartidor»).
  - Se corre sobre la tienda demo con un modelo fijo, en tres configuraciones: (0) hoy, (1) descubrimiento completado y (2) más scripts.
  - Por tarea se mide: tokens de entrada (con y sin caché), salida y definiciones, vueltas al modelo, latencia, `cost_usd` y éxito según el grader.
  - El reporte va en `AE/evals/tool-tokens/`, junto a `followups`.
- **Compuerta (N14)**: el descubrimiento se enciende si baja ≥ 30 % los tokens de entrada por turno. Los scripts, si bajan ≥ 50 % los tokens y ≥ 40 % las vueltas en tareas de varios pasos. En ambos casos, sin bajar la tasa de éxito.

**g) Interruptores**
- `AI_CODEMODE_SANDBOX_ENABLED` (apagado por defecto), con ARN, región y digest certificado, bajo la misma regla de F9: el certificado debe coincidir con el desplegado.
- Capacidad `vex.code_mode` en la matriz de F2: sin cupo y apagada en todos los planes (M13).
- `AI_TOOL_DISCOVERY_STUBS` para las fichas cortas y el índice reducido: es una optimización de costo, no una capacidad del plan (N13).
- Con cualquiera apagado, Vex responde con tools directas y sin error visible.

#### F10.4 Tareas

Etapa 1a — descubrimiento (no depende de la Lambda; se puede entregar sola):

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T60 | Medición base de tokens | `AE/ai-agent.service.ts:1871-1875` (llenar `definition_tokens`, `context_tokens`, ofrecidas y motivo de catálogo completo), `AE/tools/tool-router.service.ts:326-331` (motivo de la caída), `AE/evals/tool-tokens/` (nuevo: banco de 30 tareas, script de medición y reporte) | Cada turno de Vex deja en su traza los tokens de definiciones y de contexto y si cayó al catálogo completo; existe el reporte de la configuración (0) con tokens, vueltas, latencia, costo y éxito por tarea, y queda como línea base | `ai-engine/ai-agent.definition-tokens.spec.ts` | M |
| T61 | Fichas cortas y `describe_tool` | `AE/tools/tool-router.service.ts` (`select`, nivel ficha), `AE/tools/tool-working-set.ts` (`CORE_DISCOVERY`), `AE/tools/domains/discovery.tools.ts` (`describe_tool`), `AE/tools/tool-declaration.builder.ts` (nuevo: esquema JSON → TypeScript) | La precarga llega como fichas sin esquema; `describe_tool` devuelve la firma y ejemplos; una tool que el rol no tiene no aparece en búsqueda, fichas, índice ni `describe_tool`, y al nombrarla responde «tu rol no permite…»; llamar una tool autorizada no cargada sigue funcionando | `ai-engine/tools/tool-router.stubs.spec.ts` + `ai-engine/tools/domains/discovery.describe-tool.spec.ts` | M |
| T62 | Turno 0 reducido y respaldo vigilado | `AE/tools/tool-router.service.ts:524` (índice compacto según T60), `AE/ai-agent.service.ts:1966-2000` (texto del ruteo), interruptor `AI_TOOL_DISCOVERY_STUBS`, conversaciones de oro de ruteo | Con el interruptor encendido, la configuración (1) baja los tokens de entrada por turno sin perder tareas del banco; apagado, la traza es idéntica a la de hoy; la caída al catálogo completo se ve por turno y alerta sobre el 5 % | `ai-engine/tools/tool-router.service.spec.ts` + `BE/test/agentic/b-routing.spec.ts` | M |

Etapa 1b — scripts que componen tools (solo lectura):

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T63 | Lambda JS ejecutora | `INFRA/js/` (nuevo: `handler`, runner QuickJS, `Dockerfile`, `template.json` derivado del de F9 con `TenancyConfig` `PER_TENANT`, `backend-invoke-policy.json`, `README.md`) | Un script con dos `Promise.all` termina en 3 rondas usando el diario; una tool fuera del manifiesto falla dentro de la Lambda; `fetch`, `require`, `process` y el sistema de archivos no existen; un bucle infinito corta por CPU; dos invocaciones con distinto `TenantId` no comparten nada | `INFRA/js/handler.test.cjs` + `INFRA/js/template.test.cjs` | L |
| T64 | Puente de llamadas pendientes en el host | `AE/sandbox/interfaces/codemode-protocol.interface.ts` (nuevo; **se fija primero** y T63 lo consume), `AE/sandbox/codemode-bridge.service.ts` (nuevo: rondas, diario en el servidor, divergencia, límites), `AE/sandbox/sandbox-lambda-client.service.ts` (transporte genérico por contrato), `AE/sandbox/sandbox-broker.service.ts` (reusar `onCall` sin stdio) | Cada llamada pendiente pasa por manifiesto, autorización re-derivada, esquema y auditoría antes de entrar al diario; un diario alterado que llegue de la Lambda se ignora; si la sesión cambia de tienda entre rondas, la ejecución se aborta; más de 6 rondas o 20 llamadas cortan con un mensaje claro; apagado, responde «no disponible» sin invocar | `ai-engine/sandbox/codemode-bridge.service.spec.ts` | L |
| T65 | Tool `run_code`, lista blanca y capacidad | `AE/tools/domains/code-execution.tools.ts` (`run_code`; `run_readonly_script` sigue con su transporte hasta N16), `AE/sandbox/sandbox-policy.service.ts:19-22,145-160,554` (lista blanca generada), `scripts/` (generador), `BE/src/domains/store/subscriptions/types/ai-capabilities.ts` y espejo en `FE` (`vex.code_mode`), M13, `AE/ai-agent.service.ts:1585-1590` (turnos normales, ≤ 3 por turno) | En un plan sin la capacidad, Vex no ofrece scripts y responde con tools directas; con ella, un script que pide una tool de escritura, irreversible o de cliente se rechaza antes de invocar; el snapshot de la lista blanca falla si cambia sin revisión; `run_analysis` y `run_readonly_script` siguen igual | `ai-engine/tools/domains/code-execution.code-mode.spec.ts` + `ai-engine/sandbox/codemode-allowlist.spec.ts` | M |
| T66 | Ruteo directo o script | Prompt `vex_assistant` (M14), descripción de `run_code`, `BE/test/agentic/golden-conversations.es.jsonl` (lectura simple → directo; cruce de 3 dominios → script; pedido de escritura → tarjeta; dato con instrucciones que piden otra tienda → sin efecto) | En el banco, las tareas de 1–2 lecturas van directo y las de varios pasos por script en ≥ 80 % de los casos; ninguna escritura sale de un script | `BE/test/agentic/golden-codemode-graders.spec.ts` | M |
| T67 | Auditoría y «Ver cómo lo calculé» | `AE/sandbox/sandbox-audit.repository.ts`, M15 (solo si hace falta), spans hijos, `VEX/components/` (desplegable en la respuesta), vista de ejecuciones en superadmin | La persona ve el código y las consultas en solo lectura; superadmin ve tienda, usuario, rondas, llamadas, duración y resultado; la fuente se descifra solo para el dueño y vence a los 7 días | `ai-engine/sandbox/codemode-audit.spec.ts` + Playwright | M |
| T68 | **Suite de ataque entre tiendas** | `AE/sandbox/codemode.cross-tenant.attack.spec.ts` (nuevo), con scripts hostiles de prueba | El ataque falla siempre en cada caso: (1) `store_id` u `organization_id` en los argumentos; (2) ids de otra tienda (orden, cliente, producto) → 404; (3) diario o `seq` forjados, o `nonce` / `execution_id` de otra ejecución; (4) cambio de tienda en la sesión entre rondas; (5) dos ejecuciones de tiendas distintas intercaladas; (6) tool de alcance organización con rol de tienda; (7) tool sin permiso del rol, o permiso revocado a mitad de la ejecución; (8) tool fuera de la lista blanca o de escritura; (9) residuo entre invocaciones: escribir en `/tmp` o en globales y leerlo desde otra tienda | la propia suite | M |
| T69 | Certificación en la Lambda real | Compuertas de `skills/vendix-agent-sandbox-security`: egreso (internet, DNS, `169.254.169.254`, API de AWS), sistema de archivos, memoria, tiempo, 100 ejecuciones alternando tres tiendas y la suite T68 contra la función desplegada | Informe firmado con el digest certificado; sin él, `AI_CODEMODE_SANDBOX_ENABLED` no enciende | compuertas del skill | M |
| T70 | Medición después y compuerta de encendido | `AE/evals/tool-tokens/` (configuraciones 1 y 2), reporte en este documento | Tabla antes/después por tarea y total; queda escrito si se cumple la compuerta de N14 y qué se enciende | reporte del banco | S |
| T71 | Reglas, skills y documentación | `skills/vendix-agent-sandbox-security`, `vendix-ai-tool-routing`, `vendix-vex-agent` y `vendix-ai-agent-tools`; `INFRA/js/README.md` | Las reglas de la casa dicen lo que el código hace: canal A, lista blanca en código, turno 0 y compuerta | specs de forma de los graders | S |

Etapa 2 — escrituras desde el script (solo se planea; se detalla al cerrar la etapa 1):

| ID | Tarea | Archivos principales | Aceptación observable | Test focalizado | Tam. |
|---|---|---|---|---|---|
| T72 | Escrituras como propuesta → un lote de F5 | `AE/sandbox/codemode-bridge.service.ts`, `write-batch.service.ts:206,356` (`prepareStep`), lista blanca de escritura sin irreversibles | Dentro del script, una tool de escritura devuelve su vista previa real y **no aplica nada**; al terminar, las propuestas forman un solo lote (≤ 25 pasos) con su tarjeta; al aprobar, se ejecuta con el ejecutor de F5 sin volver a correr el script; anular, eliminar, enviar campaña o emitir a la DIAN no se pueden proponer desde un script | `ai-engine/sandbox/codemode-write-proposals.spec.ts` | L |
| T73 | Ataque y certificación de escritura | Extensión de T68 y T69 | Ninguna propuesta cruza de tienda ni se ejecuta sin aprobación; una aprobación repetida no duplica nada; un permiso revocado entre la propuesta y la aprobación bloquea el paso | `ai-engine/sandbox/codemode.cross-tenant.attack.spec.ts` (casos de escritura) | M |
| T74 | Reglas y conversaciones de oro de la etapa 2 | Skills de T71, `golden-conversations.es.jsonl` | Las reglas dicen que el script propone y la persona aprueba | graders | S |

**Totales F10**: etapa 1 = 12 tareas (1a: 3; 1b: 9), ≈ 10–12 semanas-dev; etapa 2 = 3 tareas, ≈ 3–4 semanas-dev (solo planeada). Las migraciones son M13 (capacidad `vex.code_mode`: inserta filas apagadas en `plan_ai_entitlements`), M14 (regla de ruteo en el prompt de Vex: modifica una fila, como M12) y M15 (columnas nulas de auditoría, aditiva y solo si hace falta).

Dependencias y ruta:
- T60 va primero: sin línea base no hay compuerta.
- 1a y 1b no dependen entre sí, salvo T66, que usa `describe_tool` (T61).
- En 1b, T64 fija el contrato antes que T63. Por el disparador de escritores paralelos (`sopus`: escritor `sonnet`, verificador el modelo grande), T63 (`INFRA/js/`) y T64 (`AE/sandbox/`) tienen superficies disjuntas y pueden ir en paralelo; el resto va inline.
- T68 y T69 van antes de encender nada.
- La etapa 2 espera N17 y la etapa 1 certificada.

Alto riesgo: T64, T65, T68, T69, T72 y T73 (seguridad entre tiendas, permisos y aislamiento), y M13–M14 porque mutan filas (alerta en commit y PR, cabecera `DATA IMPACT`, aprobación y snapshot). Llevan **verificador independiente**, que nunca es el modelo que escribió, y marca para RDD. T63 entra en la certificación de T69.

#### F10.5 Riesgos y seguridad

| Riesgo | Mitigación |
|---|---|
| **El script cruza de tienda**: argumentos con `store_id`, ids ajenos, diario forjado o sesión que cambia de tienda | Tienda, organización y usuario salen de la sesión y se re-derivan de la base en cada llamada; los campos de tenant se rechazan por esquema; Prisma con alcance devuelve 404 a ids ajenos; el diario vive solo en el servidor; se aborta si la sesión cambia de tienda; suite T68 obligatoria y certificación T69 |
| Residuo entre tiendas en una Lambda reutilizada | Aislamiento por tenant `PER_TENANT`; proceso hijo e intérprete nuevos por ronda; `/tmp` limpio y raíz de solo lectura; caso 9 de T68 |
| Exfiltración por red | VPC sin IGW, NAT ni endpoints; rol solo para ENI; sin llaves; pruebas de egreso en T69 |
| La Lambda devuelve llamadas o resultados maliciosos | El backend trata todo lo que llega de la Lambda como no confiable: forma, tamaño, `nonce`, `seq`, manifiesto y permisos, igual que una llamada del modelo |
| Una tool marcada `readOnly` que en realidad escribe o llama a un tercero | Lista blanca en código, generada y revisada en cada release con snapshot; sin tools de DIAN, pagos, correo ni IA; nunca se amplía desde el entorno, los prompts ni la base |
| Inyección de instrucciones desde los datos que lleva a un script dañino | La etapa 1 no escribe; manifiesto acotado a tools autorizadas; caso de oro de inyección en T66 |
| Repetición no determinista (el script cambia entre rondas) | Reloj congelado, semilla y sin temporizadores; la divergencia da un error claro y Vex sigue con tools directas |
| Bucles, memoria o salidas enormes | CPU y memoria por ronda en el intérprete, tiempo de la Lambda, 6 rondas, 20 llamadas, 3 scripts por turno y concurrencia reservada |
| El descubrimiento esconde una tool necesaria | Regla dura: una tool autorizada no cargada se puede llamar igual; catálogo completo de respaldo vigilado; banco de 30 tareas |
| El ahorro no aparece (caché rota, scripts que fallan) | Medición antes/después con `cache_read_tokens`; compuerta N14; todo detrás de interruptores |
| Dos ejecutores de JS que mantener (gVisor + Deno sin desplegar y la Lambda) | Retirar el supervisor cuando la Lambda quede certificada (N16) |
| Dependencia de una función nueva de AWS (aislamiento por tenant) | Verificar región y límites en T63; sin ella, T69 no certifica |

#### F10.6 Decisiones pendientes para Rafael

| # | Decisión | Recomendación | Espera |
|---|---|---|---|
| N12 | ¿Qué planes reciben «Scripts con herramientas»? | Capacidad nueva `vex.code_mode`, sin cupo (como N10), apagada en todos los planes hasta certificar; después, los mismos planes que «Análisis con código» | T65 |
| N13 | ¿Las fichas cortas y `describe_tool` se encienden para todas las tiendas sin pasar por el plan? | **Sí**: son ahorro de costo, no una capacidad; interruptor de entorno y encendido tras la compuerta | T62 |
| N14 | Umbrales de la compuerta de encendido | Descubrimiento: ≥ 30 % menos tokens de entrada por turno. Scripts: ≥ 50 % menos tokens y ≥ 40 % menos vueltas en tareas de varios pasos. Ambos sin bajar el éxito | T70 |
| N15 | ¿Scripts también en turnos normales, no solo en tareas durables? | **Sí**, con aviso de progreso y máximo 3 por turno: ahí está el ahorro | T65 |
| N16 | ¿Se retira el supervisor gVisor + Deno nunca desplegado (`infra/agent-sandbox/`)? | **Sí**, en una entrega aparte cuando T69 quede firmado: dos ejecutores duplican lo que hay que auditar | después de T69 |
| N17 | Etapa 2: ¿el script puede proponer escrituras que terminen en un lote de F5? | **Sí, solo como propuesta**: vista previa real, una aprobación y nunca irreversibles; se confirma al cerrar la etapa 1 | T72 |
| N18 | ¿Se muestra el script a la persona? | **Sí**, en el desplegable «Ver cómo lo calculé», en solo lectura, como `run_analysis` (T52) | T67 |

---

## 5. Costos estimados y control

> Precios de lista aproximados, **no verificados en línea hoy**; el orden de magnitud es lo que importa. Antes de fijar cupos, calibrar con `ai_engine_logs.cost_usd` real de las tiendas con Vex activo.

| Concepto | Supuesto de uso | Costo estimado |
|---|---|---|
| Turno de Vex, modelo económico (el de producción hoy, vía OpenRouter) | ~4 iteraciones, ~100 k tokens de entrada (catálogo de tools incluido), ~1,5 k de salida | 0,01–0,03 USD |
| Turno de Vex, modelo de frontera con caché | Igual, con ~80 % de la entrada leída de caché | 0,08–0,35 USD |
| Compactación | 1 resumen cada ~20 turnos, modelo económico | 0,002–0,01 USD |
| Memoria de la tienda | ≤ 2000 caracteres (~600 tokens) en cada turno | < 0,001 USD por turno; despreciable con caché |
| Imagen con visión nativa | ~1–1,5 k tokens por imagen | < 0,01 USD |
| Embeddings de ayuda, videos y skills | ~0,4 M de tokens una vez (300 artículos + texto de publicación de 200 videos + 60 skills) | ~0,01 USD una vez |
| Reindexar una skill al publicarla | ~1 k tokens | despreciable |
| Embedding de cada búsqueda | ~30 tokens | despreciable |
| Transcripción de videos | **Eliminada (D4)** | 0 USD (antes ~4–8 USD una vez, más el job de STT) |
| Voz: lectura de la respuesta por API (TTS) y dictado (STT) | Respuesta de ~600 caracteres ≈ 40 s de audio | ~0,01 USD por respuesta leída (~0,015–0,02 USD/min); la latencia no es criterio (N5) |
| Voz en tiempo real | **Retirada (N5)** | 0 USD (antes 0,05–0,30 USD/min: era la única voz cara) |
| Detección de seguimientos (N6) | Regla en el prompt + definición de una tool, en cada turno (~350 tokens de entrada); clasificador opcional solo en turnos con señales | < 0,001 USD por turno; el clasificador, si se activa, 0,0005–0,002 USD por turno filtrado |
| Título automático de la conversación (N6) | Una vez por conversación, modelo económico, ~300 tokens | < 0,001 USD |
| Sandbox en AWS Lambda (D3) | 10 s a 1 GB | ~0,0002 USD por ejecución; sin costo fijo de host. VPC sin salida = sin NAT que pagar |
| Almacenamiento de documentos | 1 GB por tienda | ~0,02 USD/mes |

Lectura: una tienda con 30 turnos diarios cuesta **~10–25 USD/mes** con modelo económico y **~70–300 USD/mes** con modelo de frontera. El modelo es > 95 % del gasto; embeddings, memoria, sandbox y almacenamiento son ruido. Las decisiones de Rafael no suben el costo de operación: D4 y N5 lo bajan (sin transcripción y sin voz en tiempo real), D5/D7 son texto en base de datos y N6 agrega menos de una décima de centavo por turno.

Cómo se controla (sobre la matriz de §3.11, que reemplaza a `ai_feature_flags`):
- **Cada cupo pertenece a un agente, y solo hay tres** (N4, N5): mensajes/día, tokens/mes y segundos de lectura en voz/mes, para Vex y para Vexi por separado. Nada compartido a escondidas. No hay cupo de acciones ni lista de herramientas: lo que cada usuario puede hacer lo decide su rol.
- **`NULL` = sin límite, `0` = cero.** Los seeds dejan de traer topes simbólicos de 200 M a 20 000 M tokens: o hay tope real o es «sin límite» explícito.
- Las acciones se **miden** (una por tool exitosa, regla actual) para reportes y alertas, pero no se limitan: un lote consume mensajes y tokens como cualquier turno.
- **Aprender no consume cupo** (`search_help`, skills, videos): reduce tickets de soporte.
- Enrutado por costo: modelo económico por defecto, respaldo configurado (T24) y «modelo avanzado» solo en el plan más alto, como capacidad de la matriz.
- Tope de imágenes por turno (5) y de tamaño de dataset para análisis (5000 filas, el límite de bloque): límites técnicos del motor, iguales para todos los planes.
- Barra de consumo por agente en la tienda (T14, si N7 lo confirma): hoy `vex` no tiene barra propia (`ai-usage-groups.contract.ts:29`).

---

## 6. Riesgos y seguridad

| Riesgo | Dónde | Mitigación |
|---|---|---|
| **Borrar una conversación que no era, o borrar de más** (lo borrado no se recupera) | F1 | Modal con las cifras reales y «no se puede deshacer»; solo el dueño de la conversación; borrado por id, nunca masivo; lo aplicado en el negocio, los documentos guardados en registros y la auditoría no se tocan; spec que recorre cada tabla de §3.13; verificador independiente |
| Borrado a medias: la base queda limpia y los archivos siguen en S3, o al revés | F1 | Transacción en la base + cola de objetos S3 pendientes en `ai_conversation_purges` con reintentos; la constancia no se cierra hasta que S3 queda vacío |
| «Borrado de verdad» que el cliente entiende como absoluto | F1 | El aviso y la ayuda dicen qué no se borra: copias de seguridad hasta que rotan, registros del proveedor del modelo y el uso anonimizado para facturación (§3.13) |
| Sugerencias de seguimiento molestas o equivocadas | F1 | Máximo una por turno, sin repetir lo descartado, «No sugerir en este chat»; nada se guarda sin clic; meta medible de precisión en conversaciones de oro |
| Animaciones que distraen o marean | F1 | Respeto de «reducir movimiento», cada estado con texto, sin parpadeos rápidos |
| El modelo nuevo de planes da o quita acceso por error (dinero y suscripciones) | F2 | Modo sombra con registro de diferencias antes del corte; M3 solo inserta y `ai_feature_flags` se conserva como respaldo; dry-run con los planes reales; verificador independiente |
| Cupo regalado o cortado al separar contadores por agente | F2 | El periodo en curso se respeta hasta el corte; el cupo de voz se copia con su valor a cada agente, y sin tiempo real el peor caso es de 1–2 USD al mes por tienda; informe de consumo antes/después |
| **Al quitar el recorte del plan, una tool sin permiso declarado queda abierta a cualquier rol** | F2 | El registro rechaza toda tool sin permiso ni marca `public`; clasificación una por una de los 12 archivos; Vex sigue solo para dueño y administrador hasta que ese control esté en verde (N9); verificador independiente |
| El dueño pierde una herramienta porque su rol no tiene el permiso sembrado | F2 | Test que cruza cada permiso pedido por una tool contra la semilla y el rol dueño |
| Sin cupo de acciones, una tienda dispara miles de acciones | F2 | Los cupos de mensajes y tokens ya acotan el gasto (cada acción consume tokens); presupuesto por objetivo y topes de iteraciones por turno siguen vigentes; las acciones se siguen midiendo y alertando |
| **Retirar la voz en tiempo real apaga también el dictado y la lectura**, que hoy cuelgan de la misma clave | F2 | Primero se separa la voz que se queda (paso 2 de §3.12) con test que la fija; el retiro va después y en dos entregas |
| Una tienda que usaba voz en vivo se queda sin voz o con una sesión colgada | F2 | Conteo previo de tiendas afectadas y aviso; su ajuste se trata como pipeline; `close` sigue cobrando una versión más; nada se borra de sus ajustes |
| Se ofrecía «voz en tiempo real» en planes ya vendidos | F2 | Texto comercial revisado con Rafael antes de publicar; las tiendas afectadas (si las hay) se identifican en el conteo previo |
| Un cambio en la ficha del agente afecta a **todas** las tiendas a la vez (ya no hay excepciones por tienda) | F2, F8 | Auditoría de cada cambio, botón «probar» antes de guardar, modelo de respaldo (T24) |
| Promociones de plan dejan de aplicarse | F2 | Los fusionadores recorren el catálogo único; test por cada overlay existente |
| El historial de la tienda expone conversaciones de un usuario a otro | F2 | Por defecto solo metadatos de las ajenas (N8); lo borrado no aparece; prueba de aislamiento por tienda |
| Un clic aplica muchos cambios equivocados | F5 | Vista previa real por paso (no descrita por el modelo), máximo 25 pasos y 500 registros (D1), irreversibles fuera del lote, hashes de argumentos y preview, parada en el primer fallo, deshacer donde hay compensación |
| El usuario cree que un lote fallido no aplicó nada | F5 | Mensaje fijo «se aplicó hasta el paso N, el resto se omitió» (D2); nunca se promete todo-o-nada |
| Escalada de permisos en el lote | F5 | Permiso del rol verificado por paso al proponer **y** al ejecutar con el usuario vigente; el lote nunca usa un JWT guardado; un paso denegado invalida el lote |
| Inyección de instrucciones desde datos (nombre de cliente, PDF, descripción de un video) que induzca escrituras | F4, F5, F6 | El contenido leído se marca como datos, nunca como instrucciones; ninguna escritura sin tarjeta; `remember` no acepta contenido proveniente de documentos ni de datos leídos |
| **Memoria de tienda envenenada o mal editada**: un usuario guarda o escribe algo y afecta las sesiones de todos | F4 | Solo dueño y administrador usan Vex y editan la memoria; autor y fecha en cada recuerdo y en el historial de cambios; tope de 40 entradas y 2000 caracteres también al editar a mano; lista de exclusión (credenciales, pagos, identidad de terceros); la memoria es preferencia, no otorga permisos ni salta la tarjeta de confirmación |
| **Skill editada en superadmin con instrucciones dañinas o erróneas** llega a todas las tiendas | F4 | Borrador → publicar (dos pasos), validador al guardar, versiones inmutables con autor, restaurar en un clic, auditoría; una skill es guía, no otorga permisos ni salta la tarjeta de confirmación |
| El deploy pisa skills editadas en superadmin | F4 | La semilla usa `ON CONFLICT DO NOTHING`; nunca `UPDATE` de contenido desde migraciones |
| Videos con poco texto no se encuentran | F4 | Aviso «texto insuficiente» en superadmin; el indexador usa todos los campos de texto disponibles; se puede mejorar la descripción sin tocar el video |
| Fuga entre tiendas | Todas | Tablas por tienda (`ai_agent_memories`, `ai_agent_write_batches`, `ai_conversation_purges`) registradas en `StorePrismaService` con prueba de aislamiento; ids ajenos responden 404; skills e índice de ayuda son globales y solo contienen contenido de Vendix |
| Ejecución duplicada | F5 | `operation_id` por paso, token de un solo uso, estado `unknown_effect` que bloquea reintentos |
| Sandbox: escape, exfiltración, residuo entre tiendas | F9 | **Lambda aislada, nunca el worker del backend** (D3): sin red, sin rol IAM, sin secretos ni base de datos; el worker solo invoca; datos de entrada solo de la misma conversación; salida validada por esquema; raíz de solo lectura y limpieza por ejecución; certificación obligatoria (T53); apagado por defecto |
| Permiso `lambda:InvokeFunction` del backend demasiado amplio | F9 | Política limitada al ARN de esa función; la Lambda no puede invocar nada |
| Datos sensibles hacia el proveedor del modelo | F6 | Las imágenes y documentos ya salen hoy al modelo de visión; se documenta por proveedor, URL firmadas de vida corta, sin entrenamiento según contrato del proveedor |
| Compactación que pierde un acuerdo importante | F3 | El resumen conserva cifras, ids y decisiones; los hechos del objetivo durable no se resumen; el resumen es visible |
| Documentos maliciosos | F6 | Verificación de firma de bytes contra tipo, tope de tamaño, descarga por URL firmada, sin ejecutar macros |
| Costo fuera de control | Todas | Cupos de mensajes, tokens y voz por agente, presupuesto por objetivo (ya existe), topes por turno |
| Cambiar una regla de seguridad escrita (una escritura por aprobación) | F5 | Aprobado por Rafael (D1); skills actualizados en la misma entrega (T40); verificador independiente |
| Derechos de los videos embebidos | F4 | Solo videos publicados por Vendix |

Tareas de alto riesgo según la lista de la casa: T4 (borrado de datos guardados y S3); T10, T11, T13, T14, T16, T17 y T20 (suscripciones, dinero, permisos, migración de datos, contrato de ajustes); T34–T36 y T38 (datos, dinero, permisos); T44 (permisos por entidad); T51–T53 (sandbox) y todas las migraciones M1–M12 (alerta en commit y PR; M3, M4, M11 y M12 mutan filas).

---

## 7. Decisiones tomadas (Rafael, 2026-11-20)

| # | Tema | Decisión | Dónde quedó |
|---|---|---|---|
| D1 | Lote de escrituras | **Aprobado**: una confirmación cubre hasta 25 pasos; los irreversibles (anular, eliminar, enviar campaña, emitir a la DIAN) van con tarjeta propia | §3.1, F5 |
| D2 | Fallo parcial | **Aprobado**: «se aplicó hasta el paso N, el resto se omitió» + deshacer donde exista; no se promete todo-o-nada | §3.1, T35–T36 |
| D3 | Sandbox de Python | **AWS Lambda aislada (opción B)**. No los workers del backend: comparten host, red y secretos con la app, y ejecutar ahí código generado por IA expone los datos de todas las tiendas. El worker solo encola e invoca la Lambda | §3.6, F9 |
| D4 | Videos | **No transcribir.** Se indexan con el texto que ya tiene la publicación: `title`, `summary`, `description`, `tags`, `keywords`, `module` y categoría (`schema.prisma:7494-7524`) | §3.2, T26 |
| D5 | Skills | **En base de datos**, vectorizadas, administrables desde superadmin, con versiones y auditoría; semilla inicial por migración | §3.2, T32–T33 |
| D6 | Voz y configuración agéntica | Catálogo de voces y proveedores en superadmin. **Toda la configuración agéntica de Vex y de Vexi (modelo, voz, proveedores) solo desde superadmin**; se retira de la tienda. Ajustada por N5: ya no existe «modo de voz» | §1.13, §3.7, §3.10, F2 (T14–T19), F8 |
| D7 | Memoria | **Por tienda**, en base de datos, estilo `MEMORY.md`, cargada en todas las sesiones de la tienda; diseñada para pasar a por usuario (`user_id` nulo hoy) | §3.3, T31 |
| D8 | Planes | **Rediseñar** la configuración de IA por plan, separada por agente (Vex / Vexi), sin redundancia. Ajustada por N2, N4 y N5: el plan solo enciende o apaga y fija cupos de mensajes, tokens y voz; sin herramientas, sin excepciones y sin voz en vivo. Aprender no consume cupo; Vex sigue solo para dueño y administrador | §1.14, §3.11, F2 (T9–T12, T20) |
| N1 | Tienda frente a superadmin (18:28) | En la tienda quedan **solo** los interruptores «Usar Vex» / «Usar Vexi» y el historial de cambios y conversaciones. Ninguna configuración avanzada en la tienda | §3.10, T16, T18 |
| N2 | Excepciones (18:28) | Superadmin **no** fija excepciones por tienda. Solo configura **por plan**: activar o desactivar el agente o una capacidad. Se eliminan `ai_agent_store_overrides` y los pilotos por tienda | §3.10, §3.11, T12 |
| N3 | Memoria (18:28) | Se ve en la configuración de la tienda, en un detalle donde el dueño puede **verla y modificarla** (editar y borrar) libremente | §3.3, T31 |
| N4 | Tools (18:28) | El plan **no restringe herramientas**: Vex tiene todas activas y lo limitan los **permisos del rol** del usuario, validados en cada tool. El plan solo limita **mensajes o tokens** (cupos) y activa o desactiva el agente | §1.15, §3.11, §3.12, T13 |
| N5 | Voz (18:28) | Se **quita la voz en tiempo real** del alcance y de la configuración por ahora (volverá en el futuro). La voz es solo **por API, por respuesta** (lectura de la respuesta), sin importar la latencia. El cupo de voz se replantea solo para esa lectura | §1.16, §3.7, §3.12, T14, T17, F8 |
| N6 | Interfaz «muy pro» (18:30, requerimiento nuevo) | Rediseñar el chat de Vex: paneles contraídos al entrar; historial confiable, renombrar y borrar de verdad; detección continua de recordatorios y bitácora; efectos de escucha, respuesta y silencio; textos, sugerencias y ayudas alineados con el design system | §1.17, §3.13, F1 (T1–T8) |

### Decisiones nuevas abiertas

Ninguna bloquea el arranque de F1 (T1–T3 y T5–T8); cada una indica qué tarea espera por ella.

| # | Decisión | Recomendación | Espera |
|---|---|---|---|
| N7 | N1 dice que en la tienda queda «solo» interruptores e historial. ¿Se conservan el estado del plan y las barras de consumo que hoy se ven ahí, en solo lectura? | **Sí**: no son configuración; con cupos de mensajes y tokens el dueño necesita ver por qué Vex dejó de responder | T16 |
| N8 | En el historial de conversaciones de la tienda, ¿el dueño puede leer las conversaciones de otros usuarios? | **Listado de todas** (quién, cuándo, título) y **contenido solo de las propias**; las de Vexi con clientes, completas | T18 |
| N9 | Si el límite es el rol, ¿Vex se abre a otros roles además de dueño y administrador? | **Todavía no**: abrirlo con un permiso propio (`store:vex:use`) cuando T13 deje en cero las tools sin permiso declarado | T13 (cierre) |
| N10 | N4 dice que el plan solo limita mensajes o tokens. ¿Análisis con código, modelo avanzado y archivos siguen siendo interruptores del plan? | **Sí, como interruptores sin cupo**: son capacidades con costo e infraestructura propios (N2 las permite), no herramientas del negocio | T9, T12 |
| N11 | Al borrar de verdad una conversación, ¿se borran también los recordatorios y notas de bitácora que el usuario guardó desde ella? | **No**: el usuario los guardó aparte y viven en su bitácora; el aviso de borrado lo dice. Los recuerdos de la memoria sí se borran, como pidió Rafael | T4 |

---

## Specs

> Requisitos de la futura implementación, tomados del encargo de Rafael (L1). Las cadenas entre comillas son textuales.

- **S1 — Autonomía y lotes**: "flujos de asistencia largos y pesados, tareas prediseñadas (playbooks) ejecutadas paso a paso" y "preparar un lote de escrituras (plan con vista previa), pedir UNA confirmación y ejecutarlas todas, en vez de pedir permiso por cada escritura. Considera transaccionalidad, idempotencia, reversión/compensación, permisos y auditoría." → §3.1, F5. Decisiones D1 (máximo 25 pasos por confirmación; irreversibles con tarjeta propia) y D2 («se aplicó hasta el paso N, el resto se omitió», deshacer donde exista).
- **S2 — Skills con embeddings**: "catálogo de skills que describen cómo hacer cada proceso de Vendix, indexadas vectorialmente para que Vex encuentre y cargue la skill correcta bajo demanda." → §3.2, T32–T33. Decisión D5: en base de datos, vectorizadas, administrables desde superadmin, con versionado y auditoría.
- **S3 — Visualización y análisis**: "gráficos (líneas, torta/rosa, barras), líneas de tiempo, tablas de datos, listados, analíticas; cálculos confiables; análisis con código en un **sandbox** (p. ej. Python aislado)". → §3.6, F7, F9. Decisión D3: AWS Lambda aislada, no los workers del backend.
- **S4 — Aprendizaje**: "búsqueda vectorial sobre los videos y los posts del centro de ayuda", "Vex pregunta si lo prefiere en video o paso a paso (post); **guarda y recuerda la preferencia del usuario**", "**rutas de aprendizaje** con series de videos publicados por Vendix", "Componente en el chat que muestre el post del video como lo hace el centro de ayuda y los reproduzca ahí mismo, en vista minimizada y pantalla completa, persistente en el chat, y con soporte de múltiples videos (la ruta)". → §3.2, §3.3, F4. Decisiones D4 (videos sin transcribir, indexados con el texto de su publicación) y D7 (la preferencia se guarda en memoria **por tienda**, cargada en todas las sesiones de esa tienda).
- **S5 — Paridad de chat**: "visibilidad del uso de contexto y **compactación automática** cuando se desborda." → §3.4, F3; renombrar y pulido del chat en F1.
- **S6 — Voz configurable**: "Abstraer proveedores de respuesta de voz y permitir otros, p. ej. vía **OpenRouter** (Google Gemini TTS y otros modelos de audio por API)." → §1.6, §3.7, F8. Decisión D6: catálogo de voces y proveedores armado en superadmin. Ajustada por N5 (S12): solo lectura de la respuesta por API.
- **S7 — Multimodal**: "habilitar archivos, documentos e imágenes", "Si el usuario pasa un documento, Vex puede **guardarlo y asociarlo a un registro** (cliente, orden, orden de compra, etc.)", "Análisis de imágenes con el propio modelo si tiene visión o con una herramienta de reconocimiento." → §1.7, §3.5, F6.
- **S8 — Capacidad global**: "subir la capacidad global del agente (calidad de razonamiento, uso de tools, manejo de errores, memoria)." → T23, T24, T31, evals por fase.
- **S9 — Alcance**: "SOLO el agente **Vex** (no Vexi)"; sin `apps/mobile`. Ampliado por S10–S13 el 2026-11-20: Vexi entra en configuración y planes, no en funciones. Supuesto: los servicios compartidos con Vexi (adjuntos, voz, confirmaciones) se modifican sin cambiar el comportamiento de Vexi; cada tarea que los toque agrega un test que fija el comportamiento previo de Vexi.
- **S10 — Configuración agéntica solo en superadmin (D6, alcance nuevo)**: "toda la configuración agéntica de Vex y de Vexi (modelo, voz, modo de voz, proveedores, etc.) se configura ÚNICAMENTE desde superadmin. Quitar de las tiendas toda esa configurabilidad (p. ej. modo de voz en settings/ai-agents de la tienda)", "incluye migración de datos existentes". → §1.13, §3.10, T14–T19. Ajustada por N1, N2 y N5 (S12).
- **S11 — Planes de IA claros (D8, alcance nuevo)**: la configuración actual "es un terror": difícil de configurar, redundante/mezclada; rediseñarla para que separe con claridad "los dos agentes (Vex y Vexi)" y "sus distintas funciones", sin redundancia ni mezcla, "p. ej. matriz agente × capacidad con cupos", manteniendo "la recomendación previa de qué plan recibe qué como valor por defecto editable". → §1.14, §3.11, T9–T12, T20. Ajustada por N2 y N4 (S12): sin herramientas ni cupo de acciones en el plan.
- **S12 — Decisiones N1–N5 (2026-11-20 18:28, textual)**: N1 "en la tienda quedan SOLO (a) los flags de activación («Usar Vex» / «Usar Vexi») y (b) el historial de cambios/conversaciones. Ninguna configuración avanzada en la tienda." N2 "superadmin NO fija excepciones por tienda. Solo configura por PLAN (activar/desactivar agente o capacidad por plan)." N3 "la memoria de la tienda se ve en la configuración de la tienda, en un detalle donde el dueño puede verla y **modificarla** (editar/borrar) libremente." N4 "el plan NO restringe herramientas. Vex tiene TODAS las tools activas; lo que lo limita son los **permisos del rol del usuario** que lo usa (el sistema valida cada tool contra los permisos del rol). El plan solo puede limitar **cantidad de mensajes o tokens** (cupos) y activar/desactivar el agente." N5 "QUITAR la voz en tiempo real (pilotos realtime) del alcance y de la configuración por ahora (se agregará en el futuro). La voz será solo **por API, por respuesta** (TTS de la respuesta), sin importar la latencia." → §1.15, §1.16, §3.3, §3.7, §3.10–§3.12, T13–T18, T31. Supuestos del plan, no pedidos por Rafael: «historial de cambios» = cambios de los interruptores, acciones aplicadas por los agentes, ediciones de memoria y constancias de borrado (N8); las barras de consumo se conservan (N7); el cupo de voz se mide en segundos de audio generado.
- **S13 — Interfaz de Vex a nivel "muy pro" (N6, 2026-11-20 18:30, textual)**: "Barras laterales **contraídas por defecto** al entrar a la pestaña de Vex."; "Historial de conversaciones que se guarde bien (sesiones persistentes y confiables), **renombrar** conversación y **borrar de verdad** (borrado físico, sin retención de datos: mensajes, adjuntos en S3, embeddings/memoria derivada de esa conversación; documenta qué se borra y qué no, p. ej. logs de costo anonimizados)."; "Detección **continua y dinámica** de cuándo hay que guardar un recordatorio o una entrada en bitácora (u otras acciones de seguimiento) durante la conversación, bien integrada"; "cuando la persona escribe o habla por voz, un efecto que muestre que Vex está **escuchando**; cuando Vex responde/habla, un efecto distinto; y estado claro de silencio."; "Alinear y reorganizar la interfaz: textos, sugerencias/recomendaciones, ayudas para entender cómo funciona todo; jerarquía visual limpia y consistente con el design system de Vendix."; "Ubica esta parte temprano en el orden de fases (alto valor visible, bajo riesgo) salvo que haya una dependencia que lo impida". → §1.17, §3.13, F1 (T1–T8).
- **S14 — Code Mode en casa (2026-11-22, textual)**: "Copiar el patrón de Cloudflare Code Mode (https://developers.cloudflare.com/agents/tools/codemode/ y /how-it-works/) y de \"programmatic tool calling\" de Anthropic, pero **en casa** (AWS, sin depender de Cloudflare ni de Anthropic): el modelo escribe un script que llama herramientas de Vendix; el script corre encerrado; al modelo solo vuelve el resultado; y el modelo descubre herramientas bajo demanda (`search`/`describe`) en vez de recibir el catálogo completo (300+ tools) en cada turno." Decisiones: "Etapa 1 = **solo lectura**. Escrituras desde el script = etapa 2 (planéala aparte, breve, sin implementarla ahora)."; "Ejecutor JS en **AWS Lambda aislada**, misma receta de F9 (otra función, mismo candado): sin salida a internet, rol IAM vacío, sin credenciales ni BD dentro. El código del modelo nunca elige la tienda: el backend fija tienda/organización/usuario desde la sesión."; "Detrás de interruptor apagado por defecto y de una capacidad por plan en la matriz de F2."; "Seguridad entre tiendas es requisito duro: debe haber una suite de ataque que intente cruzar tiendas desde el script y falle siempre." La sección debe incluir diagnóstico con evidencia, diseño ("compara al menos: re-invocación con \"pending calls\" vs red privada sin internet; recomienda uno", descubrimiento progresivo, ruteo directo vs script, límites, auditoría, costos y "medición antes/después" de tokens), tareas T60+ por etapa con "la tarea de suite de cruce de tiendas y la de medición de tokens", riesgos, decisiones pendientes y un resumen no técnico de máximo 6 líneas. → F10 (T60–T74). Supuestos del plan, no pedidos por Rafael: «rol IAM vacío» se lee como en F9 (sin permisos salvo la gestión de ENI que exige la VPC); el catálogo real es de ~489 tools declaradas, no 300.

### Archivos críticos y reutilización

- Motor: `AE/ai-agent.service.ts`, `AE/ai-engine.service.ts`, `AE/tools/ai-tool-registry.ts`, `AE/tools/interfaces/tool.interface.ts`, `AE/context/agent-context-budget.ts`.
- Interfaz (F1): `FE/private/modules/store/vex/` (`vex-page.component.ts`, `state/vex-chat.store.ts`, `services/vex-api.service.ts`, `components/vex-composer`, `vex-thread`, `vex-chats-sidebar`, `vex-log-sidebar`, `vex-welcome`); `BE/src/domains/store/ai-chat/ai-chat.controller.ts`, `ai-chat.service.ts`; `AE/tools/domains/reminders.tools.ts`; `FE/core/services/vexi-voice-pipeline.service.ts`.
- Gobierno de IA (F2): `AE/tools/ai-tool-registry.ts` y `AE/ai-agent.service.ts` (permiso por rol y recorte del plan); `BE/src/domains/store/vexi/vexi-realtime.*`, `vexi-speech.service.ts`, `vexi-voice-authority.service.ts`; `BE/src/domains/store/subscriptions/types/access.types.ts`, `services/subscription-access.service.ts`, `subscription-resolver.service.ts`, `promotional-apply.service.ts`; `BE/src/domains/superadmin/subscriptions/plans.service.ts`; `FE/private/modules/super-admin/subscriptions/components/ai-feature-matrix.component.ts`; `BE/src/domains/store/settings/dto/settings-schemas.dto.ts`; `FE/private/modules/store/settings/vexi/vexi-settings.component.ts`; `FE/private/modules/super-admin/ai-engine/`.
- Vex: `BE/src/domains/store/vex/services/plan-approval.service.ts`, `vex-block.service.ts`, `vex.controller.ts`; `BE/src/domains/store/ai-chat/ai-chat.service.ts`.
- Se reutiliza sin reescribir: el control de permisos del registro de tools, `RemindersService` y la bitácora compacta de QUI-580, los componentes compartidos del design system (botón, estado vacío, cargador, modal de confirmación, tours), el servicio de voz por pipeline, `PlanApprovalService` (tokens y hashes), `ai_agent_effects`, `ai_agent_objectives`, `KnowledgeSearchService` e índice global, cargador y validador de playbooks, `StoredFilesService` + `dossiers`, `S3Service` + `S3PathHelper`, `SandboxBrokerService` y su auditoría, `AIProvider.generateSpeech`, `app-video-player`, `app-help-article-card`, `app-timeline`, `app-chart`, `VexiConfirmationCardComponent`.
- Skills a cargar al implementar: `vendix-vex-agent`, `vendix-ai-agent-tools`, `vendix-agent-execution-contract`, `vendix-ai-tool-routing`, `vendix-ai-embeddings-rag`, `vendix-agent-playbooks`, `vendix-agent-sandbox-security`, `vendix-agent-voice-consent`, `vendix-s3-storage`, `vendix-prisma-migrations`, `vendix-prisma-scopes`, `vendix-subscription-gate`, `vendix-saas-billing`, `vendix-settings-system`, `vendix-vexi-agent`, `vendix-agent-procedural-memory`, `vendix-zoneless-signals`, `vendix-agent-golden-conversations`, `vendix-ui-ux`, `vendix-frontend-modal`, `vendix-frontend-state`, `vendix-tour`, `vendix-permissions`, `vendix-date-timezone`, `vendix-error-handling`, `sopus`.

## Tasks

| ID | S# | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T0 | S1–S13 | inline + exploradores (Mapping) | ✅ análisis entregado y actualizado con D1–D8 y N1–N6 | este archivo |
| T1–T8 | S13, S5 | F1 — inline; T4 con verificador independiente (alto riesgo: borrado de datos y S3) | pendiente (requiere aprobación del plan; N11 antes de T4) | — |
| T9–T20 | S10, S11, S12 | F2 — inline + verificador independiente (alto riesgo: suscripciones, permisos, migración de datos) | pendiente (N10 antes de T9 y T12; N7 antes de T16; N8 antes de T18; N9 al cerrar T13) | — |
| T21–T24 | S5, S8 | F3 — inline | pendiente | — |
| T25–T33 | S2, S4, S8, S12 | F4 — delegable en paralelo (backend de ayuda / frontend del reproductor / skills) | pendiente (N3 resuelta) | — |
| T34–T40 | S1 | F5 — inline + verificador independiente (alto riesgo) | pendiente (D1 y D2 resueltas) | — |
| T41–T45 | S7 | F6 — inline | pendiente | — |
| T46–T48 | S3 | F7 — inline | pendiente | — |
| T49–T50 | S6, S12 | F8 — inline | pendiente (D6 y N5 resueltas; depende de T15) | — |
| T51–T53 | S3 | F9 — inline + verificador independiente (alto riesgo) | pendiente (D3 resuelta) | — |
| T0-F10 | S14 | inline + Mapping: dos exploradores `sonnet` de solo lectura y un lector web (`sopus`) | ✅ plan de F10 entregado (2026-11-22) | este archivo, rama `feat/vex-plus-f10` |
| T60 | S14 | F10 1a — escritor `sonnet` (carril A: router/medición, en paralelo con B y C) | hecho (specs: definition-tokens 3/3, tool-router 48/48, agent-trace 17/17, ai-agent.service 109/109, tool-token-metrics 15/15) | `2d53e0ea3` |
| T61 | S14 | F10 1a — escritor `sonnet` (carril A, tras T60: comparte `tool-router.service.ts`); fichas y `describe_tool` detrás de `AI_TOOL_DISCOVERY_STUBS` (apagado = turno idéntico) | hecho (stubs 6/6, describe-tool 8/8, tool-router 48/48, working-set 11/11; sin RED previo observado; `tool-router.agent-core.spec.ts` 8/9 falla antes del cambio: tope 16 vs 17) | `7099f1a45` |
| T62 | S14 | F10 1a — escritor `sonnet` (carril A, tras T61; incluye `--config 1` de la medición) | hecho (tool-router 53/53, ai-agent.service 109/109, discovery-stubs 3/3, routing-budget 18/18, b-routing 54/54, metrics 16/16). Config 1 (bytes_v1): −2,5 % directo / +65,1 % con `describe_tool`; 30/30 alcanzables; índice `dominio: nombres` se mantiene | `80fe97f47` |
| T63 | S14 | F10 1b — escritor `sonnet` (carril C, `infra/agent-sandbox/js/`, disjunto) | hecho (handler 22/22, template 9/9; apagado, sin desplegar) | `d89f77e45` |
| T64 | S14 | F10 1b — contrato fijado por el orquestador; puente: escritor `sonnet` (carril B, `AE/sandbox/`); alto riesgo → verificador independiente | hecho (bridge 22, validator 8, lambda-client 33, broker 38, audit 58; M15 aditiva); verificador pendiente | `00640503d` + `835e7feb9` |
| T65 | S14 | F10 1b — partida: **T65a** escritor `sonnet` (lista blanca generada + política propia de Code Mode, `run_code`, capacidad `vex.code_mode`, registro en `vex.module.ts`; en paralelo con T61, superficies disjuntas) y **T65b** (tras T62: `ai-agent.service.ts`, turnos normales ≤ 3 scripts, contexto de invocación, ofrecer `run_code` solo con capacidad, `ui_blocks` fuera del contexto); alto riesgo → verificador | T65a hecho (allowlist 32/32, code-mode 20/20, bridge 26/26, capacidades 17/17, entitlements 15/15+30/30+33/33, analysis 17/17, policy 87/87, broker 38/38; 141 tools; sin M13); T65b hecho (turno 12/12, sandbox-logging 5/5, ai-agent.service 109/109, code-execution 20/20, b-routing 54/54; RED forzado desactivando las guardas; fuente de `run_code` solo como hash en args públicos; `run_code` se registra solo con el ejecutor disponible). Verificador: 1 bloqueante corregido (B1, ver L19) | T65a `660a7e5d6`, T65b `9a0a6be47`, corrección `0e390ec11` |
| T66 | S14 | F10 1b — escritor `sonnet` (tras T61 y T65; mismo escritor de T65b) | hecho (golden-codemode-graders 8/8, code-mode 13/13, discovery-stubs 3/3, ai-agent.service 109/109, b-routing 54/54, golden-batch 6/6; RED observado: 1/13 y 7/8). Regla `CODE_MODE_ROUTING_RULE` inyectada desde código solo con `run_code` en la autoridad del turno. El «≥ 80 %» se comprueba sobre transcripciones de oro, no sobre un modelo en vivo | `9ff8bca60` |
| T67 | S14 | F10 1b — escritor `sonnet` (tras T64; en paralelo con T61/T65a, sin `vex.module.ts` ni `tools/**`); Playwright diferido: sin servidores en esta corrida (L16) | hecho backend + desplegable Vex (codemode-audit 8/8, audit repo 58/58, agent-history 13/13, trace 17/17); vista FE de superadmin pendiente; propósito no persistido | `7ca687762` |
| T68 | S14 | F10 1b — escritor `sonnet` (tras T65); alto riesgo → verificador | hecho: 9 casos, ningún ataque pasa (attack 76/76, handler Lambda 27/27, bridge 26/26); sin cambios de producción; tras el verificador, +2 casos de revocación con dos tools (attack 78/78). Avisos: args con claves extra no se rechazan (no es riesgo de tienda); el test de bomba de memoria da TIMEOUT bajo carga de CPU (pasa solo). Aislamiento real PER_TENANT queda en T69 | `728a6e0c9` |
| T69 | S14 | F10 1b — certificación en la Lambda real | **fuera de esta corrida**: no se crean ni tocan recursos de AWS (L16); queda el checklist | — |
| T70 | S14 | F10 1b — escritor `sonnet` (tras T62 y T65) | hecho (tool-token-metrics 22/22, RED 6/22; configs 0 y 1 byte-idénticas). Config 2 sobre config 0: multi-paso −6,7 % tokens y −12,8 % vueltas (política), −10,4 % / −17,4 % (máximo); 12/25 tareas multi-paso guionables. **Compuerta N14 de scripts NO cumplida**; éxito pendiente de corrida con modelo en vivo. Nada se enciende | `e8e9b22ad` |
| T71 | S14 | F10 1b — inline (orquestador) | hecho: 4 skills + README del ejecutor JS alineados con el código (oferta solo a `vex`, registro condicionado, fuente solo como hash, regla de ruteo, compuerta N14) | `7f44c354a` |
| T72–T74 | S14 | F10 etapa 2 — solo planeada; verificador independiente en T72 y T73 | pendiente (N17 y etapa 1 certificada) | — |

Evidencia de ruta de T0: disparador Mapping — tres áreas (motor, dominios Vex/voz/ayuda, frontend) en la primera pasada, una cuarta (configuración por tienda, superadmin de IA y planes) en la primera actualización y tres más (validación de tools por rol, voz en tiempo real, interfaz del chat) en la segunda; exploradores con modelo worker permitido por `sopus`; el orquestador verificó por muestreo los puntos marcados ✔.

## Log

- **L1 (2026-11-20, encargo de Rafael, textual en lo esencial)**: "Vex debe ser el agente consolidado y más potente de Vendix, con capacidad agéntica comparable a ChatGPT o Claude en la web, para que Vendix sea un entorno de operaciones empresariales agénticas." Requerimientos 1–8 citados en `## Specs`. Restricciones: "solo análisis y planificación", "NO escribas código de producto, NO hagas commits", "Alcance: SOLO el agente Vex (no Vexi)", sin `apps/mobile`, sin tests ni builds.
- **L2 (2026-11-20)**: exploración con tres lectores en paralelo y verificación directa. Hallazgos que cambian supuestos del encargo: (a) los adjuntos **ya están habilitados** en la UI de Vex, lo que falta es que el modelo los vea y poder asociarlos; (b) la voz no está fija a nivel de modelo (se configura en superadmin), lo fijo es la forma del protocolo realtime y los respaldos en código; (c) la restricción de una escritura por aprobación es **deliberada** y está escrita como regla en el skill de Vex, no una carencia; (d) los playbooks ya están indexados vectorialmente y el tipo `skill` está reservado y vacío; (e) el sandbox existe en código pero nunca se desplegó.
- **L3**: no verificado en esta pasada — precios vigentes de proveedores (§5 son órdenes de magnitud), disponibilidad de modelos de solo voz en OpenRouter, cuántas recetas hay en producción, tope de tamaño de `purchase_order_attachments`, y la topología exacta de AWS para la opción B del sandbox.
- **L4**: espejo en Engram (`odd/vex-agente-avanzado/tasks`, proyecto `vendix`) **pendiente**: las herramientas de memoria no estaban disponibles en esta sesión.
- **L5 (2026-11-20, decisiones de Rafael, textual en lo esencial)**: D1 lote "aprobado como se recomendó (máx. 25 pasos por confirmación; irreversibles con tarjeta propia)". D2 fallo parcial aprobado ("se aplicó hasta el paso N, el resto se omitió", deshacer donde exista). D3: Rafael preguntó si es mejor usar workers propios; decisión "AWS Lambda aislada (opción B), NO los workers existentes del backend: el worker comparte host, red y secretos (BD, llaves) con la app, y ejecutar código generado por IA ahí expone los datos de todas las tiendas"; "el worker propio solo orquesta/encola la llamada a la Lambda". D4: "NO transcribir. Indexar con el texto que ya tiene cada publicación de video en Vendix (título, descripción, tags y demás texto del post)". D5: skills "en base de datos (no archivos del repo), vectorizadas con embeddings para búsqueda rápida, administrables desde superadmin. Semilla inicial por seed/migración. Considera versionado y auditoría de cambios". D6: "catálogo de voces/proveedores armado en superadmin" y NUEVO ALCANCE "toda la configuración agéntica de Vex y de Vexi (modelo, voz, modo de voz, proveedores, etc.) se configura ÚNICAMENTE desde superadmin". D7: "memoria por tienda (no por usuario por ahora; diseñar para poder pasar a por usuario después), en base de datos, estilo archivo MEMORY.md: preferencias que Vex guarda y que se cargan en todas las sesiones de esa tienda. Con pantalla para ver/borrar". D8: la configuración de IA por plan "es un terror"; NUEVO ALCANCE "rediseñar la configuración de capacidades de IA por plan para que separe con claridad los dos agentes (Vex y Vexi) y sus distintas funciones, sin redundancia ni mezcla".
- **L6 (2026-11-20, actualización del plan)**: aplicadas D1–D8 en §0, §1.10, §2, §3, §4, §5, §6 y §7 (que pasa a «Decisiones tomadas»). Cambios: fase nueva **F1 Gobierno de IA** (T1–T9) con diagnóstico en §1.13 y §1.14 y diseño en §3.10 y §3.11; las fases anteriores F1–F7 pasan a F2–F8 y sus tareas se renumeran (T1–T34 → T10–T44, con una tarea nueva, T23, para el editor de skills); se elimina la transcripción de videos, `videos.transcript` y `ai_user_memories`; las migraciones pasan de M1–M7 a M1–M11. Total: 7 fases / 34 tareas / 27–31 semanas → **8 fases / 44 tareas / ≈ 34–38 semanas-dev**. Specs: S10 y S11 nuevas; S9 ampliada.
- **L7 (2026-11-20, evidencia de la actualización)**: un explorador de solo lectura (Mapping) levantó la configuración por tienda, la de superadmin y la de planes. Hallazgos que cambian supuestos: (a) la tienda solo configura **un** ajuste agéntico, `vexi.voice_engine`, y el backend ni siquiera lo lee: la decisión se toma en el navegador; (b) la voz de Vex y la de Vexi comparten la clave de plan `realtime_voice` y un único cupo; (c) en la ruta de cupos, `0` significa ilimitado; (d) `agents_allowed`, `retention_days` y `conversations` se configuran sin efecto en runtime; (e) la lista de claves de IA está copiada a mano en cuatro sitios y ya causó un bug de pérdida de datos al guardar un plan; (f) el worker del backend es la misma imagen que la API, con el mismo `.env` y la misma red (`docker-compose.yml:99,128-131,146-147`), lo que fundamenta D3. Verificado directamente por el orquestador: `vexi-voice-authority.service.ts:126-129`, `subscription-access.service.ts:1491-1493`, `access.types.ts:104-150`, rótulos de `ai-feature-matrix.component.ts:200-262` y `docker-compose.yml`.
- **L8**: no verificado en esta pasada — configuración de canales de Vexi (ecommerce, WhatsApp) a nivel tienda; cuántas tiendas tienen hoy `vexi.voice_engine = 'realtime'` (lo reporta el dry-run de M3); cuántos planes y overlays promocionales existen en producción (dry-run de M2); calidad real del texto de las publicaciones de video; sigue pendiente lo de L3. El espejo en Engram (L4) sigue **pendiente**: sin herramientas de memoria en esta sesión.
- **L9 (2026-11-20 18:28 y 18:30, decisiones de Rafael)**: N1–N5 reemplazan las recomendaciones que el plan traía como abiertas, y N6 agrega la interfaz. Texto literal en S12 y S13.
- **L10 (2026-11-20, segunda actualización del plan)**: aplicadas N1–N6 en §0, historia de usuario, §1.6, §2, §3.3, §3.4, §3.7, §3.9–§3.11, §4, §5, §6, §7, Specs y Tasks; secciones nuevas §1.15 (tools y rol), §1.16 (voz en tiempo real), §1.17 (interfaz), §3.12 (rol como límite y retiro de la voz en tiempo real) y §3.13 (interfaz). Cambios: fase nueva **F1 Interfaz de Vex** (T1–T8); las fases anteriores F1–F8 pasan a F2–F9; el «pulido del chat» sale de la fase de chat y entra en F1. En Gobierno de IA se eliminan `ai_agent_store_overrides`, `ai_agents.voice_engine`, `tools_allowed`, el selector de tools y el cupo de acciones, y se agregan T13 (permiso de rol en cada tool), T17 (retiro de la voz en tiempo real) y T18 (historial en la tienda). La fase de voces pierde la abstracción realtime. Renumeración de tareas: F1 anterior T1–T11 → T9–T20; T12–T14 → T21–T23; T15 → T2, T3 y T8; T16 → T24; T17–T25 → T25–T33; T26–T32 → T34–T40; T33–T37 → T41–T45; T38–T40 → T46–T48; T41–T42 → T49–T50; T43–T45 → T51–T53. Migraciones M1–M11 → M1–M12 (M1 nueva: constancia de borrado; la anterior M3 se reduce a desactivar la app realtime y pasa a M4). Total: 8 fases / 44 tareas / 34–38 semanas → **9 fases / 53 tareas / ≈ 39–43 semanas-dev**. El documento venía con N1–N5 aplicadas solo en la cabecera, §0, la historia y §2; esta actualización lo deja coherente de punta a punta.
- **L11 (2026-11-20, evidencia de la segunda actualización)**: tres exploradores de solo lectura. Hallazgos que cambian supuestos: (a) el permiso del rol **ya se valida** al listar y al ejecutar cada tool, con permisos leídos de la base en cada request; lo que falta es que una tool sin permiso declarado queda abierta a todos (12 archivos de dominio) y que el plan recorta el catálogo en `ai-agent.service.ts:1519-1531`; (b) dictado y lectura en voz, que se conservan, están colgados de la clave `realtime_voice`: quitarla sin separarlos apagaría toda la voz; (c) no hay piloto ni lista de tiendas con voz en tiempo real: es un ajuste que la tienda elige y cuyo default es `pipeline`; (d) «Eliminar chat» **no elimina**: archiva, y el listado vuelve a mostrar el chat al recargar; (e) no existen embeddings derivados de conversaciones; (f) el botón de renombrar no existe aunque el endpoint sí; (g) `/admin/vex` va fuera del layout del panel, así que las barras laterales son solo las dos de Vex, y en escritorio arrancan abiertas; (h) no existe ninguna detección automática de seguimientos. Verificado directamente por el orquestador: `ai-tool-registry.ts:263-270,506-519`, `ai-agent.service.ts:1515-1531`, `vex-composer.component.ts:143-147,215-267`, `vex-page.component.ts:12-34`, `ai-chat.service.ts:338-346`, y los commits de QUI-580 (`46aca4a54`, `8e83a4ca2`, PR #1207).
- **L12**: no verificado en esta pasada — cuántas tiendas tienen `vexi.voice_engine = 'realtime'` y su consumo (conteo previo de T17); el conteo exacto de tools sin permiso (el de §1.15 es por grep); con qué identidad despacha el puente de API (`internal-http.ts:34`) y cómo se puebla el contexto en workers y subagentes; si cada escritura aplicada deja fila en `audit_logs` (condiciona qué hacer con `ai_agent_effects` en T4); el texto actual del prompt de `vex_assistant` en base de datos; dónde se cuenta hoy el consumo de la lectura en voz; si `user_reminders.remind_at` admite nulo para las notas sin fecha; el ancho real de los paneles; precios vigentes de TTS por proveedor. Sigue pendiente lo de L3 y L8. El espejo en Engram (L4) sigue **pendiente**: sin herramientas de memoria en esta sesión.
- **Siguiente paso**: aprobación del plan por Rafael y decisiones N7–N11. F1 puede arrancar con T1–T3 y T5–T8 sin ninguna de ellas (T4 espera N11; la regla de seguimientos de T5 necesita aprobar la migración del prompt). F3 y F4 tampoco dependen de ellas. Rama desde `origin/develop`.
- **L13 (2026-11-22, encargo de Rafael, textual en lo esencial)**: "PLAN ODD de la Fase 10 de Vex Plus — \"Code Mode\" (scripts que componen herramientas + descubrimiento progresivo)". "Esta corrida es SOLO planificación: no escribas código de producto. Único archivo a modificar: `odd/tasks/vex-agente-avanzado.md` (agregar la sección F10)." "Commit del documento y push a `feat/vex-plus-f10`. Sin PR todavía." "Rafael aprobó la idea el 2026-11-22". Requisitos y decisiones citados textualmente en S14. Restricciones: "no toques `apps/mobile`; no corras tests, builds ni servidores (solo lectura de código); no toques cambios ajenos sin commitear."
- **L14 (2026-11-22, evidencia del plan F10)**: dos exploradores `sonnet` de solo lectura (sandbox y Lambda; registro, router, planes y medición) y un lector web (Cloudflare Code Mode). Hallazgos que cambian supuestos del encargo: (a) el descubrimiento bajo demanda **ya existe** (`ToolRouterService`: búsqueda vectorial sobre el catálogo autorizado, precarga, núcleo por agente e índice por dominio), así que F10 lo completa en vez de construirlo; (b) el catálogo tiene ~489 tools declaradas, no 300; (c) el costo en tokens de las definiciones no se mide (`definition_tokens: null`), así que hoy no se puede afirmar ningún ahorro sin T60; (d) la Lambda de F9 no tiene canal hacia el backend y el broker JS está atado al stdio de un supervisor que nunca se desplegó; (e) los scripts solo se ofrecen en turnos durables; (f) Cloudflare Code Mode usa el patrón de la opción A: una ejecución `paused` con acciones `pending` se repite con el mismo código y los resultados anotados por secuencia, la red está bloqueada (`globalOutbound: null`) y el código nunca recibe credenciales. Fuentes externas: https://developers.cloudflare.com/agents/tools/codemode/ y https://developers.cloudflare.com/agents/tools/codemode/how-it-works/; https://docs.aws.amazon.com/lambda/latest/dg/tenant-isolation.html (aislamiento por tenant) y https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html (funciones durables). Verificado directamente por el orquestador: `tool-router.service.ts:44-75,326-331,524`, `tool-working-set.ts:11-38`, `ai-agent.service.ts:1585-1590,1871-1875`, `sandbox-protocol.interface.ts:17-28`, `sandbox-policy.service.ts:19-22`, `ai-engine.module.ts:108,157`, `INFRA/python/template.json:105-108` y la existencia de `BE/test/agentic/golden-conversations.es.jsonl`.
- **L15**: no verificado en esta pasada — tokens reales por turno de Vex hoy (los da T60); disponibilidad del aislamiento por tenant en la región de Vendix y su precio por entorno; si las funciones durables exigen de verdad permisos y salida desde la función (opción C); rendimiento de QuickJS en Lambda; si `assertArgs` ya rechaza campos de tenant en todas las tools candidatas; si F9 dejó una vista de ejecuciones del sandbox en superadmin; precios de *programmatic tool calling* de Anthropic (solo referencia). F1–F9 están integradas en `develop` (PR #1309–#1319), pero la tabla de Tasks de T1–T53 no se reconcilió en esta corrida. Antes de esta corrida el documento vivía sin versionar en el checkout principal (excluido por `.git/info/exclude`); desde aquí queda versionado en `feat/vex-plus-f10`.
- **Siguiente paso (F10)**: aprobación de F10 por Rafael y decisiones N12–N18. T60 (medición base) puede arrancar sin ninguna de ellas y es requisito de toda compuerta de encendido.
- **L16 (2026-11-22, encargo de Rafael, textual en lo esencial)**: "implementar la ETAPA 1 (solo lectura) de la Fase 10 de Vex Plus — Code Mode". "Decisiones N12–N18: Aplica la **recomendación** del propio plan en cada una (N12 capacidad `vex.code_mode` apagada en todos los planes; N13 sí; N14 umbrales tal cual; N15 sí con máx. 3 por turno; N16 no retires nada en esta etapa; N17 no aplica a la etapa 1; N18 sí). Déjalo escrito en el PR como \"decisiones asumidas\"." "SOLO etapa 1 (solo lectura). Etapa 2 (escrituras) NO." "**NO crees ni modifiques recursos reales de AWS** ni uses credenciales […] Para el ejecutor JS de F10 deja código + IaC + README en el repo, apagado por defecto; su despliegue y certificación real van en un encargo posterior." "La suite de ataque entre tiendas y la medición de tokens son obligatorias en esta etapa (con números reales del banco de tareas en el PR)." "MODO PARALELO […] un commit por tarea con push inmediato a `feat/vex-plus-f10` […] NADA de builds completos, `ng test`, suites ni servidores; solo specs focalizados […] y un typecheck puntual al final." "Migraciones Prisma: solo aditivas, cabecera `-- DATA IMPACT:` honesta, idempotentes; sin DELETE/TRUNCATE/DROP/CASCADE". "Al terminar: `git fetch origin && git rebase origin/develop` si es limpio, PR a `develop` […] NO merge, NO main."
- **L17 (2026-11-22, decisiones de ejecución del orquestador)**: (a) el contrato `vendix.codemode/v1` queda fijado en `AE/sandbox/interfaces/codemode-protocol.interface.ts` antes de lanzar T63 y T64 (vectores de hash compartidos; la respuesta de la Lambda no lleva diario); (b) **M14 no se crea**: la regla de ruteo se inyecta desde código solo cuando `run_code` se ofrece, igual que F9 no tocó la fila de `vex_assistant` (`20261225120000_vex_analysis_app`); así la capacidad apagada deja el prompt idéntico (criterio 5 de F10.1) y la corrida cumple "solo aditivas"; (c) T69 no se ejecuta (sin AWS por L16): `AI_CODEMODE_SANDBOX_ENABLED` no puede encender sin el digest certificado; (d) la medición de T60/T70 es determinista sobre el registro real y el estimador del repo (`estimateAgentInputTokens`, bytes, pesimista), porque L16 prohíbe servidores: se informa como estimación, no como tokens observados del proveedor; (e) specs de jest serializados entre escritores con `lockf /tmp/vendix-f10-jest.lock`.
- **L18 (2026-11-22, compuerta N14, T70)**: estimación determinista `bytes_v1` sobre el banco de 30 tareas. Descubrimiento (config 1): −2,5 % directo / +65,1 % con `describe_tool` frente al −30 % exigido → `AI_TOOL_DISCOVERY_STUBS` queda apagado. Scripts (config 2 = config 0 + `run_code` ofrecido + regla de ruteo): en tareas multi-paso, −6,7 % tokens / −12,8 % vueltas con la política de ruteo y −10,4 % / −17,4 % como cota máxima, frente a −50 % / −40 % exigidos; la pata de éxito exige corrida con modelo en vivo → `vex.code_mode` sigue apagado en todos los planes. Causa dominante: la sobrecarga fija de definiciones (~22 k por vuelta) y t11 (~1,07 M con catálogo completo, no guionable); una tarea guionada ahorra ~30 % y baja a 2 vueltas. Siguiente palanca: recortar definiciones por vuelta antes de volver a medir.
- **L19 (2026-11-22, verificador independiente de T64/T65/T68)**: invariantes (a) aislamiento entre tiendas, (b) autoridad viva, (d) fuente, (e) interruptores apagados = línea base, (f) M15 y (g) digest certificado: PASAN. (c) FALLA: **B1** `get_route_map` estaba en la lista blanca y geocodifica paradas sin coordenadas con el proveedor externo y escribe `addresses`; en la misma tanda apareció `list_shipping_config` (`check_buyer` geocodifica y consulta el proveedor de rutas). Corrección única: ambas a `CODEMODE_EXCLUDED` (lista generada 141 → 139, `--check` al día, test fijado; RED 1/33 con la lista anterior). Aviso A1 (los chequeos por tool no tenían test: revocación con un solo tool cae antes en `deny()`): los dos casos de revocación con dos tools del verificador quedan como regresión en la suite de ataque (78/78). Aviso A2 (las lecturas internas no se medían como acción, contra §F10.3 e «una por tool exitosa»): se corrige con `onToolSuccess` del contexto de invocación, una acción por lectura exitosa con clave `codemode:<id>:<seq>` y sin medir el envoltorio (RED 1/14 y 1/27). Avisos sin cambio: A3 otros admins de la tienda ven metadatos de la ejecución (sin fuente); A4 el error del script puede repetir fragmentos de la fuente (como `run_analysis`); A5 memoria procedimental no excluye `run_code` (sin fuga: guarda args públicos); A6 la negación a cocina es la que protege costos y márgenes; A7 sin `AI_CODEMODE_TENANT_KEY_SALT` el TenantId es reversible (configurar sal al desplegar); A8 CHECK de M15 sin `NOT VALID` (tabla pequeña); A9–A10 sin acción. Configs de medición sin cambio de cifras (solo `allowlist_size`).
