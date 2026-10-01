-- Migration: el plan de escritura de Vex se forma llamando herramientas, no narrándolo
--
-- DATA IMPACT:
--   Tabla mutada:  ai_engine_applications (solo la columna `system_prompt`)
--   Sentencia:     UPDATE ... WHERE key = 'vex_assistant'
--   Filas:         como máximo 1. Verificar antes del deploy con
--                    SELECT count(*) FROM ai_engine_applications
--                    WHERE key = 'vex_assistant';
--                  Si devuelve 0, la migración es un no-op seguro.
--   Reversible:    SÍ. El bloque anterior está transcrito literal dentro del
--                  primer argumento de replace(); revertir es intercambiar los
--                  dos argumentos. Aun así, snapshot de prod antes del deploy.
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE. Tabla de configuración.
--   Approval: plan docs/plans/vex-agent-remediation-plan.md E2E-1 (hallazgo live).
--
-- Por qué es quirúrgico y no un UPDATE del prompt entero:
--   `replace()` sobre el bloque exacto. Si un operador editó otra sección a
--   mano, este UPDATE la preserva; reescribir la columna completa la borraría.
--   Si el bloque viejo ya no está (porque alguien lo cambió), el replace no
--   encuentra nada y la fila queda igual: no rompe, no pisa.
--   Precedente: 20260803150000_vexi_write_protocol_prompt (mismo bug en Vexi).
--
-- Qué corrige:
--   El prompt v1 mandaba "formula tu plan completo" y "presentas el plan" ANTES
--   de escribir. El modelo lo leía como "escribe el plan en prosa y espera el
--   sí", así que narraba los cambios en texto y nunca llamaba las herramientas
--   de escritura. Pero el loop de Vex está diseñado al revés: la llamada ES la
--   propuesta — cada escritura queda registrada como paso del plan del turno y
--   al final el sistema emite UN frame `plan_approval` para una sola
--   aprobación. Con el prompt viejo `vexProposals` quedaba vacío, el frame no
--   existía, `metadata.plan` quedaba nulo y la tarjeta de plan nunca aparecía:
--   todo el flujo de aprobación era inalcanzable en vivo.
--   Verificado en dev el 2026-10-01: turno con 2 creates + 1 delete terminó en
--   narración (`propose_plan` + texto), `metadata` nulo, 0 pasos registrados.

UPDATE ai_engine_applications
SET system_prompt = replace(
  system_prompt,
  $viejo$Antes de escribir cualquier cosa (crear, actualizar, enviar, anular, borrar), formula tu plan completo: qué vas a hacer, en qué orden y qué va a cambiar en cada paso. Presentas el plan entero de una vez para una sola aprobación; lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) siempre pide su propia confirmación aunque el plan esté aprobado.$viejo$,
  $nuevo$Para escribir (crear, actualizar, enviar, anular, borrar), llama las herramientas de escritura directamente, una por cada cambio, sin pedir aprobación en palabras antes de llamarlas. La llamada ES la propuesta: el sistema no aplica nada todavía, registra cada llamada como un paso del plan del turno y al final presenta el plan entero de una vez para una sola aprobación. No describas los cambios en prosa antes de llamarlas: si lo haces, el plan nunca se forma y la persona no tiene nada que aprobar. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) siempre pide su propia confirmación aunque el plan esté aprobado. Nunca digas que aplicaste un cambio si solo quedó registrado como paso: registrado todavía NO es aplicado.$nuevo$
)
WHERE key = 'vex_assistant';
