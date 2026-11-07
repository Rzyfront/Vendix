# Flujos y Documentos · Industria Administración — Plan complementario (post PR #1099)

Objetivo: llevar Flujos y Documentos a una plataforma de producción que gobierne cualquier proceso de la industria `administration`: módulos de Vendix, sistemas externos y procesos nuevos que Vendix no modela.
Base: `develop` con el PR #1099 desplegado. Entrega por fases, cada una con su PR a develop, sus tests (solo lo tocado, `--runInBand`) y verificación en vivo con historias de usuario.
Estado: decisiones D1, D2 y D4 tomadas (2026-11-07); D3 pendiente. El desarrollo no arranca hasta que Rafael diga "arranca".

---

## 0. De dónde partimos

**Ya en producción con el #1099 (bloques 1–8, 11–13 y parte del 14):**
- Industria `administration` y compuerta por industria (backend 403, candado en el menú).
- Contrato `vendix.workflow/v1`: etapas, transiciones con condiciones, requisitos, formularios y acciones.
- Motor con concurrencia (CAS), idempotencia, outbox, vencimientos con recordatorio y escalamiento (estos dos probados solo en specs).
- API completa de definiciones, instancias y tareas. Versiones inmutables, import/export.
- Base documental: archivos seguros en S3, expediente, `legal_hold` y retención al borrar.
- UI: lista, editor de etapas, detalle con línea de tiempo, bandeja y operación diaria.
- IA: generar, explicar y validar flujos (herramientas con confirmación).
- Analítica de KPIs y cuellos de botella.
- Integraciones: API keys por tienda, webhooks salientes firmados, 6 eventos de negocio como disparadores y 2 acciones Vendix (OC borrador, tarea CRM).

**Lo que falta (diagnóstico):**
1. Los flujos **acompañan** a Vendix, pero no lo **gobiernan**: no frenan operaciones, escuchan 6 eventos y ejecutan 2 acciones.
2. El motor es **secuencial**: no tiene paralelo con unión, subflujos, esperas, bucles, rutas de error ni migración de instancias entre versiones.
3. **Lo externo** es solo de salida: no hay webhook de entrada por flujo, llamada HTTP genérica ni conectores.
4. **Lo inédito** no tiene dónde vivir: un proceso sobre algo que Vendix no modela (contratos, activos, trámites) no tiene registro propio.
5. **Lo documental** está bloqueado en plantillas PDF, firma, OCR y purga.
6. Faltan el **constructor visual** (canvas editable), la galería de plantillas y la operación de producción (límites por plan, auditoría inmutable, observabilidad, carga).

## 1. Referencias y reglas de diseño

Se contrastó con tres referencias: las A y B del plan original y una **referencia C** (motor general de pasos con nodos). Solo se toman ideas. No se copia código ni estructura de ninguna.

**Lo que vale de C y se adopta:**
- Tipos de paso explícitos: tarea humana, automático, decisión, paralelo, bucle, subflujo, salto, espera y fin.
- Guardas antes de avanzar, que bloquean o redirigen.
- Disparadores por punto del paso: al entrar, al completar, al enviar y al salir.
- Nodo HTTP con destino de la respuesta en variables.
- Variables del sistema y selector de variables en el editor.
- Formularios públicos con QR, expiración y desactivación; subida por partes para archivos grandes.
- Kanban multi-flujo filtrado por rol y sede.
- Depurador y "probar esta acción" en el editor.
- Actualización en vivo de las instancias.
- Interruptor para apagar un flujo.

**Errores de C que no repetimos (reglas):**
- R1. **Ninguna acción devuelve éxito sin ejecutar.** Un tipo declarado en el contrato tiene ejecutor real y test; si no, el validador lo rechaza.
- R2. **Ningún punto de disparo declarado queda sin correr** (C declara `on_exit` y nunca lo ejecuta).
- R3. **Versionado real:** versiones inmutables (ya lo tenemos) y migración explícita de instancias vivas.
- R4. **Reintentos con backoff exponencial, cola de fallidos (dead-letter) y alerta**, no un conteo fijo.
- R5. **Webhooks de entrada firmados por flujo**, sin depender de la sesión de un usuario.
- R6. **Conectores como registro enchufable** con esquema, permisos y tests, no controladores gigantes.
- R7. **Nada de endpoints de desarrollo en las rutas de producción.** Todo sigue el aislamiento por tienda.

