# Vex/Vexi: proceso de mejora basado en contratos y evidencia

## Alcance y reglas invariables

Esta guía gobierna desarrollo y evaluación; **no es un skill runtime cargado por
el modelo**. La recuperación de playbooks de negocio por intención queda propuesta
hasta acordar contenidos, permisos y evaluación. No cambiar prompts existentes de
DB ni seeds para aparentar que las instalaciones existentes ya mejoraron.

- Permisos reales → scope del agente → scope del plan → narrowing del caller;
  `denied_tools` gana. Dominios, nombres y aliases tienen una sola semántica.
- El catálogo ofrecido también se comprueba al ejecutar; el modelo no autoriza nada.
- Una escritura por aprobación. El plan se conserva, no se autoaprueba.
- Una propuesta no es un cambio aplicado; una Promise resuelta no prueba éxito.
- Una acción UI solo se narra como hecha tras recibir el resultado del navegador.
- No saltar guards/scopes llamando controllers directamente ni usando tokens privilegiados.
- No paralelizar solo por `readOnly`: dependencias y estado auxiliar importan.

## Protocolo para desarrollar un workflow semántico

1. **Definir objetivo y postcondición observables.** Separar consulta, propuesta,
   confirmación, aplicación y verificación. No marcar un entregable listo solo por
   un texto `evidence` producido por el modelo.
2. **Descubrir con los permisos del caller.** Reusar `list_capabilities`,
   `list_endpoints`, tools tipadas y las costuras del dominio. No adivinar campos,
   IDs o prerrequisitos desde el verbo HTTP.
3. **Resolver entidades una vez.** Registrar IDs reales, referencias de adjuntos,
   datos verificados y decisión pendiente. Un proveedor no encontrado sigue no
   encontrado: crear otro registro es una decisión humana, no un fallback técnico.
4. **Validar antes de proponer.** Leer restricciones del DTO y estado real.
   Los schemas anidados/condicionales requieren preflight del dominio; mostrar
   un body o lograr HTTP 200 no demuestra ejecutabilidad ni éxito del negocio.
5. **Proponer el cambio exacto.** Mantener `from → to`, sujeto legible, permisos,
   argumentos y token single-use ligados al usuario. Preservar avisos irreversibles.
6. **Después de aprobar, revalidar y aplicar por la costura existente.** Nunca
   reintentar una escritura con efecto incierto a ciegas. Conservar el ID producido.
7. **Verificar por lectura/postcondición real.** Distinguir `propuesto`, `aplicado`,
   `verificado`, `falló` y `resultado desconocido`. Solo entonces declarar finalizado.
8. **Continuar sin redescubrir.** Conservar entidades resueltas y siguiente acción
   pendiente; aprobar un paso no aprueba el resto.

Este protocolo es una regla de diseño/revisión. No constituye una nueva máquina de
estados persistida ni una garantía de verificación automática en el código actual.

## Contratos que no deben volver a romperse

### Provider multirronda

El adaptador Anthropic traduce assistant tool calls a `tool_use` y resultados a
`tool_result` en un mensaje user agrupado, conservando IDs. Deben ir antes del
texto de seguimiento. Todas las instrucciones system sobreviven; un override
solo reemplaza la base. Esto corresponde al
[contrato oficial de resultados de tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).
Las pruebas simulan el SDK: no certifican compatibilidad de servidores remotos.

### Scope efectivo

Comparar scopes por nombres canónicos/aliases **o dominio**, nunca aplicar un
segundo filtro exacto al dominio `orders`. Ningún filtro añade una tool excluida
por permisos o deny. Las tools de scaffolding del plan tienen su excepción
preexistente; no ampliar esa excepción al negocio.

### Resultados recuperables

Vex compacta resultados grandes como markdown `data.text`. `vex_block_read`
recupera ese texto mediante `text_offset`/`next_offset`, no `data.rows`. No sumar
registros ni parsear como JSON completo un fragmento. `total_chars` son unidades
UTF-16, no bytes ni tokens. El fragmento tiene máximo 3000 unidades y 4000
caracteres de JSON serializado para evitar compactación recursiva. Conservar el
cursor devuelto: calcular una página fija puede saltar texto escapado.

Tablas siguen `page/page_size`, máximo 500 filas por página. Otra tienda, otro
usuario o ausencia de usuario deben responder sin confirmar existencia.

### Reloj y validación

Cuando ya expiró el reloj no añadir una inferencia de cierre. El cierre por
iteraciones con tiempo disponible sigue vigente. La espera UI no consume el
presupuesto de trabajo. **Esto no cancela una inferencia/tool en vuelo**.

La validación central de tools es un subconjunto de JSON Schema y coacciona
cadenas numéricas. Publicar `minimum/maximum` no significa que el registry los
aplique: el reader debe acotar rangos. No cambiar esa compatibilidad global sin
inventario de factories y tests de migración.

## Matriz mínima de regresiones (sin servicios compartidos)

