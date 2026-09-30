# Recepción y consolidación fiscal — evidencia de ejecución

Goal completo; no declarar finalizado hasta que TODOS los requisitos estén probados contra el árbol/datos reales. Resultado de subagente, watcher verde o unit test aislado no demuestra E2E.

## Baseline y entorno

- Rama `develop`, HEAD inicial `724fa852c383e6361c390b551a976d46fa770a08`.
- `git fetch origin` + `git rev-list --left-right --count HEAD...origin/develop`: `0 0`; árbol limpio antes del plan.
- Importación Engram completada, sin chunks nuevos.
- Backend/Postgres/Redis/Nginx locales running. Frontend watcher inicialmente caído (`RANCIO`), no constituye prueba de compilación actual; se levantará un único watcher nativo cuando haga falta.
- Sin acceso/mutación productiva, push, PR o deployment.

## Matriz requisito → evidencia

| Requisito | Estado inicial | Evidencia necesaria / ubicación |
|---|---|---|
| Plan completo y decisiones | Estructura validada; commit local f0f0b8952 | Plan 21 pasos y Business Analysis Brief; decisiones adicionales registradas |
| Recepción manual XML/manual/PDF/imagen | Manual/XML API local probados; PDF/imagen pendientes | UI/formularios y OCR aún pendientes |
| IA asíncrona, edición y determinismo | Pendiente | PDF multipágina/imagen, job/poll IDOR, proveedor/fallo/cuota |
| Recepción automática y sync total | Pendiente | Webhook/poll/mail configurado, cursor/lock/retry, fila visible E2E |
| Tab Facturación STORE/ORG | Código integrado; watcher full OK; E2E pendiente | Navegación real, responsive, consola/network aún no probados |
| Matching N:M/recepción/gasto | Pendiente | API/UI + SQL vínculos, parciales/UoM/diferencias |
| Deduplicación sin efectos repetidos | Pendiente | Multicanal/mismo número distinto emisor/concurrencia y stock/AP/ledger |
| Eventos electrónicos correctos | Pendiente | Prerrequisitos, roles/XML/firmante y confirmación técnica; 034 observado |
| Contabilidad y bridge IVA correctos | Pendiente | Asientos por fuente, DR=CR, no doble IVA/AP y ajustes/reintentos |
| Posición por NIT/impuesto/período | Pendiente | Preview/borrador/API/UI/XLSX iguales y créditos de tipo correcto |
| Anticipos/créditos/arrastres | Pendiente | Fuente/evidencia/aplicaciones + carreras/no sobreconsumo |
| Saldos y pagos tributarios | Pendiente | Abono/final/replay/reverso y auxiliar contable |
| Periodicidad y calendario | Utilidad y DTO probados; persistencia/calendario pendientes | 20 specs de rangos UTC; aún falta integración con borradores/obligaciones/calendario |
| Obligación/declaración/cierre | Pendiente | Snapshot inmutable, checks de fuentes/AP/contabilidad/pagos |
| Reportes consolidados | Pendiente | XLSX completo, fuentes/exclusiones/fechas/scope y auxiliar |
| RBAC/tenant/archivos/SSR​F | Pendiente | Happy/sad/brute curl/UI y specs de seguridad |
| Cero errores afectados | Pendiente | Watch backend/frontend actuales, tests seriales, audits |
| Commit sin push + reporte final | Pendiente | SHAs finales, status, decisiones/evidencia y memoria |

## Evidencia por tarea

Se registrarán comandos exactos, fecha UTC, HEAD/árbol probado, resultados y alcance. Una prueba mock se identifica como tal; no se presentará como evidencia de proveedor externo productivo.

### Fundaciones verificadas (30-09-2026, árbol parcial, HEAD f0f0b8952)

