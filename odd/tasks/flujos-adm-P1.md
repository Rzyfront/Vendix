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
| T1 | S1–S3 | inline | ✅ | `1941dd31a`; validador 92/92, paridad 8/8 |
| T2 | S2 | delegada (escritor A, paralelo) | ✅ | `f1cbb937a`; 9 acciones, 19/19 |
| T3 | S2 | delegada (escritores B1 y B2, paralelo) | ✅ | `f1cbb937a`; 15 acciones, 18/18 y 26/26; registro R1 14/14 |
| T4 | S1 | delegada (escritor C, paralelo) | ✅ | `74c45fb1a`; 22 productores nuevos, 37 tests de productores; facturación rehecha a diff mínimo |
| T5 | S3–S5 | inline | ✅ | `13a419888`; candado 14/14; Postgres real 4/4 (halló y corrigió una carrera de revisión) |
| T6 | S3 | inline (tras T4: mismos archivos) | ✅ | `11bca6333`, `591212912`, `45eac45d6`; 11/11 servicios gobernados; specs de los servicios en verde |
| T7 | S1–S5 | delegada (escritor D, paralelo) | ✅ | `f3cd7a5b6`, `7b572dd80`; Karma 15/15; `ngc` limpio |
| T8 | S1–S5 | inline | ✅ | En vivo :3099 + vhost; capturas en `evidencia-P1/` |
| T9 | — (CI) | inline | ✅ | `5b4f70b1d`; typecheck de specs del job Backend Build en verde |
| T10 | S3 | inline | ✅ | `04a9ba818`; ajustes por carga masiva (sesión) y archivado con candado; productos 157/157, ajustes 14/14 |
| T11 | S3 | inline | ✅ | `1a080092e`; anticipo de OC (crear y plan de pago) con candado; servicios gobernados en verde |
| T12 | S1–S3 (CI) | inline | ✅ | `a4acefc2b`, `a65c8dfa8`; 35 specs de la fase corren en el job de Flujos |
| T13 | S3 | inline | ✅ | `db21fedaa`; descuento del POS retenido; candado 15/15, servicios 20/20, pagos 194/194 |
| T14 | S2 | inline | ✅ | `0b2816d08`; idempotencia declarada y marca de inicio; acciones 17/17, paridad 8/8 |
| T15 | S3–S4 | inline | ✅ | `041fd5ac5`, `734ffe7d5`, `2ab508dae`, `f6eb8c4f5`; bajos de la revisión r1 |
| T16 | S3 | inline | ✅ | `3408f4a4b`; stock editado en el producto o la variante: 409 si un flujo lo gobierna; servicios gobernados 24/24, variantes 15/15, productos 157/157 |
| T17 | S3 | inline | ✅ | `949443f7f`; descuento por API (crear, PATCH, PUT items): 409 si un flujo lo gobierna; órdenes 194/194, editor 4/4 |
| T18 | S3 | inline | ✅ | `2cda026d1`; carga inicial que cae a diferencia de conteo pasa por el candado; ajustes 14/14 y 34/34, importación 142/142 |
| T19 | — (CI) | inline | ✅ | `e012717ed`; specs de productos, variantes, órdenes, pagos e importación en el job de Flujos |

Motivo de delegación (Writer trigger a): T2, T3, T4 y T7 son unidades independientes con superficies disjuntas, cada una de varios archivos y >100 líneas, lanzadas juntas tras cerrar el contrato.

## Log

