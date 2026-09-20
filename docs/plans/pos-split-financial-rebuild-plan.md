# F-006 — diseño del reparto financiero integral

## Context
El usuario eligió «Corrección completa: prorrateo y reparto exacto de importes», «Cuentas independientes, cada una cobrable y facturable» y «Dividir únicamente el saldo pendiente». El split actual crea subórdenes copiando líneas físicas: ignora los importes equal/custom, pierde descuentos/envío/propina y deja pagos previos en una fuente cancelada. Este documento es el diseño preparatorio de la siguiente etapa, NO una implementación ni una autorización para migrar; la integración con pagos/facturación debe esperar la liberación de los archivos de `docs/plans/pos-money-8-fixes-plan.md`. No se sustituye el arreglo solicitado por bloquear temporalmente la funcionalidad.

## General Objective
Dividir exactamente el saldo pendiente en cuentas independientes cobrables y facturables, conservando el dinero ya recibido, los componentes originales y una única operación de inventario/cocina.

## Specific Objectives
1. `sum(saldo_cuentas_nuevas) = saldo_pendiente_fuente` en centavos, tanto equal como custom y por ítems.
2. Los abonos existentes conservan pago, transacción, titular y trazabilidad originales; no se copian a hijos ni se prorratean como nuevos cobros.
3. Cada cuenta nueva tiene titular, importe pendiente, estados y documento propio; sus líneas financieras referencian las líneas fuente sin crear otra venta física.
4. Base, descuentos, impuestos por tipo/tasa, envío y propina se conservan entre la porción previamente pagada y las cuentas restantes; no se recalculan desde catálogo vivo.
5. Cero reconsumo de stock, refire, reservas duplicadas o resurrección de ítems anulados; la fuente operativa sigue siendo el ancla KDS.
6. Repetir/competir split y pago no duplica cuentas ni excede saldo; snapshot y versión son atómicos.
7. Fiscalidad de cuentas independientes no duplica el documento de la fuente ni factura nuevamente el abono previo.

## Approach Chosen
Representar explícitamente el grupo de división y sus cuentas/asignaciones financieras, separados de las cantidades físicas. Mantener la orden y los ítems operativos para KDS/stock; relacionar cada cuenta cobrable con su snapshot financiero y sus líneas fuente. Reutilizar cobros reales existentes, pero distinguir cuentas financieras de órdenes operativas en los lectores de pago, inventario, facturación y reportes antes de habilitar la nueva escritura.

El modelo actual no contiene participaciones ni asignaciones pago↔cuenta: `table_sessions.order_id` apunta a una orden y `payments.order_id` a una sola orden. `order_items.quantity` es Int; `invoice_items.quantity` ya es Decimal(12,4), lo que permite estudiar una representación fiscal fraccionada sin migrar inventario a Decimal, pero NO demuestra por sí solo que el mapper y los validadores fiscales acepten todas las particiones exactas. Esa coherencia debe probarse antes de fijar el esquema definitivo.

El algoritmo debe satisfacer simultáneamente totales por cuenta y por componente: redondear cada componente de forma independiente con resto mayor no basta para asegurar todos los importes custom. La porción ya pagada se representa para conciliación, sin trasladar o crear otra transacción. No fabricar precios, descuentos ni productos genéricos para esconder residuos.

## Alternatives Considered
- Una sola factura con varios pagos: descartada por elección explícita del usuario.
- Repartir el total y prorratear el abono entre hijos: descartado; se divide únicamente el saldo pendiente.
- Greedy de líneas enteras y ajuste del precio hasta cuadrar: descartado; 10.000 + 1.000 dividido en 5.500/5.500 no se representa moviendo líneas enteras sin alterar su significado.
- Crear pagos pending para representar cuotas: descartado; el validador resta pagos pending del saldo y los processors crean sus propias transacciones. Cuota asignada no es pago iniciado.
- Reutilizar payment_links: descartado; es integración Wompi con identificador externo obligatorio, no un modelo de cuentas split.
- Copiar cantidades fraccionarias a order_items o consumir inventario al dividir: descartado por modelo Int y regla de operación única.

