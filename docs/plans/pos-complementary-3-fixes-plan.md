# POS — tres correcciones complementarias y preparación del split integral

## Context
El usuario autorizó «haz el plan e implementalo con pruebas y todo y subelo a develop origin usando parallel» sobre la selección de tres fixes aislados y preparación paralela de F-006. Otra sesión ejecuta `docs/plans/pos-money-8-fixes-plan.md` en este mismo árbol; sus archivos y cambios sin commit son de solo lectura. Esta tanda implementa los tres P1 descritos abajo y entrega el diseño de F-006, sin declarar que el split completo está implementado ni integrar parcialmente un modelo financiero nuevo. Al inicio, `develop@8b854c856` divergía de `origin/develop@7297fe6dc` (3 commits locales, 11 remotos). Resuelto antes del código: la otra sesión commiteó en `9b9e07b4d`, el árbol estaba limpio al gate y el orquestador integró remoto con merge `ab2aa5f91d13bd8748d75b757757ae231fd69337`, checkpoint `checkpoint/parallel-pos-complementary-20260920`, sin reescritura.

## General Objective
Impedir devoluciones contables ficticias, reembolsos duplicados dentro de una solicitud y transiciones masivas fuera de contrato, publicando cambios verificados sin interferir con el trabajo concurrente.

## Specific Objectives
1. La reversión automática de pasarela fallida o pendiente no emite `refund.completed`; una completada sí conserva el evento y su payload.
2. Preview y creación de refund rechazan `order_item_id` duplicados antes de efectos; la devolución completa se determina por cobertura de cada línea, no sumando cantidades de productos diferentes.
3. `bulk/transition` y `bulk/transition/preview` aceptan únicamente `finished`, `shipped`, `delivered`, `cancelled` como destinos; el resto falla en validación antes del servicio.
4. Cada defecto cuenta con evidencia rojo→verde y casos Happy/Sad/Brute; las verificaciones HTTP locales y los límites de pruebas de pasarela quedan registrados honestamente.
5. Commits propios delimitados, memoria sincronizada y push fast-forward por SHA revisado a `origin/develop`, sin force ni reescritura de historia.
6. Diseño separado de F-006 preserva tres reglas confirmadas: corrección integral, cuentas independientes cobrables/facturables a su nombre y división únicamente del saldo pendiente, conservando abonos originales.

## Approach Chosen
Tres unidades de edición disjuntas bajo `parallel`, con una lista cerrada de archivos por ejecutor. Las pruebas Jest pesadas se serializan por autorización del orquestador; no se levantan builds, no se reinician servidores compartidos y no se ejecutan seeds/reset. La integración y el push pertenecen al orquestador, que relee HEAD e índice antes de cada operación. Antes de cada primera prueba se comprueban health y logs; antes del commit protector se verifican los logs del rebuild propio. La autorización del usuario cubre esta secuencia de implementación/pruebas/publicación. El usuario pidió no pausar la otra sesión: sincronización realizada únicamente tras comprobar árbol/índice y ausencia de solapes, sin alterar su trabajo.

El diseño integral de F-006 se prepara como documento separado porque necesita representar participaciones financieras sin duplicar cantidades físicas, cocina ni cobros. Su integración depende de archivos de pagos/facturación reservados por la otra sesión y de aprobar el esquema aditivo y el contrato fiscal; no se sustituye por bloquear el split ni por repartir abonos proporcionalmente, ambas alternativas rechazadas por el usuario.

## Alternatives Considered
- Cambiar `max_refundable` a `max(grand_total,total_paid)`: rechazado; el DTO no modela restitución de sobrepagos y esa fórmula no limita una venta parcialmente pagada al dinero efectivamente recibido.
- Quitar `delivered→processing` del mapa global: rechazado; no cierra el escritor forzado, afectaría KDS legítimo y requiere archivos reservados. Esta tanda cierra el contrato HTTP bulk, no F-016 global.
- Prorratear dos campos del split y declararlo resuelto: rechazado; los importes equal/custom se ignoran, existen pagos previos y cantidades físicas enteras. Sería una corrección incompleta.
- Ejecutar tres Jest/builds a la vez o hacer push del tip sin verificar: rechazado por presión de memoria y árbol/HEAD compartidos.

