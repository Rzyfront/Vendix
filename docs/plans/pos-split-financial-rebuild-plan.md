# F-006 — reparto financiero integral (ejecución autorizada)

## Context
El usuario confirmó corrección completa, cuentas independientes cobrables/facturables a su nombre y división SOLO del saldo pendiente, conservando los abonos; reiteró «Implementalo pues». Esta etapa implementa F-006, no otro documento preparatorio. Se trabaja en develop con parallel y archivos exclusivos; la otra sesión modifica cancelación/webhook/notas crédito, por lo que sus diffs no se pisan. La fuente permanece como única orden operativa: las cuentas serán entidades financieras propias, no copias de mercancía ni nuevas órdenes comerciales que dupliquen ventas.

## General Objective
Repartir exactamente el saldo pendiente en cuentas individuales que puedan cobrarse y facturarse, sin redistribuir pagos anteriores, duplicar ingreso, inventario o cocina.

## Specific Objectives
1. Equal/custom/by-items conservan cada componente y cada importe objetivo al centavo; sum(cuentas nuevas)=saldo pendiente.
2. Los payments previos conservan sus IDs, order_id, importes y contabilización; una porción informativa paid_original representa lo ya abonado sin mover esos pagos.
3. Una sola orden conserva todos los ítems físicos, reservas, cocina y entrega. Dividir no consume ni libera inventario y no cancela la fuente.
4. Cada cuenta tiene cliente/alias, pagos propios referenciados al mismo order_id fuente y factura propia con referencia financiera explícita.
5. Versionado, idempotencia y locks evitan doble reparto y sobrecobro por solicitudes simultáneas, incluso frente a otros carriles de pago.
6. UI visible y recuperable desde POS, mesa y detalle de orden; muestra abonos, saldo, cuentas y acciones de cobro/facturación.
7. Happy/Sad/Brute verifican algoritmo, API real local, UI, persistencia, límites fiscales y ausencia de efectos físicos duplicados.

## Approach Chosen
Crear un ledger tipado con grupo, cuentas, líneas financieras e impuestos por línea. Cada cuenta referencia la orden fuente, pero NO es una nueva orders: esto conserva las consultas comerciales y de inventario existentes sin duplicar cantidades/ingresos. Nuevos payments siguen perteneciendo a la fuente y añaden FK a su cuenta; sus saldos se derivan de los estados reales de pagos. Las invoices añaden FK de cuenta y la protección contra duplicidad pasa a ser por cuenta cuando corresponde; la factura global de una fuente repartida se rechaza.

La representación fiscal es explícitamente una participación financiera por línea fuente: cantidad 1 de participación y precios/importes de esa participación, con descripción y referencia al producto/cantidad/precio originales, sin crear productos genéricos ni modificar catálogo o mercancía. Se reutilizan validadores fiscales y el mapper existente mediante una proyección dedicada; no se salta ninguna validación ni se afirma aceptación DIAN sin pruebas.

Decisiones conservadoras de integridad: bloquear split de una fuente con documento fiscal vigente (incluye draft, excluye cancelled/voided), pagos pendientes/autorizados o devoluciones existentes; no anular documentos automáticamente. Tras confirmar se congelan los importes de la fuente y de las cuentas; la cocina/entrega siguen operando. Se puede cancelar el grupo completo antes de nuevos pagos/documentos para volver a editar, manteniendo abonos originales. El titular se modifica por carril específico antes de pagos/documentos. No se cierra automáticamente la mesa: se marca paid_at al saldar todo, conservando el cierre manual actual.

## Alternatives Considered
- Copiar líneas enteras a subórdenes: no permite equal/custom exactos ni conserva pagos y duplica operación física.
- Cambiar cantidad física Int o reutilizar sale_quantity_snapshot como ratio: rompe el contrato de UoM/stock.
- Nuevas orders financieras más filtros en todos los reportes: añade riesgo de doble ingreso y obliga a modificar demasiados consumidores operativos. Cuentas propias enlazadas a la única fuente evitan ese problema.
- Factura única con varios pagos o repartir total+abonos: ambas descartadas explícitamente por el usuario.
- Hamilton independiente por componente: conserva filas, pero puede incumplir el importe de una cuenta. Usar una matriz determinista con márgenes por fila y columna.
- Esperar a que toda la otra sesión termine: rechazado; se implementan unidades disjuntas y solo se serializa el acceso a archivos realmente compartidos.