## 2. Fases

Orden: **P0 → P1 → (P2 ∥ P4) → P3 → P5 → P6 → P7.**
Estimación en semanas-dev de un senior. Con agentes en paralelo, el calendario se comprime.

| Fase | Qué entrega | Semanas | Depende |
|---|---|---|---|
| P0 | Cierre de la deuda del #1099 | 1 | — |
| P1 | Conexión total con Vendix: eventos, acciones y candado de aprobación | 4 | P0 |
| P2 | Motor avanzado | 4 | P0 |
| P3 | Externos e inéditos | 4 | P1, P2 |
| P4 | Documental completo | 5 | P0 (+ decisión PDF) |
| P5 | Constructor visual, galería y experiencia | 4 | P2 |
| P6 | IA dentro del flujo y consumo de tokens por plan | 2,5 | P1, P5 |
| P7 | Operación de producción | 2,5 | todas |
| **Total** | | **≈ 27** | |

---

### P0 · Cierre de la deuda del #1099 (1 semana)

**Historia.** Como dueño de una tienda de la industria Administración, quiero que Flujos y Documentos funcionen sin candados equivocados ni solicitudes perdidas, para confiar en el módulo desde el primer día.

| ID | Requisito | Criterio de aceptación (lo que se ve) |
|---|---|---|
| P0.1 | Quitar `flows`/`documents` del exclusivo `ia-business%` en la matriz de planes | Una tienda Administración con plan básico ve Flujos sin candado de plan. **Aprobado por Rafael (D2): por migración de datos** con `-- DATA IMPACT:` y snapshot de prod previo (§6.3) |
| P0.2 | Disparadores durables: el evento de negocio se escribe en un outbox **dentro de la misma transacción** del dominio | Se cae el proceso justo después de crear una compra, vuelve a arrancar y el flujo igual se inicia, una sola vez |
| P0.3 | QA en el vhost de las historias H1–H7 | Cada historia pasa en el navegador con evidencia (captura) |
| P0.4 | M4: trigger append-only de la evidencia; M5: prueba de concurrencia contra Postgres real; M6: specs de componentes; B1–B10 | Hallazgos cerrados, cada uno con su test |
| P0.5 | Escalamiento por vencimiento probado en vivo | Vence una tarea, llega el recordatorio y luego sube al rol de escalamiento |

### P1 · Conexión total con Vendix (4 semanas) — la base de la plataforma

**Historias.**
- Como gerente administrativo, quiero que **ninguna compra, gasto, ajuste de inventario, anulación o descuento por encima de mi límite** se haga efectivo sin pasar por su flujo de aprobación, para que nadie se lo salte creando la operación en su pantalla.
- Como dueño, quiero que **cualquier cosa que pase en Vendix** (venta, factura, pago, nómina, cliente, proveedor, empleado, caja, inventario) pueda arrancar un flujo, para automatizar lo que hoy hago a mano.
- Como administrador del flujo, quiero que una etapa automática pueda **actuar en cualquier módulo** (crear o actualizar facturas, gastos, movimientos de inventario, pagos, tareas, clientes y proveedores), para cerrar el proceso sin salir del flujo.

**Pasos de prueba (H-P1).** Configurar el candado "compras > $2.000.000" → crear una OC de $3.000.000 desde Compras → la OC queda en "Pendiente de aprobación" con el botón Enviar deshabilitado y un enlace a su solicitud → el gerente aprueba → la OC pasa a borrador liberado y se puede enviar. Si se rechaza, la OC queda anulada con el motivo.

