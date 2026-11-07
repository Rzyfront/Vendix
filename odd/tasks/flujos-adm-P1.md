# Flujos adm — P1: conexión total con Vendix

Objetivo: que los flujos gobiernen Vendix: eventos de todos los módulos administrativos, acciones sobre cualquier módulo y candado de aprobación genérico (PLAN.md §2 P1).
Rama: `feat/flujos-adm-p1` desde `origin/develop`. Entrega: un PR a develop, commits por requisito. Runner backend: `npx jest --runInBand --config <scratch isolatedModules + @prisma/client mapeado> <spec>`, un spec por invocación. Frontend: Karma acotado al spec tocado.

## Specs

Historias de la fase (textuales del plan):
- "Como gerente administrativo, quiero que **ninguna compra, gasto, ajuste de inventario, anulación o descuento por encima de mi límite** se haga efectivo sin pasar por su flujo de aprobación, para que nadie se lo salte creando la operación en su pantalla."
- "Como dueño, quiero que **cualquier cosa que pase en Vendix** (venta, factura, pago, nómina, cliente, proveedor, empleado, caja, inventario) pueda arrancar un flujo, para automatizar lo que hoy hago a mano."
- "Como administrador del flujo, quiero que una etapa automática pueda **actuar en cualquier módulo** (crear o actualizar facturas, gastos, movimientos de inventario, pagos, tareas, clientes y proveedores), para cerrar el proceso sin salir del flujo."

Pasos de prueba textuales (H-P1): "Configurar el candado "compras > $2.000.000" → crear una OC de $3.000.000 desde Compras → la OC queda en "Pendiente de aprobación" con el botón Enviar deshabilitado y un enlace a su solicitud → el gerente aprueba → la OC pasa a borrador liberado y se puede enviar. Si se rechaza, la OC queda anulada con el motivo."

- **S1 — P1.1.** "**Registro declarativo de eventos de dominio** (catálogo con nombre, esquema del contexto y tokens), con productores en todos los módulos administrativos: ventas, facturación, pagos, compras, recepciones, gastos, nómina, inventario (ajustes, traslados, stock bajo), contabilidad (asientos, cierres), caja, clientes, proveedores, empleados, reservas y PQR". Criterio: "Añadir un evento nuevo es declararlo y emitirlo; el editor lo lista solo, con sus variables".
  - Historia: Como dueño en el editor de flujos (pestaña Disparadores), quiero elegir cualquier evento de Vendix agrupado por módulo y ver sus variables, para arrancar un flujo con lo que pasa en mi negocio.
  - Pasos: 1) Abrir Flujos → editar un flujo → Disparadores. 2) Abrir la lista de eventos. 3) Elegir "Proveedor creado". 4) Mapear el campo "Nombre" a la variable "Nombre". 5) Publicar. 6) Crear un proveedor en Inventario → Proveedores. 7) Abrir Flujos → Solicitudes.
  - Se ve: 28 eventos agrupados por módulo con nombre en español; cada evento muestra sus variables con etiqueta; una solicitud nueva con el nombre del proveedor ya lleno.
  - Notas: catálogo `WORKFLOW_EVENT_CATALOG` en el contrato (tres copias); `EVENT_BUSINESS_ID_KEYS` en backend; productor = `recordTriggerEvent(tx, …)` dentro de la transacción del dominio (patrón P0.2).
- **S2 — P1.2.** "**Registro declarativo de acciones** (esquema de entrada, permiso requerido, servicio de dominio que ejecuta e idempotencia). Primera ola de ~25 acciones: crear/actualizar cliente, proveedor y empleado; crear gasto; crear OC; aprobar/anular OC; ajuste y traslado de inventario; nota crédito; registrar pago; crear tarea CRM; asignar etiqueta; cambiar estado de pedido; enviar documento". Criterio: "Cada acción pasa por el **mismo servicio** que usa la UI (mismas reglas y permisos) y tiene test; el validador rechaza acciones desconocidas (R1)".
  - Historia: Como administrador del flujo en el editor (pestaña Acciones de una etapa automática), quiero elegir una acción de cualquier módulo y llenar sus datos con variables, para cerrar el proceso sin salir del flujo.
  - Pasos: 1) Editar un flujo → etapa automática → Acciones. 2) Elegir "Crear gasto". 3) Llenar Monto con `{{fields.monto}}` y Descripción. 4) Publicar e iniciar una solicitud que pase por esa etapa. 5) Abrir Gastos.
  - Se ve: 24 acciones con nombre y entradas etiquetadas; el gasto creado por el servicio de Gastos; en la línea de tiempo "Acción ejecutada" con el id; si el publicador no tiene el permiso, "Acción fallida" con el motivo.
  - Notas: `WORKFLOW_ACTION_CATALOG` (contrato) + un manejador por acción en `engine/actions/`; spec de registro que falla si una acción declarada no tiene ejecutor (R1). Idempotencia: el resultado se guarda en el outbox tras el efecto.
