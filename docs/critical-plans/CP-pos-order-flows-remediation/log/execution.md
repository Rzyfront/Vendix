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
| 2026-09-24 | fox | B.2 | Verificación-only: 4 escritores+2 confirms delegan; live #1133 200, ERR-33/05 409 tipados; specs 118+27+146/148. Cerrado. | evidence/B.2-cutover-verification-20260924.md |
| 2026-09-24 | loks | E.1 | Llevar=direct_delivery 9/10: enum 3 cajones, labels F-011 unificadas, specs 42+30+9+24, editor PUT 200, DB-05 0 implicit, DB-10 f1021/t32, serial pre-cobro OK. E2E boss. | evidence/E.1-SA1-*, E.1-SA2-*, E.1-SA3-*, E.1-pos-directo.json, E.1-regression-* |
| 2026-09-24 | fox | B.3 | Legacy 33 clasificadas, 0 post-corte, sin backfill; snapshot live #1059 paid. Cerrado. | evidence/B3-legacy-paid-at-decision-20260924.md; B.3-sse.txt |
| 2026-09-24 | loks | E.5 | Freno envío-sin-método 9/10: UX copy 3 códigos (spec 23/23), gate+mensajes ES verificados (backend OOM→lectura A.1), huérfanas 0. FB-19 trim 395. DB-07 abierto→F.2. | evidence/E.5-SA1-*, E.5-SA2-*, E5-* |
| 2026-09-24 | fox | G.1 | Guard ABIERTA + util 107/107+19/19; live PUT cerrada 409, abierta 200; barrido #1192. Cerrado. | evidence/G1-guard-live-20260924.md |
| 2026-09-24 | fox | G.2 | Reasignar live #1189→27 201, KDS re-estampado, rechazos 409×5/404/400; spec 77/77. Cerrado. | evidence/G2-reassign-fox-20260924.md |
| 2026-09-24 | loks | E.6 | Propina bruta unificada 10/10 done: retail curl 2000 = flow curl 2000, mesa por-código, spec tabla 3/3, tip 7/7 en total/fuera subtotal, DB-02 10 legacy sin tip 0 post. | evidence/E.6-SA1-*, E.6-SA2-* |
| 2026-09-24 | boss | — | Colas: fox=D.4→F.2→F.3→D.3 (owners puestos; msg directo limitado, leer bundle); A.4=mosk (cierre suyo; loks= E.1/E.5/F.1, no tocar A.4); toss=C.3→D.2; mosk=A.4→I.2/I.4/I.5/I.6. HALT login-E2E sigue. | — |
| 2026-09-24 | boss | D.2 | DB-11 huérfano (fox G.2 dejó [ ] con mitad-reasignar; ningún step-D lo tenía) → asignado a D.2 (reversa toca inventory_consumed_at_fire). toss: voltear con evidencia reversa. ERR-42 reuse→D.4/D.3 (fox) ya en contratos. | — |
| 2026-09-24 | boss | — | PASS A.4+F.1; ledger 26/38 fase A ✅. Adopción-gap→I.6. E.5 espera F.2. Carve-out→dueño. loks reserva. | — |
| 2026-09-24 | mosk | A.4 | Borrador cancelable done 16/16: runtime 7/7 QA#1196-1198; OrdersService 107/107; race SKIP. DB-01→I.4, ERR-38→I.2. | evidence/A4-runtime-matrix-20260924.md; A4-backend-specs-20260924.md |
| 2026-09-24 | loks | F.1 | Mina is_primary done 13/13: spec OOM→lectura, DB-26 delta 0 nuevas (8 legacy+45 org), t10=11, UX copy OK. Adopción gap sin owner. | evidence/F.1-SA1-db26.txt, F1-* |
| 2026-09-24 | toss | D.2 | Reuse neto 0 + waste DR5295/CR6135 (skip-row); specs 149/149+29/29; ítem 9 gate release. | evidence/D.2-closeout-20260924.md |
| 2026-09-24 | boss | D.2 | RULING ítem 9 [ ] = gate release main. D.2 PASS 8/9. DB-11→toss D.3. D.3→toss; fox=D.4/F.2/F.3. | — |
| 2026-09-24 | boss | D.3 | Probe resend #1188: 500+500 → F-008. E2E C.3 OK: S2b API 409, UI N/A. ERR-12 N/A; raza→I.6. F-009→I.6. | evidence/D.3-resend-boss-20260924.md |
| 2026-09-24 | boss | D.3 | F-008 no es QUI-762: HEAD ok, cancelled_at lo mete el WIP D.3 (toss, su fix). Árbol: 11 M, staging selectivo. | — |
| 2026-09-24 | boss | D.4 | toss-block: (1) mosk commitea ADR-12+I.2 verde 1º, toss rebasea D.4-tip después. (2) resend=F-008 tu WIP, fix+re-probe boss. (3) SQL UPDATE own-fixtures dev OK doc. | — |
| 2026-09-24 | boss | D.4 | D.4→toss (ya trae tip-hunks+FE; evita colisión). fox=F.2→F.3. mosk I.2-logic OK (staging selectivo); specs f2→tras F-008 toss. G.2-visual PASS runner-2 (#30/#31). | evidence/G2-recorrido-runner2-20260924.md |
| 2026-09-24 | boss | D.3 | Re-probe remake: 201 ticket#126 + replay 422 NOT_RESENDABLE ✅ ítem 3. RULINGS: FB-28→D.4 mesa-live (D.3 cierra estructural); F-007 registry→400 en D.4. toss: flip FB-30/40 ERR-17 F-003/008. | evidence/D.3-remake.json |
| 2026-09-24 | boss | E.1 | E2E 4 carriles PASS runner-2 (4/4 direct_delivery, DB-05 0 implícitas, DB-10 inv, 0 JS). Ítem 10/10 cerrado. loks: volcar step+log+commit. | evidence/E.1-lanes-runner2-20260924.md |
| 2026-09-24 | boss | B.3 | Re-verify session_paid PASS runner-2 (#134 Pagada live+snapshot, whitelist OK, 0 JS). Batch-2 E2E 3/3. Runner-2b duplicado cancelado (interfería). | evidence/B3-reverify-runner2-20260924.md |
| 2026-09-24 | boss | — | Cleanup 2b: sesiones #133/#135 cerradas (201), mesas #32/#33→cleaning, 0 abiertas. #1223 finished. | — |
| 2026-09-24 | boss | F.2 | fox sin actividad en cola nueva (F.2 intacto desde 09-23) → F.2/F.3 a loks (E.5 se desbloquea solo). fox→reserva/gates. loks: E.1-cierre + F.2→F.3→E.5. | — |
| 2026-09-24 | loks | E.1 | Cierre 10/10 done: volcado E2E boss runner-2 4/4 direct_delivery (L1-L4), DB-05 0 implícitas, DB-10 inv. | evidence/E.1-lanes-runner2-20260924.md |
| 2026-09-24 | toss | D.3 | Cierre 10/10 done: vocabulario único + remake single-fire + F-008; re-probe boss 201+422; FB-25/26/29/30/40 DB-09 ERR-17 F-003/008. FB-28→D.4. | evidence/D.3-closeout-20260924.md |
| 2026-09-24 | toss | C.3 | Cierre 10/10 done: ajuste §422 N/A-por-diseño (S1/survey/S2b boss + curl); ERR-07/08/09/10/11/12/13 FB-35. Ticket#5=fixture. Deuda: S2-mesa/raza, FB-41 force-take. | evidence/C.3-closeout-20260924.md |
| 2026-09-24 | toss | D.4 | Cierre 11/12 done: tip % re-deriva + fija intacta live; FB-28 curl = detalle; cobrada 409+reembolso; F-001/F-007. Ítem 9 E2E→boss runner-4. 14 cancelOrder rojos=specs-f2 mosk. | evidence/D.4-closeout-20260924.md |
| 2026-09-24 | loks | F.2 | Alias+envío done 11/11: gates 0, spec 24/24, #1226 201 FK#540+snap, fail delta 0, DB-06 0, DB-07 0 nuevas, DB-25 ref, selector OK, ERR-25 OK. UI E2E→boss. | evidence/F.2-SA1-*, F.2-SA2-*, F.2-SA3-* |
| 2026-09-24 | boss | D.3 | PASS D.3 10/10 (f0904f5da). NOTA: commit barrió flips+log F.2 loks (contenido OK); loks commitea step+evin+ERR-25. Ojo staging selectivo. F.2-UI E2E→mi backlog. | — |
| 2026-09-24 | boss | D.4 | Mesas QA #35/#36 para toss (FB-28 mesa-live curl). Preview-UI+E2E modal→runner-4 cuando avise. | — |
| 2026-09-24 | loks | F.3 | Alias visible done 11/11: #231 201 nombre+dir, by-order OK, patch intacto, pool OK, DB-35 0, stop#129 coords, no-rewrite 0. | evidence/F.3-SA1-*, F.3-SA2-*, F.3-route/map-stops |
| 2026-09-24 | boss | — | PASS C.3 10/10 + F.3 11/11. C.3-code cabalga D.4 (mismo autor). Deudas C.3 (FB-41, S2-mesa/raza)→I.6. | — |
| 2026-09-24 | boss | E.5 | PASS E.5 10/10 (2fcb0dc31, DB-07/ERR-21 vía F.2/F.3). UI± parcial → E.5-UI POS (botón bloqueado+razón→cobrar→remisión) a mi backlog E2E (runner-4 con D.4-modal). | — |
| 2026-09-24 | loks | E.5 | Cierre 10/10 done: DB-07 0 nuevas (F.2 #1226 FK+snap), ERR-21 no dispara (F.3 #231 201). Autodesbloqueo propio. | evidence/F.2-SA*, F.3-SA1-* |
| 2026-09-24 | boss | D.4 | PASS D.4 11/12 (1a2dd8b0b, fase D completa 4/4, 34/38). Ítem 9 E2E modal→runner-4. Obs toss mesa-cancel sin audit vs detalle-con-audit→mosk I.5. |
| 2026-09-24 | boss | D.4 | Verificación indep: specs D.4 3/3 ✓. 14 rojos cancelOrder (egreso caja + kitchenDisposition) = mocks ADR-12 mosk, fuera de D.4 → derivado a mosk. |
| 2026-09-24 | boss | F.2-UI | E2E Roku PASS: orden #1233 alias+envío, huérfana #543, snapshot+coords, detalle OK, 20 png. Playwright MCP caído→fallback playwright-core. 403 uvt-threshold preexistente→triage I.6. #1233 queda processing (disposición pendiente). |
| 2026-09-24 | boss | E.5-UI | E2E Roku PASS: bloqueo sin método (razón+disabled, 0 POST) → venta #1236 → remisión #232 draft, orden shipped, 20 png. NG0100 ×5 recibo→I.6. |
| 2026-09-24 | boss | D.4 | Ítem 9 E2E Roku PASS: modal teclado (Tab trap+Escape) + no tapado en detalle #1189 y mesa #36; preview detalle, nota mesa por diseño. D.4 12/12. 9 png. |
| 2026-09-24 | boss | gate-D | Fix 14 rojos cancelOrder (mocks invoices/CxC/recordCancellationPendingRefunds): 152/152 verde. Desbloquea CI backend-test-scoped para release. |