| ID | Requisito | Criterio |
|---|---|---|
| P1.1 | **Registro declarativo de eventos de dominio** (catálogo con nombre, esquema del contexto y tokens), con productores en todos los módulos administrativos: ventas, facturación, pagos, compras, recepciones, gastos, nómina, inventario (ajustes, traslados, stock bajo), contabilidad (asientos, cierres), caja, clientes, proveedores, empleados, reservas y PQR | Añadir un evento nuevo es declararlo y emitirlo; el editor lo lista solo, con sus variables |
| P1.2 | **Registro declarativo de acciones** (esquema de entrada, permiso requerido, servicio de dominio que ejecuta e idempotencia). Primera ola de ~25 acciones: crear/actualizar cliente, proveedor y empleado; crear gasto; crear OC; aprobar/anular OC; ajuste y traslado de inventario; nota crédito; registrar pago; crear tarea CRM; asignar etiqueta; cambiar estado de pedido; enviar documento | Cada acción pasa por el **mismo servicio** que usa la UI (mismas reglas y permisos) y tiene test; el validador rechaza acciones desconocidas (R1) |
| P1.3 | **Candado de aprobación genérico (approval gate)**: interceptor que, ante una operación sensible configurada, la deja en `pending_approval`, inicia el flujo y la libera o anula según el resultado. Se configura desde el flujo ("este flujo gobierna: compras > X"), no módulo por módulo | Lista inicial de operaciones gobernables: OC, gastos, ajustes de inventario, notas crédito/anulaciones, descuentos sobre umbral, pagos a proveedores, liquidación de nómina. Una operación pendiente no se puede ejecutar por ninguna ruta (UI, API, IA) |
| P1.4 | Vínculo bidireccional: la entidad muestra "Solicitud #123 · etapa X" y la solicitud muestra la entidad | Desde la OC se llega a la solicitud y al revés |
| P1.5 | Mapeo de datos evento → formulario de la solicitud con tokens | La solicitud nace con proveedor, monto y productos ya llenos |

Risk: item 1 (estado nuevo en entidades), 2 (permisos de acciones), 4 (interceptor y concurrencia) → verificador independiente.

### P2 · Motor avanzado (4 semanas)

**Historias.**
- Como jefa de talento humano, quiero que al contratar a alguien **TI, nómina y dotación trabajen en paralelo** y que el ingreso se cierre cuando los tres terminen, para no hacerlo en cadena.
- Como contador, quiero que un flujo **espere** ("3 días después de la factura", "hasta el día 5 del mes") y luego siga solo, para no tener que acordarme.
- Como administrador, quiero **reutilizar un subflujo** (alta de proveedor) dentro de otros flujos, para no repetirlo.
- Como dueño, quiero que si una acción automática falla, el flujo **reintente y, si no puede, me avise y siga por una ruta de error**, para que nada quede trabado en silencio.

| ID | Requisito | Criterio |
|---|---|---|
| P2.1 | **Paralelo con unión** (fork/join): todas, cualquiera o N de M ramas | Las tres ramas aparecen en "Mis tareas" a la vez; la unión espera según la regla elegida |
| P2.2 | **Subflujos**: lanzar uno o varios hijos y esperar o no su cierre; pasar y devolver variables | El padre muestra a sus hijos en la línea de tiempo |
| P2.3 | **Esperas y temporizadores**: duración, fecha fija, fecha de una variable, día hábil (calendario Colombia) | La espera aparece con su cuenta regresiva y avanza sola |
| P2.4 | **Bucles** con condición y límite duro (sin bucles infinitos) | El validador exige el límite |
| P2.5 | **Guardas** antes de avanzar: bloquean con mensaje o redirigen a otra etapa | Se ve el motivo del bloqueo |
| P2.6 | **Puntos de disparo** al entrar, completar, enviar y salir, todos ejecutados (R2) | Test por cada punto |
| P2.7 | **Política de error por acción**: reintento con backoff, continuar, o ir a la ruta de error. Dead-letter con alerta al dueño del flujo (R4) | Una acción caída genera alerta y se puede reintentar a mano |
| P2.8 | **Migración de instancias entre versiones** con mapa etapa→etapa y vista previa | Las solicitudes vivas pasan a v2 sin perder historia |
| P2.9 | **Expresiones y variables calculadas** (aritmética, fechas, texto) con catálogo cerrado y seguro, sin código arbitrario | Campo "Total con IVA" calculado en vivo |
| P2.10 | **Disparador programado** (cron con expresión libre y zona horaria de la tienda) | "Cada lunes 8 a. m.: revisión de caja" |
| P2.11 | Interruptor para apagar un flujo sin borrarlo | Al apagarlo no se inician solicitudes nuevas y las vivas siguen |