## Critical Files
- `apps/backend/prisma/schema.prisma` — cuatro modelos, referencias de cuenta en pagos/facturas y marcador activo de fuente.
- `apps/backend/prisma/migrations/20260920063000_order_financial_splits/migration.sql` — esquema aditivo, índices y guardas de integridad.
- `apps/backend/src/prisma/services/store-prisma.service.ts` — scope modelos nuevos.
- `apps/backend/src/common/errors/error-codes.ts` — errores split específicos, propiedad del orquestador.
- `apps/backend/src/domains/store/tables/utils/split-allocation.util.ts` — algoritmo puro nuevo.
- `apps/backend/src/domains/store/tables/utils/split-allocation.util.spec.ts` — conservación de matrices.
- `apps/backend/src/domains/store/tables/split-order.service.ts` — preview, confirmación, consulta, clientes, cancelación segura.
- `apps/backend/src/domains/store/tables/split-order.service.spec.ts` — regresiones de ledger.
- `apps/backend/src/domains/store/tables/split-order.controller.ts` — endpoints del grupo/cuentas.
- `apps/backend/src/domains/store/tables/dto/split-order.dto.ts` — contratos de preview/versión/idempotencia/titulares/pago.
- `apps/backend/src/domains/store/tables/split-account-payment.service.ts` — cobro sobre cuenta, sin copiar pagos.
- `apps/backend/src/domains/store/tables/split-account-payment.service.spec.ts` — idempotencia y efectos.
- `apps/backend/src/domains/store/tables/tables.module.ts` — wiring servicios nuevos.
- `apps/backend/src/domains/store/orders/shared/financial-split-policy.ts` — política de congelamiento reutilizable.
- `apps/backend/src/domains/store/orders/orders.service.ts` — impedir edición económica/borrado de fuente repartida y exponer vínculo.
- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — conservar operación física y proteger edición económica.
- `apps/backend/src/domains/ecommerce/tables/ecommerce-tables.service.ts` — impedir cobro/edición global que omita cuentas.
- `apps/backend/src/domains/store/payments/services/payment-gateway.service.ts` — procesamiento de pago reservado server-side.
- `apps/backend/src/domains/store/payments/services/payment-validator.service.ts` — validación de raíz/cuenta y exclusión de la propia reserva.
- `apps/backend/src/domains/store/payments/interfaces/payment-processor.interface.ts` — vínculo server-only, nunca bandera metadata del cliente.
- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — guardas de cobro/cancelación global; esperar commit ajeno antes de editar regiones asignadas.
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts` — facturar snapshot de cuenta, no fuente completa.
- `apps/backend/src/domains/store/invoicing/invoicing.controller.ts` — creación de factura de cuenta con permisos actuales.
- `apps/backend/src/domains/store/invoicing/utils/split-invoice-projection.util.ts` — adapter financiero explícito nuevo.
- `apps/backend/src/domains/store/invoicing/utils/split-invoice-projection.util.spec.ts` — precisión/IVA/propina/envío/partes.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/interfaces/table.interface.ts` — contrato financiero.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/tables.service.ts` — HTTP grupo/cuentas.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-restaurant-integration.service.ts` — contrato POS.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/split-order-modal/split-order-modal.component.ts` — preview y titulares.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/split-order-modal/split-order-modal.component.html` — flujo visual.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/split-accounts-panel/split-accounts-panel.component.ts` — panel nuevo recuperable, cobro y factura.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/table-session-page/table-session-page.component.ts` — acceso y resultado persistente.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/table-session-page/table-session-page.component.html` — host del panel.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-split-bill-modal.component.ts` — conectar flujo real, no modal huérfano.
- `apps/frontend/src/app/private/modules/store/pos/pos.component.ts` — host POS.
- `apps/frontend/src/app/private/modules/store/orders/interfaces/order.interface.ts` — indicador de fuente repartida.
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` — acceso a cuentas y acciones económicas coherentes.
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html` — host del panel.