| Costura | Happy | Sad | Brute/bordes |
|---|---|---|---|
| Anthropic SDK payload | Dos rondas con IDs y datos | Arguments históricos inválidos / result sin ID: no SDK call | 50 tool calls agrupadas, multimodal, system override sin perder restricciones |
| Loop ↔ registry | Dominio, nombre y alias permitidos se ejecutan | Scope desconocido o sin permiso no ofrece tool | Un alias denegado no reaparece por dominio ni quema cuota |
| Loop ↔ sink ↔ reader | Recuperar JSON completo sin consultar origen otra vez | Fin del cursor / tipo de argumento inválido | Texto escapado/control bajo 6000 chars; cross-store/user falla cerrado |
| Presupuesto del loop | Final normal y cierre por iteraciones | Timeout antes de empezar: cero inferencias | Última operación consume reloj: cero cierre adicional; UI wait descontada |

Tests de referencia:
- `apps/backend/src/ai-engine/providers/anthropic-compatible.provider.spec.ts`
- `apps/backend/src/ai-engine/ai-agent.service.spec.ts`
- `apps/backend/src/ai-engine/tools/ai-tool-registry.spec.ts`
- `apps/backend/src/domains/store/vex/services/vex-block.service.spec.ts`
- `apps/backend/src/ai-engine/tools/domains/vex-blocks.tools.spec.ts`

Con dependencias instaladas en el worktree, ejecutar **cada spec exacto** con
`npm run test:path -w apps/backend -- src/ai-engine/providers/anthropic-compatible.provider.spec.ts`
y repetir con las otras rutas, una corrida por vez. Nunca `npm test` global.
En un worktree sin dependencias, instalar un toolchain aislado y usar transpilation
por archivo en Jest, `--runInBand`, sin metadata DI; documentar esa limitación.
Un verde de estos contratos **no certifica** compilación global, Nest DI, Redis,
DB, SSE del navegador ni calidad de un modelo real.

Para la misión overnight se usó `.buildcheck/vex/` (ignorado), heap máximo 512 MB,
`/usr/bin/time -l` y logs propios. No usar logs de otra sesión. El provider se
chequea semánticamente por archivo contra el SDK local; importar todo el grafo de
servicios con un tsc individual puede equivaler a un build grande y no es seguro.

## Medición antes de prometer rendimiento

En un entorno aislado/autorizado, repetir el mismo corpus con la misma versión de
prompt/modelo/configuración y dataset. Registrar por turno y tarea:

- Calls reales al provider, intentos/retries y cierre (no solo `iterations`).
- Cantidad de tools ofrecidas, tamaño serializado del prompt/historial/definitions;
  medir tokens con el tokenizer del provider, no convertir bytes en tokens a ciegas.
- TTFT, duración de provider, backend/tools, espera UI/humana y total percibido.
- Cache read/creation tokens por intento, y prefijos idénticos. Un marcador
  `cache_control` no acredita un hit ni garantiza soporte en un compatible.
- Entregables realmente verificados, errores/recovery loops y costo por tarea
  completada. Registrar también fallos y tareas incompletas, no solo casos exitosos.

Corpus inicial: consulta simple, comparación paginada, recuperación de bloque,
una escritura con aprobación, documento con entidad no encontrada, continuación
multietapa y UI que requiere elección humana. Cubrir Vex/Vexi y ambos providers.
No fijar p50/p95 o un % de mejora sin ejecutar corridas comparables; no vender las
latencias de mocks de Jest como latencias del producto.

## Backlog sujeto a supervisión (orden sugerido)

1. **P0**: contrato discriminado de resultados para no contar `{error}` como éxito;
   registrar intentos/duración reales y contexto obligatorio de Vex por runtime.
2. **P1**: catálogo progresivo por intención con expansión autorizada y bridge de
   fallback; búsqueda resumida y `total/has_more/cursor` sin payloads gigantes.
3. **P1**: memoria estructurada persistente de tarea + entidades + postcondiciones;
   playbooks cortos recuperados solo para el workflow actual, con versionado y dueño.
4. **P1**: deadline propagado a provider/HTTP/tools; diseño explícito de efectos
   inciertos. No auto-retry de writes tras abort/timeout.
5. **P2**: lecturas explícitamente independientes con concurrencia limitada;
   streaming nativo de tools validando argumentos completos antes de ejecutarlos.
6. **P2**: nested schemas/preflight de dominio y presets por fase, después de medir
   el corpus. No asumir que temperatura cero cura un contrato roto.

Gate posterior a esta misión: CI full build/DI + E2E con provider real en entorno
propio. Validar consultas, propuesta sin mutar, aprobación single-use, continuación,
lectura de bloques y errores/tenant isolation. No ejecutar contra servicios de otras
sesiones ni contra un tenant real de producción.

## Fase A: instrumentación y baseline reproducible

La observabilidad está siempre activa con scope explícito, redacción de datos y sinks best-effort. No cambia autorizaciones, cuotas ni políticas de retry.

### Qué mide y qué no prueba

