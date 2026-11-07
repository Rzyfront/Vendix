# Flujos adm — P2: motor avanzado

Objetivo: paralelo con unión, subflujos, esperas, bucles, guardas, cuatro puntos de disparo, política de error, migración de instancias, expresiones, disparador programado e interruptor (PLAN.md §2 P2).
Rama: `feat/flujos-adm-p2` desde `origin/develop`. Entrega: un PR a develop con commits por requisito. Runner backend: `npx jest --runInBand --config <scratch isolatedModules> <spec>`, un spec por invocación. Frontend: Karma acotado al spec tocado.

## Specs

Historias de la fase (textuales del plan):
- "Como jefa de talento humano, quiero que al contratar a alguien **TI, nómina y dotación trabajen en paralelo** y que el ingreso se cierre cuando los tres terminen, para no hacerlo en cadena."
- "Como contador, quiero que un flujo **espere** ("3 días después de la factura", "hasta el día 5 del mes") y luego siga solo, para no tener que acordarme."
- "Como administrador, quiero **reutilizar un subflujo** (alta de proveedor) dentro de otros flujos, para no repetirlo."
- "Como dueño, quiero que si una acción automática falla, el flujo **reintente y, si no puede, me avise y siga por una ruta de error**, para que nada quede trabado en silencio."

- **S1 — P2.1.** "**Paralelo con unión** (fork/join): todas, cualquiera o N de M ramas". Criterio: "Las tres ramas aparecen en "Mis tareas" a la vez; la unión espera según la regla elegida".
  - Historia: Como jefa de talento humano en Mis tareas, quiero que al llegar el ingreso a "Alistamiento" TI, Nómina y Dotación reciban su tarea a la vez, para que el ingreso se cierre cuando los tres terminen.
  - Pasos: 1) Editor → etapa tipo "Paralelo" con ramas TI, Nómina y Dotación y unión "Todas". 2) Publicar e iniciar una solicitud. 3) Abrir Mis tareas con cada responsable. 4) Completar dos ramas. 5) Completar la tercera.
  - Se ve: tres tareas abiertas a la vez con el nombre de su rama; con dos hechas la solicitud sigue en "Alistamiento" ("2 de 3 ramas"); con la tercera pasa a la etapa siguiente. Con "Cualquiera" avanza con la primera y cancela las otras; con "N de M" al llegar a N.
  - Notas: etapa `parallel` con `branches` (tarea humana por rama, `workflow_tasks.branch_key`) y `join` (`all|any|n_of_m`). Unión bajo bloqueo de la fila de la instancia (patrón del quórum). Ramas de varios pasos: un subflujo por rama (S2).
- **S2 — P2.2.** "**Subflujos**: lanzar uno o varios hijos y esperar o no su cierre; pasar y devolver variables". Criterio: "El padre muestra a sus hijos en la línea de tiempo".
  - Historia: Como administrador en el detalle de una solicitud, quiero que la etapa "Alta de proveedor" lance el flujo reutilizable de alta, espere su cierre y traiga el NIT, para no repetir ese proceso en cada flujo.
  - Pasos: 1) Publicar el flujo "alta-proveedor". 2) En otro flujo, etapa tipo "Subflujo" que lo lance con `nombre ← {{fields.proveedor}}`, espere y devuelva `nit`. 3) Iniciar la solicitud padre. 4) Completar la hija.
  - Se ve: en la línea de tiempo del padre "Subflujo iniciado: FLU-… Alta de proveedor" con enlace; la hija muestra "Hija de FLU-…"; al cerrar la hija el padre avanza con el NIT lleno. Si la hija se rechaza, el padre sale por "rechazado".
  - Notas: etapa `subflow` (`flows[]`, `wait`, `output`); columnas `parent_instance_id`, `parent_stage_key`, `parent_entry_seq`; arranque y cierre por outbox; profundidad máxima 5.
- **S3 — P2.3.** "**Esperas y temporizadores**: duración, fecha fija, fecha de una variable, día hábil (calendario Colombia)". Criterio: "La espera aparece con su cuenta regresiva y avanza sola".
  - Historia: Como contador en el detalle de la solicitud, quiero ver "Espera: faltan 2 d 23 h" y que siga sola al vencer, para no tener que acordarme.
  - Pasos: 1) Etapa "Espera" de 3 días después de la fecha de factura (o "hasta el día 5 del mes", o N días hábiles). 2) Iniciar. 3) Ver el detalle. 4) Al vencer (en vivo: espera de 1 minuto).
  - Se ve: la cuenta regresiva y la fecha de reanudación; al vencer la solicitud pasa sola a la etapa siguiente.
  - Notas: etapa `wait` (`duration`, `date`, `field`, `business_days`, `day_of_month`), en la zona horaria de la tienda; festivos de Colombia (Ley 51 de 1983 y Pascua) calculados; reutiliza `stage_due_at` y el cron de temporizadores.