Risk: item 4 (concurrencia en la unión y los temporizadores) → verificador independiente.

### P3 · Externos e inéditos (4 semanas)

**Historias.**
- Como proveedor externo, quiero **llenar un formulario público** (con QR o enlace) para registrarme y subir mis documentos, y ver en qué va mi solicitud, sin tener cuenta en Vendix.
- Como administrador, quiero que **otro sistema** (la web de la empresa, un CRM o un formulario de Google) **arranque un flujo** en Vendix, para centralizar todo.
- Como administrador, quiero que una etapa **consulte o envíe datos a un servicio externo**, para integrar lo que Vendix no tiene.
- Como gerente, quiero gestionar **procesos sobre cosas que Vendix no tiene** (contratos, activos, pólizas, trámites legales) con sus propios campos, para no usar Excel aparte.

| ID | Requisito | Criterio |
|---|---|---|
| P3.1 | **Webhook de entrada por flujo**: URL con secreto y firma HMAC, esquema de entrada validado, idempotencia por clave, límite de tasa (R5) | Un `curl` firmado inicia la solicitud; uno sin firma recibe 401 |
| P3.2 | **Nodo HTTP genérico**: método, headers, cuerpo con tokens, secretos guardados por tienda (nunca en el JSON), timeout, reintentos, respuesta mapeada a variables, protección SSRF (lista de bloqueo de IP privadas y metadata) | "Probar esta acción" muestra la respuesta real |
| P3.3 | **Registro enchufable de conectores** (R6). Primera ola: correo saliente con plantilla; correo entrante que crea solicitudes (buzón por tienda); WhatsApp por el canal de la tienda; Google Sheets (añadir/leer fila) y Drive (guardar documento) con OAuth por tienda **(pendiente de D3)**; facturación DIAN mediante el módulo propio de Vendix | Cada conector tiene su esquema, su prueba y su página de conexión |
| P3.4 | **Formularios públicos avanzados**: QR, expiración, multi-paso, subida por partes, captcha y desactivación | Formulario de 3 pasos con adjunto de 50 MB |
| P3.5 | **Portal de seguimiento externo**: enlace mágico para que el solicitante externo vea el estado y responda lo que le pidan | El proveedor ve "Falta: RUT actualizado" y lo sube desde el enlace |
| P3.6 | **Registros personalizados (entidades inéditas)**: el cliente define una colección con sus campos (contratos, activos, pólizas), con lista, detalle, expediente y flujos sobre ella | Crear "Contratos" con fecha de vencimiento y un flujo de renovación que arranca 30 días antes |

Risk: item 2 (endpoints públicos, secretos, SSRF) → verificador independiente.

### P4 · Documental completo (5 semanas) — incluye los bloques 9, 10 y 14

**Decidido (D1):** motor PDF = **C, `pdfkit` con bloques**, sin infraestructura nueva.

**Historias.**
- Como encargada de personal, quiero **generar el contrato desde una plantilla** con los datos del empleado y **enviarlo a firmar** por correo o WhatsApp, para no imprimir ni escanear.
- Como contador, quiero que la **IA lea la factura** subida y llene proveedor, NIT, fecha y total, para no digitarlo.
- Como administrador, quiero que me **avise cuando un documento vence** (cédula, certificado, póliza), para renovarlo a tiempo.

