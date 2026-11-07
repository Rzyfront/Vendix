# Flujos adm — P0: cierre de la deuda del #1099

Objetivo: dejar Flujos y Documentos sin candados equivocados ni solicitudes perdidas (`odd/tasks/flujos-administracion-plan.md` §2 P0).
Rama: `feat/flujos-adm-p0` desde `origin/develop`. Entrega: un PR a develop, commits por requisito. Runner backend: `npx jest --runInBand --config <scratch isolatedModules> <spec>`, un spec por invocación.

## Specs

Historia de la fase (textual): "Como dueño de una tienda de la industria Administración, quiero que Flujos y Documentos funcionen sin candados equivocados ni solicitudes perdidas, para confiar en el módulo desde el primer día."

- **S1 — P0.1.** "Quitar `flows`/`documents` del exclusivo `ia-business%` en la matriz de planes". Criterio textual: "Una tienda Administración con plan básico ve Flujos sin candado de plan. **Aprobado por Rafael (D2): por migración de datos** con `-- DATA IMPACT:` y snapshot de prod previo (§6.3)".
  - Historia: Como dueño de una tienda Administración con plan básico en el menú del panel, quiero entrar a Flujos y Documentos sin candado de plan, para usar el módulo que me da mi industria.
  - Pasos: 1) Entrar al panel con una tienda `administration` y plan básico. 2) Abrir el menú lateral. 3) Pulsar Flujos.
  - Se ve: Flujos y Documentos sin candado y sin paywall; la pantalla de Flujos carga.
- **S2 — P0.2.** "Disparadores durables: el evento de negocio se escribe en un outbox **dentro de la misma transacción** del dominio". Criterio textual: "Se cae el proceso justo después de crear una compra, vuelve a arrancar y el flujo igual se inicia, una sola vez".
  - Historia: Como dueño, en Compras, quiero que el flujo disparado por una operación arranque aunque el servidor se caiga justo después, para no perder solicitudes.
  - Pasos: 1) Publicar un flujo con disparador de negocio. 2) Hacer la operación. 3) Tumbar el proceso antes de que corra el despachador. 4) Arrancarlo otra vez. 5) Abrir Flujos → Solicitudes.
  - Se ve: una sola solicitud nueva, con los datos de la operación. Si la operación falla, ninguna solicitud.
- **S3 — P0.3.** "QA en el vhost de las historias H1–H7". Criterio textual: "Cada historia pasa en el navegador con evidencia (captura)". Las historias H1–H7 están en `REPORTE-FLUJOS.md`.
- **S4 — P0.4.** "M4: trigger append-only de la evidencia; M5: prueba de concurrencia contra Postgres real; M6: specs de componentes; B1–B10". Criterio textual: "Hallazgos cerrados, cada uno con su test".
  - Historia M4: Como responsable legal, quiero que la base de datos impida editar o borrar evidencia, para que el expediente sirva en una auditoría.
  - Historia M5: Como dueño, quiero que dos aprobaciones simultáneas no dupliquen el avance contra una base real, para confiar en la solicitud.
  - Historia M6: Como usuario, quiero que las pantallas de Flujos muestren bien carga, error y vacío, para saber qué pasa.
  - B1–B10: `REVIEW-1099.md` de la ronda 1 (copiados en la tabla de Tasks).
- **S5 — P0.5.** "Escalamiento por vencimiento probado en vivo". Criterio textual: "Vence una tarea, llega el recordatorio y luego sube al rol de escalamiento".
  - Historia: Como gerente, en Mis tareas, quiero que una tarea vencida me avise y luego suba al rol de escalamiento, para que nada se quede quieto.
  - Pasos: 1) Publicar un flujo con plazo corto, recordatorio y escalamiento. 2) Iniciar una solicitud y no atenderla. 3) Esperar el vencimiento. 4) Mirar las notificaciones y Mis tareas del rol de escalamiento.
  - Se ve: primero el recordatorio al responsable; después la tarea en la bandeja del rol de escalamiento y la línea de tiempo con el escalamiento.

Riesgo: migraciones y datos (D2, triggers), concurrencia (outbox, CAS), dinero (se toca la transacción de pagos y órdenes solo para escribir el outbox), seguridad (SSRF, throttle). Verificador independiente: el pipeline lanza la revisión aparte.

## Tasks

| ID | S# | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S1 | inline | ✅ | `7d2f6c4e8`; paridad 36/36; dry-run en copia: 4 filas fuera, resto intacto, segunda corrida 0; vhost sin candado con plan Starter |
| T2 | S2 | inline | ✅ | `d32aeaf0e`; en vivo: `kill -9` tras la recepción, el worker arrancó una solicitud por evento; spec en Postgres real |
| T3 | S4 M4 | inline | ✅ | `db6f16347`; triggers probados en Postgres real |
| T4 | S4 M5 | inline | ✅ | `851121d01`; 15/15 en Postgres real; job de CI nuevo; halló el bug de idempotencia con el adaptador pg |
| T5 | S4 B1–B10 | inline | ✅ | `f42c322f5`, `011206df0`; además B11 |
| T6 | S4 M6 | inline | ✅ | `1ffa0d84e`, `cb2d0147a`; 31 specs de Karma; B9 |
| T7 | S5 | inline | ✅ | `cd4f7ea92`, `7bcce1ac9`; en vivo con worker: recordatorio, luego escalamiento; halló la fuga entre organizaciones |
| T8 | S3 | inline | ✅ | 38 capturas en la carpeta del encargo; H1–H7 pasan en navegador. H5: chat de Vexi con modelo real, borrador creado tras confirmar. H7: webhook creado en pantalla, entrega real HTTPS con firma HMAC verificada |
| T9 | S4 B4, S5 | inline | ✅ | Revisión r1: `bc7532241` (CI con `isolatedModules`, 92 + 16 tests en GitHub), `99b2e316c` (`admin` de la organización), `01ebbed14` (B4 por tienda), `a19ee563e`, `005e7ad33` (B9) |

## Log

- L1 (2026-11-07, encargo): "Implementa TODA la fase P0 de PLAN.md §2 (todas sus filas y sus historias), cerrando cada requisito con código, specs y verificación."
- L2 (2026-11-07, QA): el QA halló lo que los specs con dobles no veían: estado `active` frente a `published`, respuesta de publicar e iniciar, y encabezado. Corregido en `cb2d0147a`.
- L3 (2026-11-07, decisión): con recordatorio y escalamiento juntos, primero se avisa y al cumplirse un intervalo sube (criterio textual de P0.5). Sin recordatorio sube al vencer.
- L4 (2026-11-07, decisión): `purchase_order.received.total_amount` se calcula dentro de la transacción (valor recibido del lote con su parte de flete prorrateado). El monto contable exacto sigue calculándose después del commit.
- L5 (2026-11-07, pendiente): B12 sigue abierto porque pide una columna nueva y no está en P0. El patrón `meta.target` falla con el adaptador pg en otros módulos fuera de Flujos.
- L6 (2026-11-07, revisión r1, nota 81): CI del job de Postgres moría sin memoria; los `admin` de la organización quedaban fuera de los titulares de un rol; B4 validaba la OC y el proveedor por organización y no por tienda; faltaba el test de B9; H5 y H7 estaban parciales. Todo cerrado en T9 y T8. En el entorno de QA la clave de la configuración IA por defecto (`id=1`) da 401 en el proveedor, también en la base de desarrollo; el QA usó la configuración 9 en la copia scratch y la restauró después.