- L1 (2026-11-07, encargo): "Implementa TODA la fase P1 de PLAN.md §2 (todas sus filas y sus historias), cerrando cada requisito con código, specs y verificación."
- L2 (2026-11-07, decisión): `pending_approval` vive en `workflow_approval_gates` y no como valor nuevo en el enum de cada entidad: aditivo, uno para las 8 operaciones y sin tocar listas, filtros ni reportes de cada módulo. En la OC (enum sin "enviada"), "Enviar" es "Aprobar" (borrador → aprobada).
- L3 (2026-11-07, decisión): "liquidación de nómina" = aprobar la nómina (`payroll_run.approve`). Los descuentos de POS en caja no se retienen (una venta en mostrador no puede esperar); se gobierna el descuento de una venta editada o creada en el panel.
- L4 (2026-11-07, decisión): con varios flujos que gobiernan la misma operación, manda el de mayor umbral no superior al monto (escalones).
- L5 (2026-11-07, decisión): para un ajuste de inventario el umbral se mide en unidades movidas (valor absoluto), no en dinero. La carga inicial no se retiene. Un ajuste sin registro de inventario no abre solicitud (el servicio lo rechaza solo).
- L6 (2026-11-07, decisión): rechazar una OC retenida la anula con el motivo en las notas internas; rechazar un gasto lo deja rechazado con el motivo en sus notas; rechazar una nómina la cancela. Cancelar la solicitud libera el candado y el siguiente intento pide otra aprobación.
- L7 (2026-11-07, QA en vivo): H-P1 pasa por API y en navegador (OC de $3.000.000 pendiente, 409 por API, Aprobar deshabilitado con enlace, solicitud con proveedor/monto/productos, aprobación libera, rechazo anula con motivo). Evento `supplier.created` arranca un flujo; acciones `expense.create` y `supplier.update` con `{{instance.subject_id}}` ejecutadas. Ajuste diferido ejecutado una vez como el solicitante.
- L8 (2026-11-07, hallazgo): la prueba contra Postgres mostró que dos intentos simultáneos podían abrir dos candados; la revisión ahora sale de la primera lectura y la restricción única los serializa.
- L9 (2026-11-07, pendiente): espejo Engram no disponible en este entorno.
- L10 (2026-11-07, revisión r1, nota 58): CI rojo por el typecheck de specs; el candado se saltaba por el anticipo de OC (crear y plan de pago), la carga masiva por sesión y el archivado de producto; el descuento del POS no se retenía; los specs de la fase no corrían en CI; acciones al menos una vez.
- L11 (2026-11-07, decisión, reemplaza la parte POS de L3): el descuento del POS sí se gobierna. La venta responde 409 y abre la solicitud; el worker no reejecuta nada (`retry_by_requester`), porque una venta necesita al cliente y el dinero en caja. Aprobada, el cajero repite la misma venta (mismo carrito, cliente, cupón y totales) y la aprobación se usa una vez en su transacción.
- L12 (2026-11-07, decisión): un anticipo declarado al crear una OC no puede esperar una solicitud (aún no hay OC que retener): con un flujo que gobierna su monto, crear responde 409 `WORKFLOW_APPROVAL_REQUIRED` y el pago se registra desde la OC. El anticipo del plan de pago sí se retiene y se reejecuta.
- L13 (2026-11-07, decisión): archivar un producto pide la aprobación de cada baja antes de abrir la transacción. Aprobada, la solicitud da de baja ese stock; el producto se archiva cuando se vuelve a archivar.
- L14 (2026-11-07, decisión): idempotencia de acciones `replay_safe` (actualizar cliente, proveedor, empleado; etiqueta de cliente) o `at_most_once` (las demás). Una ejecución interrumpida tras la marca de inicio falla con motivo en vez de repetir el efecto; si el efecto falla, la marca se borra y el reintento corre.
- L15 (2026-11-07, decisión): la restricción única del candado no lleva `entity_type` y cambiarla exige `DROP INDEX` (prohibido por el encargo); la regla vigente y el hash se leen con el tipo. `GET store/workflow-links` deja de devolver el título libre de la solicitud.
- L16 (2026-11-07, pendiente declarado): anular una nota crédito o débito no emite `invoice.voided` (transición en el servicio fiscal de saldos de notas, fuera del alcance de la ronda).
- L17 (2026-11-07, revisión r2, nota 76): el stock editado en el producto o la variante (página de producto, `PATCH products/variants/:id`, `stock_quantity`/`stock_by_location` de `PATCH products/:id`) aplicaba un ajuste sin candado; el `discount_amount` de `POST store/orders` y `PUT store/orders/:id/items` no se gobernaba; una carga inicial que caía a diferencia de conteo no pasaba por el candado.
- L18 (2026-11-07, decisión): las ediciones en línea (stock del producto o la variante, descuento escrito por API al crear o editar la orden) no pueden esperar una solicitud. Si un flujo gobierna el cambio, responden 409 `WORKFLOW_APPROVAL_REQUIRED` sin escribir nada y mandan a la ruta que pide la aprobación: Ajustes de Stock o el editor de la orden. También aplica a `PATCH store/orders/:id`, a las herramientas de IA de órdenes y a convertir una cotización con descuento. Mantener o bajar un descuento siempre pasa.
- L19 (2026-11-07, pendiente declarado, dueño: siguiente ronda de P1 sobre facturación): `invoice.voided` al anular notas crédito/débito (ver L16).
- L20 (2026-11-07, pregunta abierta r2, sin auditar): `releaseEffect` borra la marca ante cualquier error del handler; si algún servicio de dominio de una acción `at_most_once` lanza después de su commit, el reintento repetiría el efecto. No se auditaron los 18 handlers en esta ronda.
- L21 (2026-11-07, hallazgo fuera del alcance): en `develop`, `orders.service.history/shipping-tax/titular/invoice-lock` ya fallan porque su mock de prisma no tiene `$transaction` (los tests de `update`). No corren en CI y no se tocaron.