- **S3 — P1.3.** "**Candado de aprobación genérico (approval gate)**: interceptor que, ante una operación sensible configurada, la deja en `pending_approval`, inicia el flujo y la libera o anula según el resultado. Se configura desde el flujo ("este flujo gobierna: compras > X"), no módulo por módulo". Criterio: "Lista inicial de operaciones gobernables: OC, gastos, ajustes de inventario, notas crédito/anulaciones, descuentos sobre umbral, pagos a proveedores, liquidación de nómina. Una operación pendiente no se puede ejecutar por ninguna ruta (UI, API, IA)".
  - Historia: Como gerente administrativo en Compras, quiero que una OC por encima de mi límite quede pendiente hasta que yo la apruebe en su solicitud, para que nadie se la salte.
  - Pasos: los H-P1 textuales de arriba, más: intentar aprobar la OC pendiente por API con curl.
  - Se ve: OC "Pendiente de aprobación" con Aprobar deshabilitado y enlace a la solicitud; curl recibe 409 `WORKFLOW_APPROVAL_PENDING`; tras aprobar la solicitud, Aprobar se habilita; al rechazar, la OC queda anulada con el motivo.
  - Notas: tabla `workflow_approval_gates` (migración aditiva); `governs` en la definición; el estado `pending_approval` vive en el candado, no en un enum nuevo de cada entidad (decisión aditiva más simple). Modo `hold` (OC, gasto, nómina: la operación espera; rechazo anula) y `defer` (ajuste, nota crédito, anulación de factura, descuento, pago a proveedor: nada se crea hasta aprobar; al aprobar corre como el solicitante).
- **S4 — P1.4.** "Vínculo bidireccional: la entidad muestra "Solicitud #123 · etapa X" y la solicitud muestra la entidad". Criterio: "Desde la OC se llega a la solicitud y al revés".
  - Historia: Como gerente en el detalle de una OC, quiero ver "Solicitud FLU-000123 · etapa Aprobación gerente" y abrirla, y desde la solicitud volver a la OC, para no buscar a mano.
  - Pasos: 1) Abrir la OC gobernada. 2) Pulsar el enlace de la solicitud. 3) En la solicitud, pulsar el enlace de la OC.
  - Se ve: el enlace en ambos sentidos.
- **S5 — P1.5.** "Mapeo de datos evento → formulario de la solicitud con tokens". Criterio: "La solicitud nace con proveedor, monto y productos ya llenos".
  - Historia: Como gerente en Mis tareas, quiero que la solicitud de la OC llegue con proveedor, monto y productos, para decidir sin abrir otra pantalla.
  - Pasos: H-P1 → abrir la tarea en Mis tareas.
  - Se ve: proveedor, monto y productos llenos.

Riesgo (textual del plan): "Risk: item 1 (estado nuevo en entidades), 2 (permisos de acciones), 4 (interceptor y concurrencia) → verificador independiente." Verificador independiente: el pipeline lanza la revisión aparte.

## Tasks

| ID | S# | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S1–S3 | inline | en curso | Contrato con catálogos, validador `governs`, migración del candado |
| T2 | S2 | delegada (escritor A, paralelo) | pendiente | Acciones de personas y CRM |
| T3 | S2 | delegada (escritor B, paralelo) | pendiente | Acciones de operaciones (gastos, compras, pagos, inventario, facturación, ventas) |
| T4 | S1 | delegada (escritor C, paralelo) | pendiente | Productores de eventos en los dominios |
| T5 | S3–S5 | inline | pendiente | Motor: arranque por candado, resolución, efectos, endpoint de vínculos |
| T6 | S3 | inline (tras T4: mismos archivos) | pendiente | Aplicación del candado en los servicios de dominio |
| T7 | S1–S5 | delegada (escritor D, paralelo) | pendiente | Frontend: editor, panel de candado, vínculo y avisos |
| T8 | S1–S5 | inline | pendiente | Verificación en vivo (puerto 3099, base `vendix_flujos`) |

Motivo de delegación (Writer trigger a): T2, T3, T4 y T7 son unidades independientes con superficies disjuntas, cada una de varios archivos y >100 líneas, lanzadas juntas tras cerrar el contrato.

## Log

- L1 (2026-11-07, encargo): "Implementa TODA la fase P1 de PLAN.md §2 (todas sus filas y sus historias), cerrando cada requisito con código, specs y verificación."
- L2 (2026-11-07, decisión): `pending_approval` vive en `workflow_approval_gates` y no como valor nuevo en el enum de cada entidad: aditivo, uno para las 8 operaciones y sin tocar listas, filtros ni reportes de cada módulo. En la OC (enum sin "enviada"), "Enviar" es "Aprobar" (borrador → aprobada).
- L3 (2026-11-07, decisión): "liquidación de nómina" = aprobar la nómina (`payroll_run.approve`). Los descuentos de POS en caja no se retienen (una venta en mostrador no puede esperar); se gobierna el descuento de una venta editada o creada en el panel.
- L4 (2026-11-07, decisión): con varios flujos que gobiernan la misma operación, manda el de mayor umbral no superior al monto (escalones).