| ID | Requisito | Criterio |
|---|---|---|
| P4.1 | Bloque 9: `document_templates` con versiones inmutables, tokens y filtros, editor por bloques con vista previa, render en cola, `issued_document` en el motor | El contrato sale en PDF con los datos reales |
| P4.2 | Bloque 10: **firma electrónica simple** (Ley 527/1999, Decreto 2364/2012): enlace, OTP por correo o WhatsApp, trazo, evidencia (IP, hora, hash del documento, OTP validado) y PDF sellado con su hoja de evidencia | El firmante firma desde el celular; el expediente guarda el PDF firmado y la evidencia |
| P4.3 | Bloque 14: OCR con procedencia (campo → página y región, confianza) y validación IA (tipo de documento, legibilidad, coincidencia con la solicitud). **Consume tokens del plan** | La factura llena el formulario y marca en amarillo lo de baja confianza |
| P4.4 | Purga programada por política de retención, que respeta `legal_hold` | Informe de lo purgado |
| P4.5 | Plantillas desde un PDF base (campos superpuestos) | Formato oficial del cliente llenado solo |
| P4.6 | Vencimiento de documentos con alertas y flujo de renovación | Alerta 30 días antes |
| P4.7 | Búsqueda en el expediente (nombre, tipo, etiquetas y texto extraído por OCR) y carpetas por entidad (cliente, proveedor, empleado, contrato, registro personalizado) | Buscar "RUT" trae los de todos los proveedores |

Risk: item 1 (datos persistidos de evidencia) y 2 (enlaces públicos de firma) → verificador independiente.

### P5 · Constructor visual, galería y experiencia (4 semanas)

**Historias.**
- Como dueño sin conocimientos técnicos, quiero **armar un flujo arrastrando pasos** y probarlo antes de publicarlo, para no depender de nadie.
- Como nuevo cliente de Administración, quiero **activar una plantilla lista** y ajustarla, para empezar en minutos.

| ID | Requisito | Criterio |
|---|---|---|
| P5.1 | **Canvas editable** con todos los tipos de paso de P2. Librería libre con soporte Angular (`sequential-workflow-designer`, MIT) o equivalente; se elige en una prueba de un día | El flujo de compras completo se arma sin tocar JSON |
| P5.2 | Simulador paso a paso y **depurador de instancias** (ver variables en cada paso) y "probar esta acción" | Se ve el recorrido con datos de prueba |
| P5.3 | Selector de variables y constructor de condiciones visual | Sin escribir tokens a mano |
| P5.4 | **Galería de 12 plantillas** de Administración: compras con aprobación por monto, gastos y reembolsos, anticipos, vacaciones y permisos, contratación, retiro de empleado, alta de proveedor, renovación de contratos, PQR, cierre de caja, conciliación mensual y solicitud de pago | Activar una plantilla la deja publicada y lista en menos de 2 minutos |
| P5.5 | Kanban multi-flujo filtrado por rol y sede; vista móvil web de "Mis tareas" | Aprobar desde el celular |
| P5.6 | Actualización en vivo (SSE o websocket) de bandeja e instancias | La tarea aparece sin recargar |

### P6 · IA dentro del flujo (2,5 semanas) — lo que diferencia los planes

Criterio de producto de Rafael: **el acceso al módulo lo da la industria y los planes se diferencian por la IA y sus tokens.**

**Historias.**
- Como dueño, quiero **describir el proceso en palabras** y que la IA arme el flujo, para no diseñarlo yo.
- Como gerente, quiero que un paso de IA **clasifique, extraiga, resuma o redacte** (por ejemplo, clasificar la PQR y redactar la respuesta), para ahorrar tiempo.

