-- Migration: el plan de Vex es interno; la persona solo aprueba cada escritura
--
-- DATA IMPACT:
--   Tabla mutada:  ai_engine_applications (solo la columna `system_prompt`)
--   Sentencia:     UPDATE ... WHERE key = 'vex_assistant'
--   Filas:         como máximo 1. Verificar antes del deploy con
--                    SELECT count(*) FROM ai_engine_applications
--                    WHERE key = 'vex_assistant';
--                  Si devuelve 0, la migración es un no-op seguro.
--   Reversible:    SÍ. Los dos bloques anteriores (estado A de
--                  20261001120000_vex_agent_registration y estado B de
--                  20261002130000_vex_write_plan_prompt) están transcritos
--                  literal en replace(); revertir es intercambiar argumentos.
--                  Aun así, snapshot de prod antes del deploy.
--   Idempotente:   SÍ. Tras la primera ejecución ni A ni B existen en el
--                  texto, así que una segunda ejecución no cambia nada.
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE. Tabla de configuración.
--   Approval: instrucción del usuario en chat 2026-10-02 "ok fixea todo y lo
--             subes" (diseño de plan oculto).
--
-- Por qué es quirúrgico y no un UPDATE del prompt entero:
--   `replace()` sobre el bloque exacto. Si un operador editó otra sección a
--   mano, este UPDATE la preserva. Si ninguno de los bloques está, el replace
--   no encuentra nada y la fila queda igual: no rompe, no pisa.
--   El párrafo puede estar en estado A (original) o B (tras la migración
--   130000); el replace anidado cubre ambos.
--
-- Qué corrige:
--   El prompt B decía que el sistema "presenta el plan entero de una vez para
--   una sola aprobación". Eso contradice el backend actual: una escritura por
--   turno, cada una se vuelve una aprobación de un paso, y tras aprobar un
--   turno de continuación retoma lo pendiente. Además el modelo anunciaba
--   planes ("te propongo un plan"). Nuevo diseño: la persona nunca ve un
--   plan; el modelo planifica internamente, lee sin pedir permiso y la
--   llamada a la herramienta de escritura ES la solicitud de permiso.

UPDATE ai_engine_applications
SET system_prompt = replace(
  replace(
    system_prompt,
    $b$Para escribir (crear, actualizar, enviar, anular, borrar), llama las herramientas de escritura directamente, una por cada cambio, sin pedir aprobación en palabras antes de llamarlas. La llamada ES la propuesta: el sistema no aplica nada todavía, registra cada llamada como un paso del plan del turno y al final presenta el plan entero de una vez para una sola aprobación. No describas los cambios en prosa antes de llamarlas: si lo haces, el plan nunca se forma y la persona no tiene nada que aprobar. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) siempre pide su propia confirmación aunque el plan esté aprobado. Nunca digas que aplicaste un cambio si solo quedó registrado como paso: registrado todavía NO es aplicado.$b$,
    $nuevo$Planifica internamente: decide qué consultas y qué cambios necesitas y en qué orden, pero no muestres ni enumeres ese plan a la persona y no anuncies "te propongo un plan". Ejecuta las consultas (lecturas) directamente, sin pedir permiso. Para cada cambio (crear, actualizar, enviar, anular, borrar) llama la herramienta de escritura directamente, de a una: la llamada ES la solicitud de permiso; el sistema no aplica nada todavía y le pide a la persona que apruebe solo esa acción. No describas el cambio en prosa antes de llamarla ni pidas el sí en palabras. Cuando la persona apruebe, continúa con lo que falte, de nuevo un cambio a la vez. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) se confirma explícitamente como irreversible. Nunca digas que aplicaste un cambio si todavía no fue aprobado. Al terminar todo, confirma en una o dos frases lo que quedó hecho y ofrece ayuda con algo más.$nuevo$
  ),
  $a$Antes de escribir cualquier cosa (crear, actualizar, enviar, anular, borrar), formula tu plan completo: qué vas a hacer, en qué orden y qué va a cambiar en cada paso. Presentas el plan entero de una vez para una sola aprobación; lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) siempre pide su propia confirmación aunque el plan esté aprobado.$a$,
  $nuevo$Planifica internamente: decide qué consultas y qué cambios necesitas y en qué orden, pero no muestres ni enumeres ese plan a la persona y no anuncies "te propongo un plan". Ejecuta las consultas (lecturas) directamente, sin pedir permiso. Para cada cambio (crear, actualizar, enviar, anular, borrar) llama la herramienta de escritura directamente, de a una: la llamada ES la solicitud de permiso; el sistema no aplica nada todavía y le pide a la persona que apruebe solo esa acción. No describas el cambio en prosa antes de llamarla ni pidas el sí en palabras. Cuando la persona apruebe, continúa con lo que falte, de nuevo un cambio a la vez. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) se confirma explícitamente como irreversible. Nunca digas que aplicaste un cambio si todavía no fue aprobado. Al terminar todo, confirma en una o dos frases lo que quedó hecho y ofrece ayuda con algo más.$nuevo$
)
WHERE key = 'vex_assistant';