- Analítica IVA: `BUILDCHECK_TEST_MEM=4096 npm run buildcheck:test -- src/domains/store/analytics/analytics-metrics.contract.spec.ts` — **46/46 PASS**, log `/tmp/vendix-rd-contract-65041/backend-tests.log`.
- Servicio analítico: mismo runner sobre `src/domains/store/analytics/services/financial-analytics.service.spec.ts` — **36/36 PASS** tras corregir fixture ICUI/IBUA, log `/tmp/vendix-rd-financial2-68308/backend-tests.log`. Esto sólo prueba la estimación operacional, no el consolidado fiscal final.
- Parser: runner sobre `src/domains/received-documents/services/received-document-parser.service.spec.ts` — **22/22 PASS**, 07:41:26–07:41:33 UTC, log `/tmp/vendix-rd-parser4-71515/backend-tests.log`. Corridas anteriores fallaron por texto/elementos anidados en Description; se conserva la regresión. No prueba firma criptográfica ni respuesta DIAN real.
- Períodos: runner sobre `src/domains/fiscal-operations/services/fiscal-period.util.spec.ts` — **20/20 PASS**, log `/tmp/vendix-rd-period-71082/backend-tests.log`; proceso ya terminal, ningún Jest del spec en ejecución. No prueba aún persistencia ni vencimientos.
- Persistencia de periodicidad en borradores: runner sobre `src/domains/fiscal-operations/services/tax-declaration-draft.service.spec.ts` — **20/20 PASS**, log `/tmp/vendix-rd-draft-period-74081/backend-tests.log`; prueba rangos bimestral/cuatrimestral, reuso/recalculo, vínculo de obligación scoped y rechazo de fechas/tipos conflictivos. Todavía falta calendario y cálculo fiscal canónico completo.
- Migración aditiva: validación Prisma PASS; SQL ejecutado dos veces dentro de una transacción local revertida, 12 tablas nuevas; `docker exec vendix_backend npx prisma migrate deploy` aplicó únicamente `20260930070000_received_documents_and_tax_settlement`, sin datos recibidos previos. No aplicada a producción.
- Client Docker: estaba desactualizado respecto del generado en host. `docker run --rm --volumes-from vendix_backend -w /app -e DATABASE_URL=postgresql://prisma:prisma@db:5432/vendix_db -e NODE_OPTIONS=--max-old-space-size=2048 --entrypoint npx vendix-backend prisma generate` — PASS; comprobación DMMF `received_documents=true` en el contenedor real. Sin generar dentro del proceso Nest activo.
- Storage: primeras corridas detectaron TS2322 de driver y default import node:path incompatible con ts-jest; corregidos, **11/11 PASS** en `/tmp/vendix-rd-storage3-72875/backend-tests.log`. Adaptador local temporal y S3 mock; ninguna prueba toca S3 real.
- Backend `/api/health` responde ok tras client refresh; errores SWC de archivos a medio escribir durante el trabajo se deben revalidar en estado final. No es evidencia de API nueva todavía.
- Browser nativo: bootstrap falló por importación `node:process` no permitida antes de seleccionar navegador. Sin E2E UI ejecutado; no se declara UI validada.

### Núcleo/API y calendario (árbol parcial, commit de API 7576fd98c)