## Reusable Assets
- `common/money-kernel/decimal.ts` y `money-compare.ts`: Decimal y centavos; no números binarios para asignación autoritativa.
- `domains/store/taxes/utils/final-price.util.ts`: resolveOrderLineTaxTotal/resolveLineUnits, snapshot de impuestos.
- `PaymentGatewayService`: processors y validaciones; reserva propia excluida del saldo sin permitir al cliente omitir validaciones.
- `CashRegistersModule`: movimientos canónicos, no crear otro motor de caja.
- `InvoicingService.createFromOrder` y validadores FAV/FAU existentes: proyección económica de cuenta y gates fiscales actuales.
- Shared customer selector, money inputs, modal, buttons, CurrencyPipe y signals: UI reutilizada.
- `testing/prisma-mock.ts` y `money-fixtures.ts`: fixtures con tasas explícitas correctas, sin confiar en default19.

## Steps
1. Fijar contrato y persistencia aditiva.
   Skills: parallel, git-workflow, vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-error-handling
   Resources: `git status --short`; `git merge-base --is-ancestor origin/develop HEAD`; `npm run prisma:generate -w apps/backend`; `npm run db:migrate:prod -w apps/backend` solo con DATABASE_URL local confirmado y tras revisar migración propia.
   Business decision: una fuente física/comercial, cuentas financieras propias, abonos sin mover; cero backfills/borrrados históricos.
   Why: los ejecutores backend/frontend dependen de nombres/shape estable. Orquestador posee esquema/catálogo para evitar colisiones.
   Output: modelos/scopes/errores, migración idempotente con DATA IMPACT y checkpoint/commit protector; ningún deploy a producción.
   Verification: SQL local en transacción/dataset autorizado; tablas/FKs/índices tenant e idempotencia; Prisma generado sin reset. Si Prisma detecta drift nunca aceptar borrado/reset.
2. Algoritmo exacto.
   Skills: parallel, vendix-calculated-pricing, vendix-tax-typing, vendix-naming-conventions, buildcheck-dev
   Resources: `cd apps/backend && npm run test:path -- src/domains/store/tables/utils/split-allocation.util.spec.ts`.
   Business decision: separar P de R primero, conservar S/D/T/envío/propina y cumplir objetivos de cada cuenta; no inventar ajustes para esconder inconsistencias de fuente.
   Why: cálculo puro se puede desarrollar independiente mientras se integra esquema; es la base del preview y de la persistencia.
   Output: cents bigint, reparto matricial determinista, equal/custom/items, retained informativo.
   Verification: 11000−3000=4000+4000; casos asimétricos, centavos/tercios, múltiples impuestos, descuentos, envíos, propina, partidas anuladas, invariantes generativas y rechazo de fuente inconsistente.
3. Ledger/API y cobro.
   Skills: parallel, vendix-backend-api, vendix-validation, vendix-permissions, vendix-backend-auth, vendix-payment-processors, vendix-auto-entries, vendix-inventory-stock
   Resources: `cd apps/backend && npm run test:path -- src/domains/store/tables/split-order.service.spec.ts`; `npm run test:path -- src/domains/store/tables/split-account-payment.service.spec.ts` (desde apps/backend, secuenciales).
   Business decision: snapshot y budget se verifican bajo lock; requests repetidos recuperan mismo resultado; todo pago nuevo pertenece a una cuenta y a la fuente sin copiar abonos.
   Why: consume kernel/modelo; puede editarse en paralelo con UI, nunca con pruebas pesadas simultáneas.
   Output: lectura/preview/confirm, pagar/confirmar pago manual, cliente por cuenta, cancelación del grupo antes de nuevos efectos, SSE/paid_at agregado sin autocerrar mesa.
   Verification: Happy/Sad/Brute, dos transacciones reales en PostgreSQL para duplicados/saldo, tenant ajeno, pagos pending no contados como recibidos, fallo de processor sin éxito ficticio; cero filas orders/order_items/stock creadas al dividir.
4. Integración de políticas y factura.
   Skills: parallel, vendix-fiscal-scope, vendix-tax-typing, vendix-accounting-rules, vendix-error-handling, vendix-restaurant-ops
   Resources: `cd apps/backend && npm run test:path -- src/domains/store/invoicing/utils/split-invoice-projection.util.spec.ts`; `git diff -- <archivo-compartido>`.
   Business decision: no factura global duplicada, no split con documento previo vigente, no mutación económica del snapshot; cocina y entrega mantienen fuente e IDs físicos.
   Why: cerrar todos los consumidores antes de exponer confirmación; esperar únicamente los commits/regiones ajenos necesarios.
   Output: guards amigables de edición/cobro, barreras persistentes de integridad, mapper financiero por cuenta y protección antes de numerar.
   Verification: impuestos/total por cuenta conservados, documentos de retained+payables suman fuente, representación financiera explícita, validadores reales verdes; facturar dos veces misma cuenta falla y facturar otra cuenta no falla por compartir order_id.
