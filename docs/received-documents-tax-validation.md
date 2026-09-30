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
| Plan completo y decisiones | Plan creado; validar estructura | Plan 21 pasos y Business Analysis Brief; commit local |
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
| Periodicidad y calendario | Pendiente | Bimestral/cuatrimestral/annual/NIT, provenance y unknown bloqueado |
| Obligación/declaración/cierre | Pendiente | Snapshot inmutable, checks de fuentes/AP/contabilidad/pagos |
| Reportes consolidados | Pendiente | XLSX completo, fuentes/exclusiones/fechas/scope y auxiliar |
| RBAC/tenant/archivos/SSR​F | Pendiente | Happy/sad/brute curl/UI y specs de seguridad |
| Cero errores afectados | Pendiente | Watch backend/frontend actuales, tests seriales, audits |
| Commit sin push + reporte final | Pendiente | SHAs finales, status, decisiones/evidencia y memoria |

## Evidencia por tarea

Se registrarán comandos exactos, fecha UTC, HEAD/árbol probado, resultados y alcance. Una prueba mock se identifica como tal; no se presentará como evidencia de proveedor externo productivo.

## Auditoría de completitud

No realizada aún. `update_goal complete` prohibido hasta revisar cada fila y todos los Specific Objectives del plan con evidencia fuerte del estado final.