## Critical Files
- `apps/backend/src/domains/store/orders/order-flow/services/refund-flow.service.ts` — unidad A, condición de emisión automática.
- `apps/backend/src/domains/store/orders/order-flow/services/refund-flow.service.spec.ts` — unidad A, regresión existente y matriz de pasarela.
- `apps/backend/src/domains/store/orders/order-flow/services/refund-calculation.service.ts` — unidad B, integridad por línea.
- `apps/backend/src/domains/store/orders/order-flow/dto/create-refund.dto.ts` — unidad B, unicidad de entrada.
- `apps/backend/src/domains/store/orders/order-flow/services/refund-calculation.service.spec.ts` — unidad B, nuevo spec con cálculo real.
- `apps/backend/src/domains/store/orders/order-flow/dto/create-refund.dto.spec.ts` — unidad B, nuevo spec del ValidationPipe.
- `apps/backend/src/domains/store/orders/order-flow/services/refund-integrity.service.spec.ts` — unidad B, nuevo spec integrando cálculo y flujo con dependencias externas simuladas, sin editar el spec de A.
- `apps/backend/src/domains/store/orders/dto/bulk-orders.dto.ts` — unidad C, lista única de estados.
- `apps/backend/src/domains/store/orders/dto/bulk-orders.dto.spec.ts` — unidad C, nuevo spec de matriz de destinos.
- `apps/backend/src/domains/store/orders/orders-bulk.controller.spec.ts` — unidad C, nuevo spec de frontera HTTP/pipe para ambos handlers.
- `docs/plans/pos-complementary-3-fixes-plan.md` — orquestador, plan y evidencia resumida de ejecución.
- `docs/plans/pos-split-financial-rebuild-plan.md` — orquestador, diseño siguiente F-006, no implementación de esta tanda.

## Reusable Assets
- `apps/backend/src/common/errors/error-codes.ts` — `REF_VALIDATE_001` existente; solo lectura, NO añadir códigos en este archivo reservado.
- `apps/backend/src/common/errors/vendix-http.exception.ts` — errores de negocio tipados.
- `apps/backend/src/main.ts` — configuración real de ValidationPipe y normalización de mensajes; solo lectura.
- `apps/backend/src/common/filters/http-exception.filter.ts` — contrato de error; verificar HTTP/código real sin asumir que es 422.
- `apps/backend/src/testing/prisma-mock.ts` y `apps/backend/src/testing/money-fixtures.ts` — andamiaje de la otra sesión ya commiteado, solo lectura; no convertir el mock en un cálculo paralelo al real.
- `apps/backend/src/domains/store/orders/orders-bulk.service.spec.ts` — regresiones existentes para destinos válidos, solo lectura.
- `apps/backend/src/domains/store/orders/order-flow/services/refund-flow.service.ts` — resolución manual ya exige `completed`; replicar la misma condición de éxito, no otra máquina de estados.
- `apps/backend/src/common/money-kernel/index.ts` — precisión monetaria para diseño del split, no editar en estos fixes.
- `apps/frontend/src/app/shared/` y `libs/shared-types/` — inventario consultado; no se necesitan nuevos componentes ni tipos cross-app para estos tres cambios backend.

## Steps
1. Sincronizar y delimitar el árbol compartido.
   Skills: parallel, git-workflow, vendix-engram, vendix-known-errors
   Resources: `git fetch origin develop`; `git status --short`; `git rev-list --left-right --count HEAD...origin/develop`; `./scripts/engram-import.sh`; `git rev-parse HEAD`.
   Business decision: no perder ni publicar inadvertidamente trabajo ajeno; ninguna edición de fuente sobre una base desactualizada.
   Why: condición previa a los ejecutores y a cualquier push; ya se pidió al usuario una ventana de coordinación con la otra sesión.
   Output: base que contiene `origin/develop`, SHA de checkpoint registrado y scopes A/B/C sin diff ajeno. No rebase/reset/stash/restores. Si sincronizar requiere merge, lo hace solo el orquestador con árbol protegido y coordinación previa.
   Verification: `git merge-base --is-ancestor origin/develop HEAD` retorna 0; `git diff --name-only` y `git diff --cached --name-only` muestran propiedad conocida; checkpoint registrado antes del fan-out.

2. Unidad A — no declarar éxito contable cuando la reversión falla.
   Skills: parallel, how-to-dev, vendix-backend, vendix-auto-entries, vendix-accounting-rules, vendix-error-handling, buildcheck-dev, vendix-known-errors
   Resources: `cd apps/backend && npm run test:path -- src/domains/store/orders/order-flow/services/refund-flow.service.spec.ts`.
   Business decision: `refund.completed` describe devolución completada, no cualquier estado terminal. Fallos y pendientes no producen ese evento; éxito/no-gateway conserva comportamiento.
   Why: acotado a una condición y su contrato de eventos; no requiere modificar pasarela, contabilidad ni la máquina de estados propiedad de la otra sesión.
   Output: solo los dos archivos A; prueba existente de failed corregida primero para demostrar rojo, luego lógica y comentarios coherentes.
   Verification: Happy éxito emite exactamente una vez; Sad failed/throw/pending no emiten; Brute matriz de resultados y resolución manual. Registrar conteos y exit reales de la suite roja y verde, sin filtros que omitan tests.

