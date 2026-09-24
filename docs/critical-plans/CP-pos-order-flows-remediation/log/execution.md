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
| 2026-09-22 | Bernoulli | B.1 | Proyección canónica añadida sin llamadores nuevos; ERR-33 y mensaje. Emisión diferida si tx externa. | 226c25ee6; table-sessions.service.spec.ts 44/44 |
| 2026-09-22 | Tesla | J.1 | Modal de cliente movido después de los diálogos de pago, sin cambiar z-index. Playwright pendiente. | 08d53167d; watcher FE OK |
| 2026-09-22 | Heisenberg | B.2 | POS y split delegan proyección canónica en tx; emisión post-commit. Webhook/flow-pay siguen en ejecución. | 5848a2a24; 106 tests |
| 2026-09-22 | Mencius | B.3 | SSE de staff, snapshots y página muestran mesa pagada; tile pendiente. | 1316bfae5; 47 tests |
| 2026-09-22 | Rawls | E.3 | Creación persiste delivery_type/channel con defaults explícitos. | 91575a2c7; 75 tests |
| 2026-09-22 | Bohr | C.4 | KDS distingue ENVÍO/PARA LLEVAR por delivery_type sin tocar is_takeaway. | 37005e554; 30 tests |
| 2026-09-23 | Fabio | C.4 | Tickets QA del día #103-106: REST/SSE y UI tablero/modal distinguen home/direct/dine-in; cancelados sin inventario. Paso cerrado. | evidence/C4-current-day-full-matrix-20260923.md |
| 2026-09-22 | Kepler | F.1 | Dirección primaria exige cliente y unset se limita a su user_id. Datos históricos no reparados. | 5a97f2399; 5 tests |
| 2026-09-22 | Mencius | B.3 | Tile muestra Pagada desde paid_at persistido o session_paid; no confunde pago parcial. Watch posterior y E2E pendientes. | 86138fbd5 |
| 2026-09-22 | Descartes | B.5 | Apertura devuelve estado anterior; POS avisa limpieza sin bloquear. Contrato frontend tipado. | c72634710; 640ba2bcc; 627ab494a; 48 tests |
| 2026-09-22 | Epicurus | B.2 | Webhook y flow/pay proyectan cuenta sin cerrar mesa; fallo post-commit tipado. Runtime pendiente por watcher. | 086ba3133; 113 tests |
| 2026-09-22 | Ohm | D.1 | Reversa BOM multihoja/variante cubierta; mutaciones de control pendientes por archivo compartido. | 091dab185; 90+45 tests |
| 2026-09-23 | Fabio | D.1 | Mutaciones de signo y variante pusieron el test en rojo; fuente restaurada sin diff y 168/168 verdes. Paso cerrado. | evidence/D1-mutation-controls-20260923.md |
| 2026-09-22 | Turing | B.4 | Página y tile resuelven mesero desde opener; impresión aún usaba pivote y pasó a follow-up. | 70b74852c; 52 tests |
| 2026-09-22 | Gibbs | E.1 | Editor usa direct_delivery para llevar; etiquetas corrigen pickup diferido. Excepción serializada pendiente de dueño. | 42f9bc008; 4684727a2 |
| 2026-09-23 | Bacon | B.2 | Confirmar pago manual proyecta solo cuenta saldada post-commit; reintento repara sin recobro. | 497042873; 10 tests |
| 2026-09-23 | Banach | B.4 | Tiquetes POS/cocina usan opener incluso al reimprimir sesión cerrada. Jest pendiente por carga. | 8c74f9683 |
| 2026-09-23 | Leibniz | C.3 | Errores de cocina centralizados y con copy accionable; Jest/API pendientes por carga. | 83f5e67f2 |
| 2026-09-23 | Beauvoir | E.2 | Stock de borrador se reserva bajo claim de cobro; compensación de fallos en ejecución. | 1ca4c0083 |
| 2026-09-23 | Fabio | E.2 | POS draft físico #1174 reservó al cobrar; remisión #228 entregada consumió una vez. Falta barrido global y mesa/split. | evidence/E2-home-draft-fulfillment-20260923.md |
| 2026-09-23 | Fabio | E.2 | Split del draft #1176 cobró 2 cuentas y consumió 2 unidades una sola vez; reintento sin nuevo pago. Falta mesa y barrido global. | evidence/E2-split-draft-20260923.md |
| 2026-09-23 | Fabio | E.2 | POS mesa #1177 cobró una vez y consumió una unidad; replay 409, cierre explícito. Falta barrido global. | evidence/E2-pos-table-physical-20260923.md |
| 2026-09-23 | Fabio | E.2 | Auditoría post-corte 13/13 físicos exactos, cero sin claim/reserva; specs preparados 12/12. E.2 cerrado; histórico sin backfill. | evidence/E2-postcut-stock-audit.sql/txt; 04849c73c |
| 2026-09-23 | Orquestador | I.1 | Baseline local: 10 órdenes históricas sobrepagadas; aceptación exige 0 desbordes causados por pagos posteriores al corte, no 0 histórico. | evidence/I1-overpayment-baseline.sql/txt |
| 2026-09-23 | Nash/Wegener | I.1 | Validador y flow-pay rechazan ya pagada; gateway propaga código. Orden QA1113 creada con un pago: POST 409 ORD_PAY_ALREADY_PAID_001, sigue un pago. | 25855f688; af5e566d8; evidence/I1-reject-overpay.* |
| 2026-09-23 | Orquestador | H.3 | Área fiscal LOCKED, tienda 3: POS sin mesa y mesa 13 vendieron servicio sin asignación por 50000/IVA 0; suscripción seed se habilitó temporalmente y restauró expired. | evidence/H3-active-fiscal-*; H3-local-api-verification.md |
| 2026-09-23 | Orquestador | B.2/H.3 | Tras proyección canónica, POS mesa14 taxless 201; sesión106 pagada/abierta y mesa ocupada, un pago y cero filas fiscales. | evidence/B2-pos-taxless-table.* |
| 2026-09-23 | Fabio | B.2 | Split mesa #1178: pago parcial no proyecta, último pago marca paid_at sin cerrar. Guard de origen split bajo lock bloquea edición. | evidence/B2-split-table-projection-20260923.md; 3e53d4f16 |
| 2026-09-23 | Carver/Herschel | E.4 | Detalle y backend con salidas tipadas; DELETE pagado por dueño 400 sin borrar, mesero 403 RBAC. E2E pendiente. | adf8bddd0; 26a7d7205; evidence/E4-reject-paid-delete-* |
| 2026-09-23 | E4/Fabio | E.4 | Claim fallido restaura estado; UI cancela draft y nombra platos; GET ajeno devuelve 404 real. Sigue in-progress. | evidence/E4-closeout-20260923.md |
| 2026-09-23 | Sagan/Fabio | E.4 | Clic UI mesa #26→orden #1175 cobró 200, un pago/sesión pagada; cierre UI 201. Paso E.4 cerrado; semántica de delivery queda transversal. | evidence/E4-clickpay-ui-20260923.md |
| 2026-09-23 | Hypatia | I.3 | COD mostrador deja orden/pago pendientes, saldo 10000 y 0 stock; processor genérico queda registrado. | 88235b0e2; evidence/I3-cod-counter.* |
| 2026-09-23 | Fabio | I.3 | COD domicilio deja saldo vivo y permite remisión; método POS ajeno/inexistente/omitido rechaza 400 sin orden. Paso cerrado. | evidence/I3-cod-home-20260923.md; 4ef91b0e7 |
| 2026-09-24 | fox | B.1 | Canónica 226c25ee6 verificada: spec 77/77, ERR-33 409 ambos catálogos, baseline 15; item-42 [-] boss; DB-19 [x] vivo. Cerrado. | evidence/B.1-spec.txt, B.1-baseline.txt, B.1-cero-llamadores-descartado.md |
| 2026-09-23 | toss | C.1 | Barridos DB-08/DB-23 (0 postcut) + specs; paso cerrado, ADR-06 accepted. | evidence/C.1-closeout-20260923.md |
| 2026-09-24 | mosk | A.1 | Guard adoptado done: DB-02/14 por corte (10 hist, 0 post); backend lectura + FE 44/44. | evidence/A1-db02-db14-closure-20260924.md; A1-*-regression-20260924.md |
| 2026-09-24 | toss | C.2 | Revert live #115→201 + delivered_at NULL; audit postcut 0; censo 3 carriles; F-002 fixed. | evidence/C.2-closeout-20260924.md |
| 2026-09-24 | mosk | A.3 | Guardas muertas done: mutación→10 rojo, vivo 10/10+policy 46/46; DB-37 0 filas; 2 rojos D.2 intactos. | evidence/A3-guard-specs-20260924.md; A3-db37-closure-20260924.md |
