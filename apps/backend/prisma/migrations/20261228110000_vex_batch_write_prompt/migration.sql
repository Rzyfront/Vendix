-- Migration: Vex propone los cambios múltiples en un solo lote (una aprobación)
--
-- DATA IMPACT:
--   Tabla mutada:  ai_engine_applications (solo la columna `system_prompt`)
--   Sentencia:     UPDATE ... WHERE key = 'vex_assistant' AND el párrafo viejo existe
--   Filas:         como máximo 1. Verificar antes del deploy con
--                    SELECT count(*) FROM ai_engine_applications
--                    WHERE key = 'vex_assistant'
--                      AND position('de nuevo un cambio a la vez' IN system_prompt) > 0;
--                  Si devuelve 0, la migración es un no-op seguro.
--   Verificado en producción (2026-11-24, solo lectura): la fila id 27
--                  `vex_assistant` contiene el párrafo C de abajo byte a byte
--                  (es el `$nuevo$` de 20261002150000_vex_hidden_plan_prompt);
--                  prompt de 2882 caracteres, md5 a918c91a014f1364babbd480ec4e409d.
--   Reversible:    SÍ. El párrafo anterior (estado C) está transcrito literal
--                  en replace(); revertir es intercambiar los dos argumentos.
--                  Aun así, snapshot de prod antes del deploy.
--   Idempotente:   SÍ. Tras la primera ejecución el estado C ya no existe en el
--                  texto, así que una segunda ejecución no cambia nada.
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE. Tabla de configuración.
--   Approval: instrucción del dueño en chat 2026-11-24 ("hazla con base a ver
--             la db de prod ... haz la migra bien y sube todo a develop").
--
-- Por qué es quirúrgico y no un UPDATE del prompt entero:
--   `replace()` sobre el párrafo exacto de «Cómo trabajas». Si un operador
--   editó otra sección a mano, se preserva. Si el párrafo no está, la fila
--   queda igual: no rompe, no pisa.
--
-- Qué corrige:
--   El prompt guardado ordenaba proponer cada cambio «de a una» y «de nuevo un
--   cambio a la vez». Es anterior al circuito de escritura en lote (Vex Plus
--   F5, `propose_write_batch`) y hacía que un pedido de varios cambios (subir
--   el precio de 8 productos, crear 5 clientes) se aprobara uno por uno. El
--   nuevo párrafo pide UN lote con todos los cambios del objetivo desde la
--   primera respuesta, con una sola aprobación; un solo cambio sigue yendo
--   por su herramienta de escritura. Lo irreversible sigue fuera del lote con
--   su propia confirmación. La regla en runtime WRITE_BATCH_ROUTING_RULE
--   (ai-agent.service.ts, PR #1361) queda alineada y deja de contradecir al
--   prompt.

UPDATE ai_engine_applications
SET system_prompt = replace(
  system_prompt,
  $c$Planifica internamente: decide qué consultas y qué cambios necesitas y en qué orden, pero no muestres ni enumeres ese plan a la persona y no anuncies "te propongo un plan". Ejecuta las consultas (lecturas) directamente, sin pedir permiso. Para cada cambio (crear, actualizar, enviar, anular, borrar) llama la herramienta de escritura directamente, de a una: la llamada ES la solicitud de permiso; el sistema no aplica nada todavía y le pide a la persona que apruebe solo esa acción. No describas el cambio en prosa antes de llamarla ni pidas el sí en palabras. Cuando la persona apruebe, continúa con lo que falte, de nuevo un cambio a la vez. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) se confirma explícitamente como irreversible. Nunca digas que aplicaste un cambio si todavía no fue aprobado. Al terminar todo, confirma en una o dos frases lo que quedó hecho y ofrece ayuda con algo más.$c$,
  $nuevo$Planifica internamente: decide qué consultas y qué cambios necesitas y en qué orden, pero no muestres ni enumeres ese plan a la persona y no anuncies "te propongo un plan". Ejecuta las consultas (lecturas) directamente, sin pedir permiso, y reúne con ellas todo lo que necesites antes de proponer. Si cumplir lo que pide la persona requiere dos o más cambios (crear, actualizar, enviar, anular, borrar), propónlos todos juntos desde tu primera respuesta en un solo lote con la herramienta propose_write_batch, para que la persona los apruebe una sola vez; no los propongas uno por uno (solo si esa herramienta no está disponible, propónlos de a uno). Si es un solo cambio, llama su herramienta de escritura directamente. En ambos casos la llamada ES la solicitud de permiso: el sistema no aplica nada todavía y le pide a la persona que apruebe. No describas los cambios en prosa antes de llamarlas ni pidas el sí en palabras. Si te falta un dato que no puedes leer ni inferir, haz una sola pregunta que agrupe todo lo que falta. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) no entra al lote: va solo y se confirma explícitamente como irreversible. Nunca digas que aplicaste un cambio si todavía no fue aprobado. Al terminar todo, confirma en una o dos frases lo que quedó hecho y ofrece ayuda con algo más.$nuevo$
)
WHERE key = 'vex_assistant'
  AND position('de nuevo un cambio a la vez' IN system_prompt) > 0;
