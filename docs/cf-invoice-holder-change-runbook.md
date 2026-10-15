# Cambio de titular de factura: operación y validación

## Alcance

Factura electrónica de consumidor final vinculada a una orden sin cuentas divididas. Los caminos público (QR) y administrativo deben usar el mismo motor recuperable: nota crédito total aceptada, liberación de la orden, nuevo cliente y factura de reemplazo. Las solicitudes solo nacen al abrir o enviar el formulario; imprimir, vender y consultar seguimiento no las materializa.

Este documento define el procedimiento; **no constituye evidencia de que se haya desplegado ni ejecutado una prueba**. Registrar resultados reales en el reporte de ejecución. No usar producción para crear documentos fiscales de prueba.

## Preparación y configuración

- Revisar la migración aditiva y su encabezado DATA IMPACT. Conservar registros históricos, tokens UUID y documentos fiscales.
- Verificar `JWT_SECRET` y `FRONTEND_URL` por presencia/configuración, sin imprimir valores. El origen público debe resolver la ruta neutral `/factura/:token`.
- En el formato «Factura electrónica POS», `show_holder_change_qr` está apagado por defecto (también si falta el campo). Activarlo explícitamente por tienda solo después de QA; no controla el QR DIAN ni la continuidad del motor.
- Desactivar admisiones inicialmente con `CF_HOLDER_CHANGE_ENABLED=false`. Restringir el canario mediante `CF_HOLDER_CHANGE_STORE_IDS` antes de habilitarlo.
- Configurar `CF_HOLDER_TOKEN_KEY_ID` y, al rotar, distribuir primero `CF_HOLDER_TOKEN_PREVIOUS_SECRETS`. Mantener las claves anteriores durante la vigencia de sus enlaces. No renovar expiración al reimprimir.
- Identificar versión y workers que procesan solicitudes. No ejecutar el procesador antiguo y el motor nuevo sobre las mismas solicitudes.
- Confirmar que el ambiente de QA ejecuta **esta rama**, no otro checkout. Logs de un backend montado desde otro árbol no verifican estos cambios.

## Secuencia de despliegue

1. Validar la migración dos veces en una base aislada autorizada, con conservación de las filas preexistentes. Revisar índices, restricciones y coste de los locks. No reset ni seed global.
2. Aplicar la migración en la ventana autorizada mediante el pipeline: `npm run db:migrate:prod -w apps/backend`. El arranque del contenedor no sustituye este paso. Comprobar `prisma migrate status` en el ambiente correspondiente.
3. Desplegar backend y frontend compatibles con UUID legacy, token guest separado, HMAC y ausencia temporal de enlace fiscal. Mantener admisión desactivada. Retirar la creación automática de solicitudes también con el flag apagado.
4. Drenar/fijar los workers antiguos y arrancar el reconciliador nuevo. No limpiar estados `processing` en bloque; recuperar por operación y evidencia DIAN.
5. Probar seguimiento guest, comprobantes, reseñas y lectores legacy con admisión desactivada. Status, continuación y recovery deben seguir disponibles.
6. Habilitar solo la tienda sandbox/canario. Verificar QR, formulario, solicitud lazy, nota crédito, reemplazo y contabilidad; incluir fallo y reintento.
7. Ampliar después de evidencia satisfactoria y de observar al menos un ciclo de recuperación completo. No crear facturas/NC reales en producción como smoke sin autorización específica.

## Matriz de aceptación