## Critical Files
- `apps/backend/prisma/schema.prisma` — modelo de grupo/cuenta/asignación y relaciones aditivas, pendiente de diseño definitivo.
- `apps/backend/src/prisma/services/store-prisma.service.ts` — registro de modelos scoped; no registrar sin revisar consumidores ecommerce/organization.
- `apps/backend/src/domains/store/tables/split-order.service.ts` — reemplazar distribución que ignora objetivos por orquestación financiera atómica.
- `apps/backend/src/domains/store/tables/split-order.service.spec.ts` — conservación y concurrencia realista, sin fixtures simétricos que oculten defectos.
- `apps/backend/src/domains/store/tables/dto/split-order.dto.ts` — contrato de importes, destinatarios, idempotencia y versión.
- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — vínculo operativo y lectura del saldo/abonos.
- `apps/backend/src/domains/store/payments/payments.service.ts` — integración posterior, reservado durante la tanda concurrente.
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts` — snapshot financiero y documento por cuenta; reservado durante la tanda concurrente.
- `apps/backend/src/domains/ecommerce/tables/ecommerce-tables.service.ts` — no reciclar gateway_reference de otra cuenta/cuota.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/interfaces/table.interface.ts` — contrato cuentas y saldos.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/tables.service.ts` — preview/confirm y respuesta.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/split-order-modal/split-order-modal.component.ts` — preview exacto e identificación de cuentas.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-split-bill-modal.component.ts` — paridad del modal POS.

La lista identifica archivos existentes de integración, no una allowlist ejecutiva final. Las rutas nuevas de migración, servicios de cálculo, controllers y specs se fijan después del paso 1; ningún ejecutor puede inferir permiso para editarlas a partir de este diseño.

## Reusable Assets
- `apps/backend/src/common/money-kernel/decimal.ts` y `money-compare.ts` — Decimal y comparación por centavos.
- `apps/backend/src/common/interfaces/tax-breakdown.interface.ts` — referencia de reparto con conservación; no copiar `scaleBreakdownToTotal` como matriz general, pues descarta información de base/tasa.
- `apps/backend/src/domains/store/taxes/utils/final-price.util.ts` — resolveLineUnits para pesos/escalas en snapshots originales.
- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — tax breakdown primero, escalar con multiplicador solo como fallback.
- `apps/backend/src/common/errors/vendix-http.exception.ts` — errores tipados; coordinar catálogo compartido en un commit único.
- `apps/backend/src/testing/prisma-mock.ts` y `money-fixtures.ts` — fixtures monetarios como punto de partida, no sustituyen pruebas transaccionales de Postgres.
- Los dos modales split existentes — conservar accesibilidad, moneda, signals y flujos sin construir una pantalla paralela.

## Steps
1. Cerrar contrato financiero/fiscal antes del esquema.
   Skills: vendix-business-analysis, vendix-restaurant-ops, vendix-fiscal-scope, vendix-tax-typing, vendix-accounting-rules
   Resources: lectura de `schema.prisma`, `invoicing.service.ts:createFromOrder`, `table-sessions.service.ts:confirmPayment` y fixtures de factura con pagos parciales.
   Business decision: cuentas independientes solo por saldo pendiente; los abonos existentes permanecen trazables y no se vuelven a cobrar.
   Why: define qué representa una cuenta y cómo soportar la parte ya pagada; sin ello un esquema nuevo puede duplicar ingreso o factura.
   Output: decisión explícita sobre porción ya pagada, fuente con documento fiscal previo, edición/anulación post-split y representación fiscal de fracciones; inventario completo de rutas nuevas con allowlist final.
   Verification: ejemplos de 11.000 con abono 3.000 repartiendo 8.000 en dos cuentas de 4.000; componentes y documentos suman exactamente lo original, sin otro movimiento de caja por los 3.000.

2. Modelo aditivo y cálculo puro.
   Skills: vendix-prisma-schema, vendix-prisma-migrations, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-naming-conventions
   Resources: `npm run prisma:generate -w apps/backend`; `npm run db:migrate:dev -w apps/backend` únicamente tras revisar SQL y aprobar el alcance local; suite específica de cálculo que se nombrará en paso 1.
   Business decision: separar magnitudes financieras y operativas, almacenar snapshot/version, índices tenant y unicidad idempotente, sin mutar datos históricos.
   Why: antes de endpoints/pagos, que dependen del contrato estable; no publicar esquema y consumidores a medias.
   Output: migración idempotente aditiva con DATA IMPACT, modelos scoped y algoritmo por matriz de cuentas/componentes con precisión controlada.
   Verification: repetición segura de SQL en dataset local representativo; conservación por componente y cuenta para equal/custom, impuestos mixtos, centavos, pesos, descuentos y abonos. No migraciones destructivas ni CASCADE de negocio.

3. Orquestación, pago, fiscalidad y operación única.
   Skills: parallel, vendix-backend-api, vendix-validation, vendix-payment-processors, vendix-inventory-stock, vendix-restaurant-ops, vendix-fiscal-scope, vendix-tax-typing, vendix-auto-entries
   Resources: `git status --short`; `git diff -- <archivo-asignado>`; endpoints existentes split-by-items/split-by-amount y fixtures de cobro/facturación por cuenta.
   Business decision: la fuente sigue gobernando KDS/stock; cada cuenta paga/factura únicamente su participación. No emitir ingreso ni salida de caja por copiar información.
   Why: espera commits de la otra sesión en payments/invoicing, relee y adapta el contrato final; no mezclar diffs ajenos.
   Output: preview/confirm idempotentes con control de versión y transacción; cobro/facturación/reportes conscientes del modelo financiero, no solo nuevas filas.
   Verification: pago y split concurrentes no exceden saldo; fallo intermedio revierte cuentas sin efectos externos; un ítem cocinado no vuelve a consumirse; factura original y cuentas nunca suman doble ingreso.

4. Flujos de ambos modales y verificación integral.
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-frontend-modal, vendix-currency-formatting, vendix-ui-ux, how-to-test, buildcheck-dev
   Resources: Playwright MCP sobre `https://vendix.com`; `bash scripts/buildcheck.sh --watch`; `docker logs --tail 80 vendix_backend`; curl sobre `https://api.vendix.com/api` con fixtures locales propios.
   Business decision: el usuario ve saldo pendiente, abono conservado, distribución y titular de cada cuenta antes de confirmar, y puede cobrar/facturar cada una.
   Why: último paso funcional: la UI no debe prometer importes que los endpoints todavía no sostienen.
   Output: paridad POS/mesa, casos Happy/Sad/Brute y evidencia de cobro/facturación sin duplicación.
   Verification: ejemplo 11.000/abono3.000/cuotas4.000+4.000 completo; custom con centavos, cliente distinto por cuenta, duplicados/IDs ajenos/reintentos, ventana de pago concurrente y manejo accesible del conflicto de versión.