- **S4 — P2.4.** "**Bucles** con condición y límite duro (sin bucles infinitos)". Criterio: "El validador exige el límite".
  - Historia: Como administrador en el editor, quiero repetir un tramo mientras se cumpla una condición con un máximo de vueltas, para reintentar sin riesgo de un bucle infinito.
  - Pasos: 1) Etapa tipo "Bucle" sin límite → Validar. 2) Poner límite 3 → Validar → publicar e iniciar.
  - Se ve: sin límite, el error "El bucle necesita un límite de vueltas (1 a 100)"; con límite, la línea de tiempo muestra "Vuelta 1 de 3"… y sale por "terminado" al cumplirse la condición o el límite.
  - Notas: etapa `loop` (`while`, `max_iterations`), contador en `workflow_instances.runtime`. Los ciclos sin tarea humana solo se permiten si pasan por un bucle.
- **S5 — P2.5.** "**Guardas** antes de avanzar: bloquean con mensaje o redirigen a otra etapa". Criterio: "Se ve el motivo del bloqueo".
  - Historia: Como aprobador en Mis tareas, quiero que al aprobar algo que excede el presupuesto se me impida avanzar con el motivo, para no saltarme una regla.
  - Pasos: 1) Guarda "monto > 5.000.000 → bloquear: Excede el presupuesto". 2) Aprobar una tarea con monto 6.000.000.
  - Se ve: el mensaje "Excede el presupuesto" y la tarea sigue abierta; con `redirect_to`, la solicitud va a la etapa indicada y la línea de tiempo dice "Redirigida por guarda".
- **S6 — P2.6.** "**Puntos de disparo** al entrar, completar, enviar y salir, todos ejecutados (R2)". Criterio: "Test por cada punto".
  - Historia: Como administrador en el editor (Acciones), quiero acciones al entrar, al enviar, al completar y al salir de una etapa, para automatizar cada momento.
  - Notas: `on_submit` (envío del formulario: resultados `submit`/`approve`), `on_complete` (la etapa se resuelve con cualquier resultado), `on_exit`, `on_enter`; orden enviar → completar → salir → entrar. Un test por punto.
- **S7 — P2.7.** "**Política de error por acción**: reintento con backoff, continuar, o ir a la ruta de error. Dead-letter con alerta al dueño del flujo (R4)". Criterio: "Una acción caída genera alerta y se puede reintentar a mano".
  - Historia: Como dueño en el detalle de una solicitud, quiero que una acción automática que falla se reintente, me avise y deje el botón "Reintentar", para que nada quede trabado en silencio.
  - Pasos: 1) Acción "Crear gasto" con política "reintentar 2 veces y luego ir a la ruta de error". 2) Forzar el fallo (publicador sin permiso). 3) Ver campana y detalle. 4) Dar permiso y pulsar Reintentar.
  - Se ve: notificación "Acción fallida" al dueño; la solicitud en la etapa de error; en el detalle "Acción fallida · Reintentar"; tras reintentar, "Acción ejecutada".
- **S8 — P2.8.** "**Migración de instancias entre versiones** con mapa etapa→etapa y vista previa". Criterio: "Las solicitudes vivas pasan a v2 sin perder historia".
  - Historia: Como administrador en el editor (Historial), quiero pasar las solicitudes vivas de v1 a v2 eligiendo a qué etapa va cada una y viendo antes cuántas se mueven, para no dejarlas en la versión vieja.
  - Pasos: 1) Publicar v2 con una etapa renombrada. 2) Historial → Migrar solicitudes. 3) Mapear la etapa vieja a la nueva → Vista previa. 4) Migrar.
  - Se ve: la vista previa por etapa (cuántas, destino, faltantes); tras migrar, la solicitud dice v2 y su línea de tiempo conserva todo más "Migrada de v1 a v2".
