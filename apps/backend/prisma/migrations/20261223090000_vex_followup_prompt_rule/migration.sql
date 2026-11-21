-- Migration (M12): regla de seguimientos en el prompt de Vex (F1/T5)
--
-- PENDIENTE DE APROBACIÓN: muta una fila de configuración. No desplegar a
-- producción sin la aprobación explícita de Rafael y snapshot previo.
--
-- DATA IMPACT:
--   Tables affected: ai_engine_applications (solo la columna `system_prompt`)
--   Statement:       UPDATE ... WHERE key = 'vex_assistant'
--                    AND system_prompt NOT LIKE '%suggest_followup%'
--   Expected row changes: como máximo 1. Verificar antes del deploy con
--                      SELECT count(*) FROM ai_engine_applications
--                      WHERE key = 'vex_assistant'
--                        AND system_prompt NOT LIKE '%suggest_followup%';
--                    Si devuelve 0, la migración es un no-op seguro.
--   Destructive operations: none. Solo AGREGA un párrafo al final; no
--                    reemplaza ni recorta texto existente, así que una edición
--                    manual del prompt hecha por un operador se preserva.
--   FK/cascade risk: none (tabla de configuración, sin DELETE/DROP/TRUNCATE).
--   Idempotency:     el guard NOT LIKE '%suggest_followup%' hace que una
--                    segunda ejecución no cambie nada.
--   Reversible:      SÍ: quitar el párrafo agregado con replace() sobre el
--                    bloque literal de abajo.
--   Approval:        plan `odd/tasks/vex-agente-avanzado.md` (§3.13, T5, M12)
--                    aprobado por Rafael el 2026-11-20; el deploy a producción
--                    de esta mutación queda pendiente de su aprobación.
--
-- Por qué: la herramienta `suggest_followup` ya describe cuándo usarse, pero
-- la detección debe evaluarse en CADA turno; la regla en el prompt es lo que
-- lo vuelve hábito del modelo sin una llamada extra.

UPDATE ai_engine_applications
SET system_prompt = system_prompt || E'\n\n' || $regla$Seguimientos: en cada turno evalúa si la conversación deja algo por hacer después: un compromiso con fecha, un pendiente con un cliente o proveedor, un acuerdo, o un cambio que acabas de aplicar y conviene revisar más adelante. Si lo hay, además de responder con normalidad llama suggest_followup una sola vez (reminder si hay fecha, en hora local de la tienda; log_entry si es una nota sin fecha), citando en source_phrase la frase que lo motivó. La persona decide en la ficha que aparece bajo tu respuesta: no la anuncies, no la repitas en el texto y no digas que guardaste nada. No la llames en charla trivial ni en preguntas sin compromiso. Si la persona lo pide de forma explícita («recuérdame…», «anota…»), crea el recordatorio directamente con create_reminder y no sugieras. Si la herramienta responde suggested=false, no insistas ni lo menciones.$regla$
WHERE key = 'vex_assistant'
  AND system_prompt NOT LIKE '%suggest_followup%';