## End-to-End Verification
1. Curl + Playwright local: crear orden propia, registrar abono, dividir saldo, cobrar cuentas con clientes distintos y emitir documentos en entorno fiscal de pruebas; comparar pagos, cuotas, facturas y componentes originales.
2. Dataset con ítems activos/cancelados, cantidades/pesos/escalas, propina, descuentos e impuestos mixtos: no revivir anulados, no perder componentes ni recalcular histórico.
3. Happy/Sad/Brute: cero doble consumo KDS/stock, cero pagos clonados, fail/rollback/idempotencia/tenant y concurrencia real con dos transacciones de Postgres.
4. Lectura de logs del watcher, suites acotadas secuenciales y CI del SHA exacto; no compilar servidores adicionales ni probar contra tenants productivos.

## Knowledge Gaps
- Este es diseño preparatorio, NO plan ejecutable final: faltan rutas de nuevos artefactos y decisiones del paso 1. No solicitar aprobación como si estuviera listo ni iniciar migración desde este documento.
- Tratamiento de una fuente ya facturada y soporte fiscal de la porción previamente abonada deben fijarse sin cambiar documentos aceptados ni duplicar facturación. Requiere revisar el contrato fiscal real, no asumir que Decimal en invoice_items soluciona toda la exactitud.
- Edición/anulación de platos después de dividir: faltan reglas de snapshots cobrados e impagos; no reescribir cuentas pagadas ni sus facturas.
- La integración necesita payments/invoicing y eventualmente los consumidores de métricas; tener una nueva tabla no elimina esos cambios. Los archivos están reservados por la otra sesión hasta su commit/revisión.
- No usar `is_split` implícito en notas JSON como sustituto de un contrato persistente tipado y auditado sin evaluar todos sus consumidores.

## Approval Request
Diseño en preparación, no aprobable aún: cerrar las decisiones del paso 1, completar rutas y verificar el plan antes de solicitar aprobación formal. Las tres reglas de negocio indicadas en Context ya están confirmadas; no volver a preguntarlas.
