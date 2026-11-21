# Reporte Vex Plus · F5 (escritura en lote y tareas prediseñadas)

Rama `feat/vex-plus-f5` (desde origin/develop `80ef5eaec`). Plan: `odd/tasks/vex-agente-avanzado.md` (§3.1, F5 T34–T40). No se commitea.

## Historia de usuario
Como dueño o administrador en `/admin/vex`, quiero pedirle a Vex varios cambios a la vez y aprobarlos con un solo clic, para operar sin aprobar cambio por cambio y saber exactamente qué se aplicó.

Pasos en pantalla:
1. Escribo «Sube 5 % el precio de las bebidas, etiqueta como VIP a los 12 mejores clientes y …».
2. Veo una tarjeta «Plan de cambios» con cada cambio (antes → después), agrupados, con casilla por paso.
3. Desmarco uno y pulso «Aprobar seleccionados»: veo el avance paso a paso.
4. Al final leo «Se aplicaron los N cambios» o «Se aplicó hasta el paso 2, el resto se omitió», y «Deshacer» en los pasos reversibles; el resto dice «No reversible desde Vex».
5. Recargo la página: la tarjeta conserva el estado. Doble clic en «Aprobar» no duplica nada.
6. Un administrador sin permiso para un paso: Vex dice «tu rol no permite …» y no muestra tarjeta.

## Decisiones asumidas (orquestador)
- Circuito propio del lote (`ai_agent_write_batches` + `/store/vex/batches`), ejecutado de forma determinista en el servidor; el plan oculto de una escritura por aprobación (`approvePlan` con `slice(0,1)`) no cambia.
- Servicios en `domains/store/vex/services/` (no en `ai-engine/tasks/`, para no abrir un ciclo de DI con `VexModule`); specs con esas rutas.
- El gate por paso reutiliza `AIToolRegistry.previewForConsent` (T13).
- Sin cupo de acciones (N4): el lote no consume cuota por paso.
- La transcripción local de specs usa ts-jest sin diagnósticos de tipos (el cliente Prisma compartido no se regenera en este worktree); CI tipa.

## Estado por tarea
(se completa al integrar)

## Bloqueos y riesgos
(se completa al integrar)
