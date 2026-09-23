# Execution Log

| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|
| 2026-09-22 | Orquestador | A.1/A.2 | Inicio paralelo en develop; plan consolidado en 0801ce82c, checkpoint/parallel-pos-orders-20260922. A.1 y A.2 con archivos disjuntos; A.3/A.4 en auditoría de solo lectura. | ADR-10; cp-lint 0 |
| 2026-09-22 | A1-pos-draft | A.1 | Backend parcial en be9015d3d y c0a50ab70; frontend espera commit de hunks ajenos en archivos compartidos. No cerrar el paso. | payments.service.spec.ts: 79/79 en esta sesión |
| 2026-09-22 | A2-dinein-gate | A.2 | Backend y UI parcial en b917b5d18 y 290067e7b; se corrigió expansión accidental de tipo en d3a63db50. Falta E2E real. | order-flow.service.spec.ts: 74/74; watch FE OK |
| 2026-09-22 | Orquestador | A.3 | Guardas backend reparadas en 1a60d333a; frontend y E2E pendientes. No cerrar el paso. | 2 suites/126 tests; error codes 409 tipados |
| 2026-09-22 | Orquestador | H.1/H.2 | Falso gate retirado en ed49e8472; settings legacy inerte y default nuevo ausente. Falta E2E POS/Mesas antes de cerrar. | payments.service.spec.ts: 75/75; backend compiló |
| 2026-09-22 | Orquestador | H.3 | Cuatro carriles API dieron 201: POS sin mesa, mesa nueva, sesión previa y Mesas. Total 10000, impuesto 0, un pago por orden. Negativos/E2E pendientes por login 429 y MCP ausente. | evidence/H3-local-api-verification.md; H3-snapshots.txt |
| 2026-09-22 | Orquestador | A.4 | Draft cancelable con estado compartido y guard de mesa abierta 409 tipado en d13ce5b79; lectura de política usa sesiones existentes. API/E2E pendientes. | 2 suites/129 tests; watch frontend OK; backend health 200 |
| 2026-09-22 | Orquestador | H.3/A.4 | Negativos H.3: 400 cantidad, 404 mesa ajena, 409 doble cobro. A.4: draft QA cancelado 200; draft con mesa abierta bloqueado 409. E2E pendiente. | evidence/H3-local-api-verification.md; A4-local-api-verification.md |
| 2026-09-22 | Orquestador | H.3 | Regresión de línea histórica gravada: el cierre de mesa conserva snapshot persistido y total 11900 aunque el catálogo nuevo carezca de impuesto. | c5a4e09c1; payments.service.spec.ts 76/76 |
| 2026-09-22 | Orquestador | H.3 | API local: categoría 0 %, IVA 19 % y mixto en POS sin mesa; mixto en mesa 12. Todos 201, tasas persistidas correctas, un pago por orden. | evidence/H3-tax-matrix.sql/txt; H3-local-api-verification.md |