| ID | Requisito | Criterio |
|---|---|---|
| P6.1 | **Paso de IA** en el motor: clasificar, extraer a campos, resumir, redactar y decidir rama (siempre con salida estructurada validada y opción de revisión humana) | Una PQR entra clasificada y con borrador de respuesta |
| P6.2 | Herramientas faltantes: `workflows_update_draft`, `workflows_complete_task` y `workflows_start_instance`, con confirmación | Vex arma y lanza un flujo desde el chat |
| P6.3 | **Medición de tokens por tienda y por flujo**, dentro de los **límites actuales de cada plan, sin cambiar cifras (D4)**; aviso al 80 % y bloqueo suave al 100 % | El dueño ve su consumo en el tablero |
| P6.4 | Narrativa IA en la analítica (por qué se trabó el proceso este mes) | Resumen semanal |

### P7 · Operación de producción (2,5 semanas)

| ID | Requisito | Criterio |
|---|---|---|
| P7.1 | Límites por plan: instancias/mes, ejecuciones HTTP, almacenamiento y tokens | Superar el límite muestra el paywall, no un error |
| P7.2 | Auditoría inmutable (append-only) de definiciones, decisiones, accesos a documentos y secretos | Exportable para una auditoría externa |
| P7.3 | Permisos por flujo y por etapa (quién diseña, quién ve y quién actúa) | Un empleado no ve flujos ajenos |
| P7.4 | Observabilidad: métricas de cola, latencia, dead-letter y webhooks; alertas a Quickss | Tablero interno |
| P7.5 | Prueba de carga: 1.000 solicitudes/hora por tienda y 50 aprobaciones simultáneas, sin duplicados | Informe con resultados |
| P7.6 | Exportación completa de flujos, instancias y expedientes por tienda | ZIP descargable |
| P7.7 | Documentación de ayuda y FAQ del módulo | Las FAQ dicen lo que el módulo hace de verdad |

---

## 3. No-alcance explícito
- Sin nodos de código arbitrario (JS/Python) dentro del flujo.
- Sin BPMN 2.0 completo (compensación, mensajes entre pools).
- Sin firma digital certificada con proveedor ECD en este plan (va en P4.2 como firma simple; la certificada sería un conector futuro).
- Sin `apps/mobile` nativa: la vista móvil es web.
- No reemplaza las máquinas de estado duras (DIAN, nómina, contabilidad): las gobierna con el candado de P1.3 y las invoca por acciones.

## 4. Decisiones

**Tomadas por Rafael (2026-11-07):**
- **D1. Motor PDF = opción C**: `pdfkit` (ya en el repo) con plantillas por bloques. Sin contenedor Chromium ni servicio externo; no hay HTML/CSS libre. Destraba P4.1 y P4.2.
- **D2. Quitar el exclusivo de IA Business por migración**: en P0.1 se crea una migración de datos que elimina las filas `exclusive` de `flows`/`documents` para `ia-business%`. Lleva el bloque `-- DATA IMPACT:` y es idempotente. Se toma snapshot de prod antes del deploy (CLAUDE.md §6.3).
- **D4. Límites de tokens: se quedan como están hoy por plan.** P6.3 solo mide y muestra el consumo de los flujos dentro de los límites actuales; no cambia cifras.

**Pendientes:**
- **D3. Conectores Google** (Sheets y Drive): requieren una app OAuth verificada por Google (gratis, pero con una revisión de semanas). Rafael preguntó para qué sirven. Hasta que decida, P3.3 sale sin Google.
- **D5. Prioridad comercial:** se recomienda vender primero "aprobaciones que gobiernan Vendix + documentos firmados", que es P1 + P4.

## 5. Forma de ejecución
- Una fase = una rama desde `develop` en su worktree, un PR con aviso de migración, `REPORTE` con historias verificadas y una revisión ≥ 89.
- Migraciones aditivas e idempotentes. Cualquier mutación de datos requiere aprobación explícita (CLAUDE.md §6).
- Tests solo de lo tocado. Un proceso pesado a la vez en la Mac.
- P2 y P4 pueden ir en paralelo en dos worktrees: tocan superficies distintas (motor frente a documental).