| Frente | Verificación exigida |
| --- | --- |
| Firma | Alteración, expiración exacta, formato, propósito, claves activas/anteriores, origen canónico. |
| Cero basura | Venta, checkout, PDF, reimpresión y polling no crean solicitudes. Apertura repetida reutiliza una solicitud. |
| Compatibilidad | Guest nuevo y UUID legacy: seguimiento, SSE, comprobante, Wompi y reseña sin crear solicitud fiscal. |
| Motor compartido | QR/manual convergen; NC aceptada antes de liberar; nuevo cliente y nueva factura enlazados a la orden. |
| Concurrencia real | QR/manual/emisión normal contra la misma orden: una operación, una NC y un reemplazo. Los mocks no demuestran locks PostgreSQL. |
| Recuperación | Caída DIAN, NC pendiente/rechazada, fallo de reemplazo, proceso interrumpido y reintento sin repetir documentos/consecutivos. |
| Economía | Total/impuestos exactos; contabilidad neta e idempotente; sin nuevo movimiento de caja ni stock; reserva hasta completar efectos. |
| Límites | Split, no CF, tenant ajeno, sin permisos, devoluciones/CxC no admitidas y anulación parcial se rechazan con error claro. |
| UX | Persona natural/jurídica, RUES, correo obligatorio, wizard reanudable, errores visibles y bandeja sin pendientes históricos por defecto. |
| Impresión | PDF estándar/custom/correo y térmico FE 58/80 mm conservan QR DIAN y muestran segundo QR legible solo con opt-in POS; con campo ausente/false no aparece. Nunca en ticket no fiscal. |
| Admisión apagada | Sin nuevos QR/inicios; guest, lectura de estado y recuperación de operaciones previas siguen funcionando. |

Ejecutar Happy Path, Sad Path y Brute-Force defensivo contra fixtures de desarrollo. Para interfaz, usar el vhost local correcto con Playwright y contexto que confíe en el certificado local; revisar consola y red, escritorio y pantalla estrecha. Un caso omitido o una spec `skipped` se registra como **no verificado**, no como aprobado.

## Verificación acotada

- Una spec exacta por proceso, secuencialmente, con límite de memoria y tiempo; nunca suites completas, builds o typechecks implícitos.
- Specs backend: `NODE_OPTIONS=--max-old-space-size=2048 npm run test:path -w apps/backend -- --runTestsByPath <ruta-exacta>`.
- Specs Angular: una ruta exacta en `--include` con `ChromeHeadless`, sin watch y un worker.
- Integración PostgreSQL: solo variable `CF_HOLDER_TEST_DATABASE_URL` explícita, host local y nombre terminado en `_test`; sin fallback a `DATABASE_URL`.
- Si cambian módulos backend: `npm run prisma-singleton:audit`.
- Estado de desarrollo: `docker logs --tail 80 vendix_backend` y `bash scripts/buildcheck.sh --watch`, verificando que correspondan al checkout bajo prueba. No iniciar un build adicional.

## Monitorización sin datos personales

Agrupar por tienda/operación, sin tokens ni PII: admisiones, NC/reemplazo por original, leases vencidas, fase/edad, `next_retry_at`, errores DIAN/contables y latencia de checkout. Cualquier documento/asiento/clearing duplicado obliga a detener admisión. Investigar operaciones sin próximo intento ni mensaje después de dos ciclos del reconciliador; la espera humana de cliente no equivale a un proceso atascado.

Consultas parametrizadas de ejemplo, tras contrastar los nombres contra la migración final:

```sql
SELECT status, count(*) FROM invoice_data_requests
WHERE store_id = :store_id GROUP BY status;

SELECT original_invoice_id, count(*) FROM invoice_holder_changes
WHERE store_id = :store_id GROUP BY original_invoice_id HAVING count(*) > 1;

SELECT id, phase, run_status, credit_note_id, new_invoice_id, next_retry_at
FROM invoice_holder_changes WHERE store_id = :store_id
ORDER BY id DESC LIMIT 25;
```

Comparar IDs legacy antes/después; un contador global con tráfico concurrente no prueba conservación. Conciliar saldos por documentos/entidad de los fixtures, no contra balances mezclados entre tiendas.

## Rollback funcional

Apagar admisión y QR nuevos. Mantener lectores guest duales, claves anteriores, APIs de status, continuaciones y motor/recovery para operaciones existentes. **No reactivar eager**, borrar filas, revertir migraciones aditivas ni restaurar una copia que pierda documentos. Una NC aceptada no se deshace re-enlazando la factura original: completar/corregir el reemplazo o dejar acción requerida auditada.

No volver a un binario anterior incompatible con saga/guest/guardas mientras existan operaciones nuevas. Antes de una reversión excepcional, detener admisiones y workers incompatibles, drenar/conciliar y demostrar que los lectores y el motor de la versión destino son compatibles. Revocar una clave comprometida es revocar enlaces, no un rollback fiscal.