- Core `received-documents.service.spec.ts`: **17/17 PASS**, `/tmp/vendix-rd-core4-81059/backend-tests.log`. Corrigió typo de line_number y mock transaccional que no resolvía filas por id; corrida core3 intermedia falló por parser editándose, no se cuenta como prueba final. Scope activo STORE/ORG, revisión/versiones, no efectos, original idempotente y alias/copias OCR cubiertos con DB mock. Validación de receptor fiscal y persistencia nominal aún en implementación.
- Contexto `received-documents-context.service.spec.ts`: **6/6 PASS**, `/tmp/vendix-rd-context1-77509/backend-tests.log`; controllers `received-documents.controller.spec.ts`: **8/8 PASS**, `/tmp/vendix-rd-controllers1-78043/backend-tests.log`. StreamableFile prueba bytes y headers, no sólo MIME.
- Calendar `fiscal-tax-calendar.service.spec.ts`: **18/18 PASS**, `/tmp/vendix-rd-calendar2-80675/backend-tests.log`; incluye 10 dígitos en 12 períodos mensuales y cierres multi-mes por tabla literal oficial. TS2367 detectado/corregido en corrida previa; integración con obligaciones aún pendiente.
- Parser de impuestos saludables/redondeo: **PASS** en `/tmp/vendix-rd-parser5-81617/backend-tests.log`; clasificación 34/35, desconocidos bloqueados, nominal y ajuste firmado. La precisión nominal adicional deberá verificarse antes del cierre global.
- Runtime local: controllers STORE/ORG montados antes de catch-all de facturación; JWT seed autorizado y `GET /api/store/invoicing/received-documents` **HTTP 200**, lista vacía real. Sólo se agregaron 6 permisos/17 grants locales para probar, sin ejecutar seed general. Login usa store_slug o organization_slug, nunca ambos simultáneos. Tokens en archivos temporales restringidos, no en commits/memorias.
- Migración adicional `20260930083000_received_tax_basis_and_unknown_deadlines`: Prisma validate PASS, SQL doble ejecución en transacción ROLLBACK PASS. 36 obligaciones existentes, 0 colisiones de entidad/tipo/rango/jurisdicción; aplicación/generación local en curso. Ninguna fila histórica eliminada.
- Watch backend muestra errores previos de reembolsos sin caja y órdenes serializadas incompletas en otros módulos; se separan del receiver, no se afirma cero errores globales.

### Verificación adicional y estado del checkpoint

- Migración 20260930083000 aplicada sólo local; client host y volumen Docker regenerados. Deadline nullable e índice único rango/jurisdicción confirmados, datos históricos preservados.
- Núcleo identidad fiscal: 27/27 PASS en /tmp/vendix-rd-core-nit1-84796/backend-tests.log; después del filtro header y su regresión, 28/28 PASS en /tmp/vendix-rd-core-final-91006/backend-tests.log.
- Parser final: 32/32 PASS en /tmp/vendix-rd-parser-final-90224/backend-tests.log. Se corrigió una premisa del orquestador: FAS09/FAS11 permiten p(0-2), más decimales nominales se bloquean; no ampliar el perfil por intuición.
- Calendar final: 22/22 PASS en /tmp/vendix-rd-calendar3-86610/backend-tests.log; integración obligaciones: 25/25 PASS en /tmp/vendix-rd-obligation-cal1-85593/backend-tests.log. Unknown NULL/blocked, estados finales protegidos; períodos por familia/configuración municipal y motor fiscal completo siguen pendientes.
- QA HTTP con seed autorizado en STORE_ADMIN activo mediante cambio de entorno soportado: manual 201 id1, replay mismo id1; XML 201 id2, replay mismo id2/1 archivo; download 200 con SHA-256 idéntico. Tenant ajeno 404, sin JWT 401. Sólo DB/archivos locales, ningún acto DIAN/pago.
- SQL confirma ambos documentos ready, review/fiscal/posting pending y cero links. Header tax API 1 fila y línea 1 fila, no ambas como encabezado.
- Frontend: se detuvo el único watcher lite (techo3072/assertion, más errores reales señal/Router durante edición), se ejecutó Jest serial y se inició uno full. Último ciclo OK 08:46:47 UTC, pid91685; sólo warning preexistente PurchaseTrends CurrencyPipe. Vhost https://vendix.com/ 200. No sustituye E2E UI.
- Browser nativo volvió a fallar bootstrap (node:process no permitido). Ninguna navegación/E2E UI completada.
- Matching: faltan asignación relacional por línea y moneda/fiscal owner inequívoco de PO central. La DB ya exige exactamente un target en aggregate links mediante CHECK SQL; su ausencia en schema Prisma no implica ausencia en DB.
- Consolidado: todavía no consume received eligible_amount ni créditos durables; precierre renta incluye retenciones sufridas ajenas. Objetivo completo NO alcanzado.

## Auditoría de completitud

No realizada aún. `update_goal complete` prohibido hasta revisar cada fila y todos los Specific Objectives del plan con evidencia fuerte del estado final.