- Cada turno instrumentado nace con trace/turn UUID de servidor y scope explícito
  del ALS autenticado. Sin scope no se adopta el último tenant del fallback global.
- Spans de contexto/catálogo, inferencias, intentos/retries, cierre, herramientas,
  espera UI y frontera de aprobación separan la latencia activa de la espera.
  `tool_executed` histórico es un evento de inicio: **no es éxito**.
- Fingerprints de catálogo/prompt/config evitan guardar cuerpos sensibles.
  Tokens de definiciones/contexto no disponibles se representan como desconocidos,
  no se estiman como si fueran tokens exactos del tokenizer del proveedor.
- Una respuesta legacy `success:true` sin verificador independiente se registra
  conservadoramente `partial`. Propuesta = `awaiting_approval`, pregunta explícita
  = `awaiting_input`. A no implementa el contrato de resultados D0 ni el verificador
  D2. No fingir completion del negocio a partir del texto de la respuesta.
- Una frontera de aprobación no mide todo el tiempo humano entre turnos. El
  consentimiento y su posterior aplicación siguen por las costuras existentes;
  el checkpoint durable y la vinculación multiturno pertenecen a D1/D2.
- La fuente canónica de costo es el intento facturable correlacionado. No sumar
  otra vez `ai_engine_logs.cost_usd`, que conserva su semántica legacy. Usage o
  tarifas ausentes = costo desconocido; no asumir que un HTTP fallido fue gratis.

### Privacidad y disponibilidad

No se persisten textos de entrada, argumentos/resultados de tools, documentos,
audio, credenciales, tokens de confirmación ni pensamiento privado en los spans.
Solo atributos admitidos, acotados y hashes. No hay endpoint nuevo para navegar
trazas desde una tienda. Soporte autorizado usa acceso de sistema; la tabla nueva
registra scope y los servicios scoped conservan aislamiento. El buffer de escritura
es acotado y best-effort; pérdida de trazas dispara alarma, no falla la operación
comercial, pero **impide promover** una optimización basada en esa muestra.

Retención propuesta: spans 14 días, agregados 90 días. No se crea ningún job de
purga ni se elimina historia en la migración. Su ejecución posterior requiere
una tarea acotada autorizada. Los datos históricos de logs no se transforman.

### Corpus, comparación y promoción

El corpus versionado y los oráculos están en `apps/backend/test/agentic/` y el
runner en `apps/backend/scripts/agentic-eval.ts` (`eval:agentic` del workspace).
Todos los casos son sintéticos: el brief autoriza no utilizar solicitudes reales.
Congelar 40 desarrollo/10 holdout y fixtures antes de optimizar; replays usan solo
receipts sanitizados, sin ejecutar tools. Los adaptadores ausentes se informan
`not_run` (en particular voz/UI/live), nunca éxito inventado por el fixture.
El informe de esta fase está en `docs/agentic-baseline-A.md`.

Comparar las mismas versiones y restauración de fixtures, modelo, app, prompts,
config y caché fría/caliente; tres repeticiones secuenciales/caso, sin superar el
presupuesto QA explícito. Reportar completion_verified/eligible, outcome_correct,
falsos éxitos, duplicados/violaciones, latencia activa/wall/humano/UI, intentos,
tokens/cache y costos conocidos/desconocidos. El denominador incluye fallos y
`not_run`; negativos no inflan completion. No usar holdout para ajustar prompts.

Gates pendientes de QA real: 100% de 50 casos correlacionables, ≥99% trazas canary
completas, error de costo agregado <1% con usage y overhead p95 <5% contra flag OFF.
Los tests unitarios y replays no prueban esos umbrales. No habilitar por defecto ni
proclamar mejoras de autonomía sin comparaciones y postcondiciones independientes.

### Cobertura técnica de esta entrega y límites operativos

La instrumentación exhaustiva de intentos HTTP cubre el loop buffered de texto y
el `runStream()` existente para SDK OpenAI/Anthropic compatibles. No introduce el
streaming del agente de H. Otros modos multimodales conservan logging redactado y
usage observado, pero **no certifican cobertura exhaustiva de intentos de sus
transportes HTTP**. Un provider personalizado sin transporte observable se marca
`provider_dispatch` / `internal_attempts=unknown`.

Los SDK pueden conservar ceros legacy en la respuesta cuando no reportan usage;
la observación numérica interna preserva `null` sin modificar esa respuesta ni las
cuotas. Para OpenAI, el prompt fresh observado descuenta cache read informado;
Anthropic ya reporta input fresh. La semántica del mapper de replay se declara
explícitamente: un contador sin semántica conocida no se convierte en fresh.

Los índices nuevos sobre logs existentes requieren revisar volumen/locks y ventana
de despliegue en QA. No se ejecutó SQL ni se validó idempotencia contra DB en esta
sesión. `prisma generate` solo regeneró el cliente compartido por el symlink; no
modificó ninguna base. Con flag OFF, el insert de logs selecciona únicamente `id`,
evitando `RETURNING` de columnas nuevas antes de migrar.