- **S9 — P2.9.** "**Expresiones y variables calculadas** (aritmética, fechas, texto) con catálogo cerrado y seguro, sin código arbitrario". Criterio: "Campo "Total con IVA" calculado en vivo".
  - Historia: Como solicitante en el formulario, quiero ver "Total con IVA" calculado mientras escribo el subtotal, para no hacer la cuenta.
  - Pasos: 1) Campo `total_iva` con fórmula `round(subtotal * 1.19, 2)`. 2) Abrir el formulario e ir escribiendo el subtotal.
  - Se ve: el total cambia al escribir y no se puede editar; el servidor guarda el mismo valor.
  - Notas: analizador propio (sin `eval`), funciones de catálogo cerrado, en el contrato compartido.
- **S10 — P2.10.** "**Disparador programado** (cron con expresión libre y zona horaria de la tienda)". Criterio: ""Cada lunes 8 a. m.: revisión de caja"".
  - Historia: Como dueño en el editor (Disparadores), quiero programar "cada lunes 8 a. m." para que la revisión de caja se cree sola.
  - Pasos: 1) Disparador programado `0 8 * * 1`. 2) Publicar. 3) (En vivo: `* * * * *`) esperar un minuto.
  - Se ve: la descripción "Cada lunes a las 08:00 (hora de la tienda)"; a la hora, una solicitud nueva iniciada por "Programación", una sola vez.
- **S11 — P2.11.** "Interruptor para apagar un flujo sin borrarlo". Criterio: "Al apagarlo no se inician solicitudes nuevas y las vivas siguen".
  - Historia: Como dueño en la lista de flujos, quiero apagar un flujo con un interruptor, para que no arranquen solicitudes nuevas mientras las vivas terminan.
  - Pasos: 1) Apagar el flujo. 2) Intentar iniciar una solicitud. 3) Completar una tarea de una solicitud viva.
  - Se ve: "Apagado" en la lista; iniciar responde "El flujo está apagado"; la solicitud viva avanza normal.
  - Notas: `workflow_definitions.is_enabled`. Apagado también frena eventos, formulario público, programación, subflujos y candados (un flujo apagado no gobierna).

Riesgo (textual del plan): "Risk: item 4 (concurrencia en la unión y los temporizadores) → verificador independiente." El pipeline lanza la revisión aparte.

## Tasks

| ID | S# | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S1–S11 | inline | ✅ | `be7bf0a39`; expresiones/cron/festivos 15/15, validador P2 15/15, validador 92/92, paridad 10/10 |
| T2 | S1–S11 | inline | ✅ | `3b43e3205` (migración), `b8200dce4`; motor avanzado 30/30, despachador 18/18, Postgres real 17/17 (unión concurrente) |
| T3 | S7, S8, S11 | inline | ✅ | `8a4a99459`; specs de definiciones, instancias, bandeja, simulador, formulario público en verde |
| T4 | S1–S11 | delegada (escritor frontend, superficie disjunta, paralelo al backend) | ✅ | `f747b8163`; `ngc` limpio, Karma 40/40, auditoría zoneless 0 errores |
| T5 | todos | inline | ✅ | en vivo :3099 sobre `vendix_flujos` (ver Log L4) |

## Log

- L1 (2026-11-07) Pedido: "Implementa TODA la fase P2 de PLAN.md §2 (todas sus filas y sus historias), cerrando cada requisito con código, specs y verificación."
- L2 Decisiones aditivas: ramas paralelas = una tarea humana por rama (los tramos largos usan un subflujo por rama); una acción que muere con política "ruta de error" mueve la solicitud desde donde esté; las transiciones forzadas siguen sin `on_exit` (comportamiento previo); un flujo apagado no gobierna operaciones.
- L3 Hallazgos durante la fase: el look-back del cron disparaba minutos anteriores a la publicación (corregido: nunca antes de `published_at`/cambio del interruptor); el mensaje de alerta perdía el punto tras el error (corregido).
- L4 En vivo (:3099, `vendix_flujos`): paralelo 3 tareas a la vez, "2 de 3" sin avanzar y unión con la tercera; subflujo hijo con nombre mapeado, cierre del hijo devuelve el NIT y el padre entra a la espera de 1 min; bucle con vueltas; acción caída → `action_failed` + `error_routed` + alerta al dueño, reintento manual 201 y segundo reintento 409; guarda 409 "Excede el presupuesto" con la tarea abierta; migración v1→v2 (6 solicitudes, historia + `migrated`); programado `* * * * *` una solicitud por minuto sin duplicados; apagado → 409 `WORKFLOW_DISABLED` y la viva completa.
