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
| Recepción manual XML/manual/PDF/imagen | Pendiente | Parser fixtures + curl + UI + originales y reload |
| IA asíncrona, edición y determinismo | Pendiente | PDF multipágina/imagen, job/poll IDOR, proveedor/fallo/cuota |
| Recepción automática y sync total | Pendiente | Webhook/poll/mail configurado, cursor/lock/retry, fila visible E2E |
| Tab Facturación STORE/ORG | Pendiente | Navegación real con scope, responsive, consola/network |
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

## Auditoría de completitud

No realizada aún. `update_goal complete` prohibido hasta revisar cada fila y todos los Specific Objectives del plan con evidencia fuerte del estado final.