3. Unidad B — integridad de cantidades de refund por línea.
   Skills: parallel, how-to-dev, vendix-backend, vendix-backend-api, vendix-validation, vendix-error-handling, vendix-prisma-scopes, vendix-inventory-stock, buildcheck-dev, vendix-known-errors
   Resources: `cd apps/backend && npm run test:path -- src/domains/store/orders/order-flow/services/refund-calculation.service.spec.ts`; `npm run test:path -- src/domains/store/orders/order-flow/dto/create-refund.dto.spec.ts`; `npm run test:path -- src/domains/store/orders/order-flow/services/refund-integrity.service.spec.ts` (cada uno desde apps/backend, secuenciales).
   Business decision: un ID de línea aparece una vez por solicitud; duplicados se rechazan, no se fusionan silenciosamente con destinos/acciones diferentes. Completa requiere cubrir cantidades de cada línea; no alterar aquí tope monetario, política de propina/envío ni reservas de solicitudes concurrentes.
   Why: evita duplicación de dinero/stock en un único request sin tocar archivos de A o los del plan concurrente.
   Output: DTO con unicidad, guarda defensiva en cálculo para callers internos, comprobación por línea y los tres specs propios. Reusar REF_VALIDATE_001. No endurecer campos ajenos al defecto sin demostrar su contrato actual.
   Verification: Happy parcial/completa/acumuladas válidas; Sad duplicados/cantidades inválidas/ítem ajeno; Brute orden A1=10/B1=1000 con request A1,A1, destinos contradictorios y rechazo antes de persistir refund, reponer stock, actualizar orden/pagos o emitir. Cálculo real, no mockear el resultado que se intenta probar.

4. Unidad C — limitar estados bulk al contrato publicado.
   Skills: parallel, how-to-dev, vendix-backend-api, vendix-validation, vendix-bulk-operations, vendix-permissions, vendix-error-handling, buildcheck-dev, vendix-known-errors
   Resources: `cd apps/backend && npm run test:path -- src/domains/store/orders/dto/bulk-orders.dto.spec.ts`; `npm run test:path -- src/domains/store/orders/orders-bulk.controller.spec.ts`; `npm run test:path -- src/domains/store/orders/orders-bulk.service.spec.ts` (desde apps/backend, secuenciales).
   Business decision: destinos bulk son exclusivamente finished/shipped/delivered/cancelled. Conservar permiso, tope actual 300, motivo y respuesta parcial. La skill bulk menciona 100 pero el contrato actual documenta 300; NO regresarlo en este fix.
   Why: cierra exposición HTTP fuera de contrato sin alterar `forceOrderState`, PATCH individual ni KDS.
   Output: constante única para tipo y validación; pruebas DTO/pipe y ambos handlers sin cambios de controlador productivo.
   Verification: Happy cuatro estados aceptados; Sad todos los estados Prisma restantes/desconocidos/ausentes rechazados; Brute matriz por transition y preview con comprobación de cero llamadas a servicios para inválidos. Prueba HTTP mediante app Nest con ValidationPipe y AllExceptionsFilter reales: 400 y SYS_VALIDATION_001, no invocación directa de handlers ni 200 parcial. Los errores DTO de refund también son SYS_VALIDATION_001; REF_VALIDATE_001 pertenece solo a la guarda defensiva del servicio.

5. Integrar, verificar contratos locales y revisar.
   Skills: parallel, how-to-test, buildcheck-dev, vendix-known-errors, pr-code-review, vendix-backend-auth, vendix-permissions
   Resources: `docker logs --since 5m vendix_backend`; `curl -fsS http://localhost:3000/api/health`; `curl -sk https://api.vendix.com/api/auth/login -H 'Content-Type: application/json' --data @<credencial-local-no-versionada>`; `curl -sk -w '\nHTTP_STATUS=%{http_code}\n' -X POST https://api.vendix.com/api/store/orders/bulk/transition/preview -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"ids":[2147483647],"targetState":"refunded"}'`; las siete suites nuevas/modificadas/existentes anteriores, una por invocación.
   Business decision: no probar dinero real ni invocar una reversión real Wompi para simular fallos. Usar fixtures exclusivamente locales y servicios reales con pasarela simulada en integración; declarar límites de runtime.
   Why: dos unidades comparten carril refund semántico aunque no archivos; se prueban juntas tras integrar todos los commits.
   Output: evidencia de Happy/Sad/Brute en specs, HTTP de DTOs/auth en dev, logs de backend, revisión sin bloqueadores y alcance de pruebas remotas explícitamente no ejecutado.
   Verification: health 200, sin errores recientes relevantes; todos los specs con N>0 y sin omitidos. Sin token rechaza, token sin permiso rechaza, destino inválido no muta. Un gateway failed se verifica en integración con inyección controlada, no se anuncia como E2E real de Wompi.