5. UI de punta a punta.
   Skills: parallel, vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-frontend-modal, vendix-currency-formatting, vendix-ui-ux
   Resources: Playwright MCP en `https://vendix.com`; `bash scripts/buildcheck.sh --watch`; `docker logs --tail 80 vendix_backend`.
   Business decision: mostrar saldo/abonos y preview autoritativo; cuentas con titular propio, monto fijo, cobro y factura, recuperables tras recargar.
   Why: ahora los endpoints sostienen cada acción; reutilizar mismo panel desde mesa/POS/detalle, no una UI huérfana.
   Output: modo items/equal/custom funcional, abrir/cobrar/facturar cuentas, errores de versión y permisos visibles, sin permitir reescribir importes ya repartidos.
   Verification: Happy/Sad/Brute con navegador real en Roku local, sin credenciales en repo; ambas entradas visibles; reload recupera grupo, pagos parciales y cuenta final no duplican caja ni cocina.
6. Verificación integrada y publicación.
   Skills: parallel, how-to-test, buildcheck-dev, vendix-known-errors, pr-code-review, git-workflow, vendix-engram
   Resources: curl `https://api.vendix.com/api/store/orders/:id/split`; suites exactas anteriores una por invocación; `git diff --check`; `git push origin <sha-revisado>:develop`; `gh run list --commit <sha> --limit 3`.
   Business decision: no publicar la mitad del modelo; no llamar verde a una prueba que no ejercita el camino; no usar producción, cobros externos ni DIAN real para simular tests.
   Why: solo después de integrar todas las superficies; se conserva el trabajo de la otra sesión y se publica SHA específico sin force.
   Output: evidence de tests, HTTP, navegador, migración local, commits por scopes, memoria y push.
   Verification: presupuestos exactos, pagos previos intactos, una operación física, documentos individuales coherentes, logs watch limpios, revisión sin bloqueadores y SHA remoto confirmado. CI se sigue por SHA y se reporta su estado real.

## End-to-End Verification
1. Roku local: orden propia QA con líneas11000, abono3000, equal2→4000/4000; cobrar cada cuenta y revisar payments antiguos intactos, suma nueva8000, paid_at solo al completar, mesa no autocerrada.
2. Custom y por ítems con descuentos/IVA/envío/propina: todas las sumas por componente/cuenta exactas; ningún nuevo order_item, stock o ticket al dividir; platos ya cocinados siguen participando financieramente.
3. Factura por cuenta/titular con mapper/validadores reales, retained solo3000, nunca fuente11000 adicional. Fuente previamente facturada rechaza antes de efectos; no enviar documentos a DIAN productiva.
4. Sad/Brute: versión obsoleta, sumas inválidas, importes≤0, grupos con duplicados/ajenos, cross-tenant, doble clic, dos pagos concurrentes, sourcepay por otro carril y cancel/edit posterior; snapshots sin mutaciones en rechazo.
5. Pruebas Node serializadas para no saturar máquina; backend Docker logs y frontendwatch. No builds locales salvo solicitud humana explícita.

## Knowledge Gaps
- El schema/mappers se probarán contra precisión fiscal real; no asumir que fraccionar invoice.quantity a4decimales basta. No hay permiso para saltear validadores o inventar impuestos.
- Pruebas fiscales en Roku pueden requerir harness local porque su contabilidad estaba INACTIVE; no activarla silenciosamente ni emitir fuera del entorno de prueba.
- Otra sesión trabaja order-flow/webhook/creditnotes. No tocar diffs ajenos; integrar guardas pequeñas después de su commit y demostrar preservación. El resto sigue independiente.
- Reembolsos físicos siguen perteneciendo a la fuente; este cambio no crea una copia de mercancía por cuenta ni corrige deudas previas de la máquina de refunds. Los documentos financieros se corrigen por sus flujos fiscales existentes.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.

Autorización explícita de ejecución: «Implementalo pues», 2026-09-20, después de confirmar las tres reglas de negocio. Se ejecuta esta corrección integral; no se vuelve a entregar solo diseño.
