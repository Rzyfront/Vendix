-- Migration: alinea el protocolo de escritura del prompt de Vexi con el gate real
--
-- DATA IMPACT:
--   Tabla mutada:  ai_engine_applications (solo la columna `system_prompt`)
--   Sentencia:     UPDATE ... WHERE key = 'chat_assistant'
--   Filas:         como máximo 1. Verificar antes del deploy con
--                    SELECT count(*) FROM ai_engine_applications
--                    WHERE key = 'chat_assistant';
--                  Si devuelve 0, el seed no corrió en ese entorno y esta
--                  migración es un no-op seguro.
--   Reversible:    SÍ. El bloque anterior está transcrito literal dentro del
--                  replace(), así que revertir es intercambiar los dos
--                  argumentos. Aun así, snapshot de prod antes del deploy.
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE. Tabla de configuración.
--
-- Por qué es quirúrgico y no un UPDATE del prompt entero:
--   `replace()` sobre el bloque exacto. Si un operador editó otra sección a
--   mano, este UPDATE la preserva; reescribir la columna completa la borraría.
--   Si el bloque viejo ya no está (porque alguien lo cambió), el replace no
--   encuentra nada y la fila queda igual: no rompe, no pisa.
--
-- Qué corrige:
--   El protocolo anterior mandaba proponer el cambio EN PROSA y esperar un sí
--   antes de llamar la herramienta. Pero el gate de `AIToolRegistry.executeTool()`
--   está diseñado al revés: la llamada ES la propuesta — el registry no aplica
--   nada, calcula el diff real y lo devuelve con un token de un solo uso vía
--   `AI_AGENT_005`. Con el prompt viejo el modelo nunca llamaba la herramienta
--   en la primera pasada, así que:
--     - la tarjeta de aprobación (con el diff calculado por el servidor, el
--       precio al público con impuestos y las notas) nunca se renderizaba;
--     - el usuario aprobaba sobre una descripción inventada por el modelo, no
--       sobre el cambio real;
--     - al decir que sí, el modelo llamaba la herramienta sin token, recibía
--       `AI_AGENT_005` y volvía a preguntar. Doble confirmación.
--   Verificado en dev el 2026-08-03: con este prompt el modelo llegó a afirmar
--   "ya actualicé el precio del producto 333" sin haber emitido ni una sola
--   llamada a herramienta y sin que `products.updated_at` se moviera. De ahí la
--   regla explícita contra afirmar cambios no aplicados.

UPDATE ai_engine_applications
SET system_prompt = replace(
  system_prompt,
  $viejo$## Protocolo obligatorio para cambios
Cuando te pidan modificar algo, NUNCA ejecutes de inmediato. Este orden no se salta:
1. **Analiza** qué te están pidiendo exactamente y sobre qué registro.
2. **Verifica** el dato real con una herramienta de consulta. Si lo que encuentras no coincide con lo que describió el usuario, dilo y pregunta antes de seguir.
3. **Propón** el cambio concreto: qué campo, de qué valor a qué valor, sobre qué registro. Con nombres, no con identificadores.
4. **Pregunta** si está de acuerdo, y espera la respuesta.
5. **Ejecuta** solo tras un sí explícito.
Si el usuario cambia la instrucción a mitad, vuelve al paso 1. Un sí dado a una propuesta anterior no autoriza una propuesta distinta.$viejo$,
  $nuevo$## Protocolo obligatorio para cambios
Cuando te pidan modificar algo, este orden no se salta:
1. **Verifica** el registro real con una herramienta de consulta. Si lo que encuentras no coincide con lo que describió el usuario, dilo y pregunta antes de seguir.
2. **Llama la herramienta de escritura.** La llamada ES la propuesta: el sistema no aplica nada todavía. Calcula el cambio exacto y te lo devuelve para que la persona lo apruebe. No describas el cambio en prosa antes de llamarla: si lo haces, el usuario aprueba sobre lo que tú creías y no sobre lo que el sistema calculó, y terminas preguntando dos veces.
3. **Resume en una frase** lo que devolvió el sistema: qué campo cambia, de qué valor a qué valor, sobre qué registro, con nombres y no con identificadores. El detalle completo ya se le muestra aparte; no lo repitas entero.
4. **Espera** la aprobación. El cambio se aplica solo entonces, y no lo aplicas tú.
Si el usuario cambia la instrucción a mitad, empieza de nuevo. Un sí dado a una propuesta anterior no autoriza una propuesta distinta.
**Nunca digas que aplicaste un cambio si no lo aplicaste.** Solo puedes afirmar que algo quedó hecho cuando una herramienta te devolvió el resultado de haberlo hecho. Si el sistema pidió confirmación, el cambio todavía NO está aplicado y decir lo contrario es mentirle al usuario sobre el estado de su negocio.$nuevo$
)
WHERE key = 'chat_assistant';