6. Preparar F-006 integral sin publicar implementación parcial.
   Skills: vendix-business-analysis, vendix-restaurant-ops, vendix-calculated-pricing, vendix-tax-typing, vendix-fiscal-scope, vendix-inventory-stock, vendix-prisma-schema, vendix-prisma-migrations, parallel
   Resources: `docs/plans/pos-money-8-fixes-plan.md`; `apps/backend/prisma/schema.prisma`; `rg -n 'split|payment|invoice' apps/backend/src/domains/store/tables/split-order.service.ts`.
   Business decision: repartir solo saldo pendiente en cuentas independientes; abonos permanecen trazables, nunca nuevos cobros ni prorrateo retroactivo. Operación de cocina/inventario sucede una sola vez. Definir tratamiento del documento por la porción ya pagada y de edición posterior antes de integrar.
   Why: el usuario exige solución completa; un parche local de totales no cumple. Pagos/fiscal están ocupados y la implementación requiere un alcance nuevo explícito.
   Output: `docs/plans/pos-split-financial-rebuild-plan.md` con diseño, barrera de integración y decisiones abiertas, sin esquema/app/migración ejecutados en esta tanda.
   Verification: documento refleja las tres respuestas literales del usuario, explicita modelo financiero separado y dependencias, y no marca F-006 como resuelto.

7. Proteger commits y publicar a origin/develop.
   Skills: parallel, git-workflow, vendix-engram, vendix-known-errors
   Resources: `git diff --check`; `git diff --cached --name-only`; `git log --oneline <checkpoint>..HEAD`; `./scripts/engram-sync.sh vendix`; `git push origin <sha-revisado>:develop`; `git ls-remote origin refs/heads/develop`; `gh run list --commit "$SHA" --limit 5`; `gh run watch "$RUN_ID" --exit-status`.
   Business decision: cada commit incluye solo rutas propias explícitas, nunca add -A ni add .; no empujar commits concurrentes no revisados ni reescribir un tip remoto divergente.
   Why: último paso porque publicar exige evidencia del estado exacto. Commits protectores de cada unidad ocurren antes, apenas su verificación asignada pase.
   Output: commits propios, memoria versionada por rutas explícitas, SHA remoto confirmado y estado CI reportado.
   Verification: HEAD coincide con SHA revisado inmediatamente antes del push; origin/develop es ancestro; push sin force exitoso y ls-remote coincide. Si HEAD cambia, releer/revisar o parar; si hay commits ajenos, revisar su alcance y no atribuirlos a esta tanda.

## End-to-End Verification
1. Regresiones rojo→verde de cada unidad, además de corrida final secuencial de DTO bulk, controller bulk, service bulk, DTO refund, cálculo refund, integridad refund y flujo refund. Conservar comandos, timestamps y conteos; no tsc/ng build.
2. `curl` contra `https://api.vendix.com/api` para ambos endpoints bulk y preview/creación refund: casos válidos con fixture local, inválidos y matriz de entradas repetidas; consultar antes/después para demostrar cero cambios al rechazo. No usar IDs de clientes reales ni datos de producción.
3. Pasarela fallida/pendiente/completada: integración del servicio real con provider mock y event emitter verificado. Es prueba de integración local, no afirmación de devolución bancaria real. Si falta un fixture autorizado para un caso live, declarar ese caso pendiente sin sustituirlo por un health 200.
4. `docker logs --since 5m vendix_backend` y `/api/health` limpios después de la última edición. No reiniciar servidores ajenos ni lanzar builds para verificar.
5. Revisión del diff final por unidad y juntos; `git diff --check`; push por SHA y seguimiento de CI hasta resultado o bloqueo externo explícito.

## Knowledge Gaps
- Sincronización inicial resuelta con merge `ab2aa5f91`; revalidar ancestro remoto y estado compartido antes del push, sin asumir que HEAD permanece quieto.
- F-004 original (tope/sobrepagos), carrera entre refunds simultáneos/en curso y estados anticipados de orden/pagos quedan fuera de estos fixes. No reportarlos cerrados.
- F-016 global/forzado y G3/F-017 quedan fuera; G3 requiere vigilancia G2 y 30 días, no se enciende aquí.
- F-006 necesita contrato del documento por porción ya pagada, edición post-split, representación financiera y esquema aditivo revisado; su implementación es siguiente etapa coordinada, no parche implícito de esta tanda.
- El entorno fiscal/pasarela local no se presume sandbox configurado: no ejecutar cobros/reversas reales para satisfacer una casilla de prueba.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.

Autorización de la secuencia recibida el 2026-09-20: «Claro haz el plan e implementalo con pruebas y todo y subelo a develop origin usando $parallel». Gate inicial completado y ejecución habilitada sobre checkpoint `ab2aa5f91`; cualquier ampliación a implementación/migración F-006 requiere su propio plan y coordinación.
