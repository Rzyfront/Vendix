## Context
La revisión del 27 de septiembre identificó 20 notas sobre POS, cobros, envíos, pedidos, cocina, inventario, división de cuentas, catálogo y ecommerce; después se añadió la comparación engañosa entre precio regular sin IVA y oferta con IVA. El usuario aclaró reglas de excedente, IVA de tarifa editada, cancelación de insumos por estado KDS, edición del mismo borrador y contra entrega. La rama de trabajo y publicación es `develop`; la verificación funcional solicitada es E2E en la UI local con Playwright, no pruebas por API, seguida de un reporte detallado. El merge `d421581fc` incorporó `origin/develop` sin descartar los cambios locales; cada diagnóstico de la fase de exploración debe confirmarse otra vez contra este HEAD antes de editar.

## General Objective
Corregir y publicar en `develop` las 21 observaciones de Review, conservando invariantes de dinero, impuestos, órdenes, cocina e inventario, con evidencia E2E de UI local para cada flujo.

## Specific Objectives
1. **R1–R3:** el pago múltiple no avanza con transferencia excedida ni con otra combinación inválida; efectivo puede generar cambio; el error real aparece en Cobro. Métodos no efectivos repetidos permanecen permitidos cuando cada tramo es válido.
2. **R4:** un costo manual de envío conserva el modo de IVA de la tarifa seleccionada; con IVA incluido el importe digitado es bruto y con IVA agregado es base sobre la que se adiciona IVA.
3. **R5:** Wallet participa en pagos múltiples con débito real, reserva/idempotencia y recuperación ante resultado ambiguo, sin marcar como cobrada una orden cuyo saldo no se debitó.
4. **R6:** un producto de entrega directa no permite despachar ni entregar globalmente platos pendientes de cocina; la entrega individual válida sigue disponible.
5. **R7:** el pago inicial del crédito se presenta como importe monetario con símbolo de la moneda configurada.
6. **R8:** el listado tabular de clientes no muestra la columna «Estado»; no se retiran por accidente filtros o información móvil que el usuario no pidió quitar.
7. **R9:** la vista previa de oferta del producto muestra el importe final y comunica si el impuesto está incluido o se agrega.
8. **R10:** el listado de órdenes finalizadas filtra por medio de pago realmente liquidado, incluyendo órdenes con varios tramos; no confunde método con estado de pago.
9. **R11:** un abono de crédito mayor al saldo se bloquea con mensaje claro y monto máximo antes de persistir nada.
10. **R12:** división de cuenta en mesa, POS y detalle de orden permite crear, ver y cobrar cuatro o más cuentas, seleccionar titular de forma accesible, recargar y continuar sin estados contradictorios; impuestos de envío no invalidan una división legítima.
11. **R13:** el listado de órdenes muestra neto comercial tras reembolsos completados y un indicador de reembolso parcial; pendientes/fallidos no se descuentan.
12. **R14:** seleccionar variantes actualiza precio final con IVA, imagen y compra en POS y ecommerce, respetando herencia cuando una variante no tiene imagen/precio propios.
13. **R15:** Enter recorre las selecciones predeterminadas del wizard de cobro con las mismas validaciones que un clic, sin doble envío ni captura accidental desde buscadores/campos de texto.
14. **R16:** modificar un borrador POS conserva el mismo `orders.id`, imágenes y datos previos, y Guardar actualiza sin repetir el wizard de creación ni cancelar/recrear la orden.
15. **R17:** el POS respeta `allow_negative_stock` en grilla, variantes, carrito y cantidades; ON permite con advertencia y OFF bloquea con faltante comprensible.
16. **R18:** cancelar un ticket KDS pendiente reintegra insumos exactamente una vez; desde «En preparación» exige elegir reutilizar/reintegrar o desechar, tanto por ticket como por ítem u orden.
17. **R19:** una venta a domicilio por alias, sin ficha de cliente, calcula y selecciona la tarifa automáticamente igual que una dirección equivalente de cliente formal.
18. **R20:** una orden POS contra entrega permanece pendiente de cobro, puede seguir el despacho de domicilio, muestra solo acciones aplicables, y al confirmar registra efectivo/transferencia/datáfono real conservando la modalidad original contra entrega.
19. **R21:** en cada vista de venta que muestra oferta y precio regular tachado, ambos importes usan el mismo tratamiento de IVA —preferiblemente precio final visible al comprador— para no aparentar una oferta más cara.
20. La suite Playwright recorre los 21 casos en `https://vendix.com` y el storefront local, con escenarios feliz, error y abuso o integridad pertinentes, usando la cuenta local entregada solo en tiempo de ejecución, nunca en archivos.
21. El reporte final deja evidencia de UI por caso, estado del watch backend/frontend, commit publicado y cualquier caso que todavía no se haya podido verificar; no declara «100 %» basándose en compilación o pruebas indirectas.

## Approach Chosen
Corregir cada comportamiento en los servicios y componentes existentes, manteniendo un único motor de pagos, una única orden física y el ledger financiero de cuentas ya implementado. Para contra entrega, reutilizar el marcador histórico `ON_DELIVERY` y registrar el pago final como tramo directo real en la misma orden, sin convertir ficticiamente el marcador en efectivo; evaluar una migración aditiva solo si el historial existente no conserva ambos hechos de forma inequívoca. Separar las correcciones en bloques con contratos e invariantes propios, revalidar las rutas tras el merge y cerrar cada bloque con Playwright UI antes de publicar; este enfoque aprovecha código probado y reduce el riesgo de reembolsos, caja y stock duplicados.

## Alternatives Considered
- Reescribir todo el POS y el motor financiero en un wizard nuevo: descartado porque multiplica superficies, invalida las rutas existentes de mesa/órdenes y dificulta probar causalidad de cada regresión.
- Prohibir cualquier método repetido en pago múltiple: descartado por decisión del usuario; dos transferencias independientes pueden ser legítimas.
- Marcar como `succeeded` el pago pendiente `ON_DELIVERY` al confirmar sin pedir método: descartado porque falsea el medio real de cobro.
- Resolver cocina, inventario o split ocultando botones solamente en frontend: descartado porque otros endpoints aún podrían saltarse la regla y alterar dinero/stock.
- Usar pruebas HTTP/curl como evidencia funcional principal: descartado por instrucción expresa del usuario; Playwright debe demostrar los recorridos de UI. Los specs de servicio son defensa adicional, no reemplazo de UI.

## Critical Files
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.ts` — avance y Enter del wizard.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-payment-step.component.ts` — subpasos y envío de cobro.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.ts` — validación de tramos, Wallet y mensajes.
- `apps/frontend/src/app/shared/components/payment-collector/payment-credit-fields.component.html` — importe inicial.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts` — rutas de cobro POS.
- `apps/backend/src/domains/store/payments/utils/payment-legs.util.ts` — normalización de tramos.
- `apps/backend/src/domains/store/payments/payments.service.ts` — creación/liquidación de pagos.
- `apps/backend/src/domains/store/payments/services/payment-gateway.service.ts` — procesador digital y reserva.
- `apps/backend/src/domains/store/wallet/services/wallet-payment.processor.ts` — débito Wallet.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.ts` — tarifa y alias.
- `apps/frontend/src/app/private/modules/store/pos/models/shipping.model.ts` — payload del override.
- `apps/backend/src/domains/store/orders/orders.service.ts` — snapshot fiscal del envío e hidratación de orden.
- `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` — cotización de tarifas.
- `apps/frontend/src/app/private/modules/store/pos/pos.component.ts` — Guardar/editar borrador.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.ts` — carga de borrador, imágenes y stock POS.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-product-selection.component.ts` — disponibilidad y oferta.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-variant-selector/pos-variant-selector.component.ts` — variantes/precio/stock.
- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — transiciones, despacho, pago, crédito, cancelación.
- `apps/backend/src/domains/store/orders/order-flow/order-action-policy.util.ts` — acciones aplicables.
- `apps/backend/src/domains/store/orders/order-flow/order-flow.controller.ts` — confirmación de pago.
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` — acciones, cobro y detalle.
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html` — acciones y panel de cuentas.
- `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts` — cancelación KDS e insumos.
- `apps/backend/src/domains/store/dispatch-notes/dispatch-notes.service.ts` — despacho de orden.
- `apps/backend/src/domains/store/tables/split-order.service.ts` — reparto financiero y restricciones fiscales.
- `apps/backend/src/domains/store/tables/split-account-payment.service.ts` — cobro de cuentas.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/split-accounts-panel/split-accounts-panel.component.ts` — panel de cuentas.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/split-accounts-panel/split-accounts-panel.component.html` — interacción y titular.
- `apps/frontend/src/app/private/modules/store/customers/components/customer-list/customer-list.component.ts` — columna Estado.
- `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts` — filtro, neto e indicador.
- `apps/frontend/src/app/private/modules/store/orders/interfaces/order.interface.ts` — contrato de listado.
- `apps/backend/src/domains/store/orders/dto/order-query.dto.ts` — filtro validado.
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts` — vista previa de oferta.
- `apps/frontend/src/app/private/modules/ecommerce/pages/product-detail/product-detail.component.ts` — variante, precio e imagen storefront.
- `apps/frontend/src/app/private/modules/ecommerce/components/product-quick-view-modal/product-quick-view-modal.component.ts` — variante en vista rápida.
- `tests/e2e/review-2026-09-27.spec.cjs` — escenarios UI Playwright sin secretos persistidos.

## Reusable Assets
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.ts` — validación/gate y formularios de pago compartidos por POS y orden.
- `apps/backend/src/domains/store/payments/utils/payment-legs.util.ts` — reglas canónicas de tramos, efectivo y métodos DIRECT.
- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — `payOrder`, confirmación, cancelación y estados con claims/idempotencia.
- `apps/backend/src/domains/store/tables/split-order.service.ts` y `split-account-payment.service.ts` — ledger de cuentas financieras sin clonar mercancía; conservar la arquitectura de `docs/plans/pos-split-financial-rebuild-plan.md`.
- `apps/backend/src/domains/store/inventory/shared/services/stock-level-manager.service.ts` y `StockValidatorService.resolveInventoryPolicy` — stock real, sobreventa y reversa.
- `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts` y `OrderFlowService.disposeConsumedPreparedLeaves` — movimiento FIFO y asientos de reutilización/merma.
- `apps/frontend/src/app/shared/pipes/currency/currency.pipe.ts` y `CurrencyFormatService` — símbolos/importes configurados, no `$` fijo.
- `apps/frontend/src/app/shared/components/responsive-data-view/responsive-data-view.component.ts` — tabla y tarjetas existentes, sin segundo listado.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts:getPaymentMethods` y `PaymentMethodsCatalogService` — catálogo de métodos, sujeto a permisos del listado.
- `apps/backend/src/domains/store/products/products.service.ts` y `apps/backend/src/domains/ecommerce/catalog/catalog.service.ts` — `final_price` calculado en lecturas y URL firmada de imagen de variante.
- `apps/backend/src/common/money-kernel/decimal.ts` — importes exactos para netos, distribución y validación.

## Steps
1. Establecer baseline actualizado, fixtures locales y recorrido UI de reproducción para los 21 casos.
   Skills: git-workflow, vendix-engram, buildcheck-dev, how-to-test, vendix-known-errors
   Resources: `git status --short --branch`; `git merge-base --is-ancestor origin/develop HEAD`; `bash scripts/buildcheck.sh --watch`; `docker logs --tail 40 vendix_backend`; `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --baseline`
   Business decision: la evidencia parte del HEAD fusionado, del vhost local y de registros de prueba propios; no usar producción ni persistir credenciales.
   Why: ningún fix es verificable si la sesión dev está rota o si el fallo original no se diferencia del comportamiento nuevo.
   Output: harness Playwright con login por variables de entorno, fixture/reporte por caso y estado inicial reproducible o «no reproducible aún» explícito.
   Verification: Playwright abre `https://vendix.com`, inicia sesión y navega a POS, órdenes, mesa, productos y storefront sin error de consola; el watch termina OK.
2. Corregir validación, mensajes, crédito, moneda y Enter en el cobro compartido (R1–R3, R7, R11, R15).
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-currency-formatting, vendix-error-handling, vendix-payment-processors, vendix-validation
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group payments`; `bash scripts/buildcheck.sh --watch`
   Business decision: efectivo puede dar cambio; transferencia y cualquier tramo no efectivo no pueden exceder deuda; repetir métodos válidos no se prohíbe; Enter nunca omite una validación ni envía dos veces.
   Why: el collector se comparte por otros flujos y debe estabilizarse antes de añadir Wallet/COD.
   Output: gate único del paso Monto, errores concretos, abono limitado al saldo, símbolo monetario y teclado consistente.
   Verification: Playwright prueba efectivo con cambio, transferencia excedida bloqueada en Cobro, dos transferencias válidas, dos efectivos inválidos con causa, crédito excedido sin mutación y Enter en cada paso sin doble venta.
3. Incorporar Wallet a pago múltiple con liquidación mixta segura (R5).
   Skills: vendix-payment-processors, vendix-inventory-stock, vendix-backend, vendix-backend-auth, vendix-multi-tenant-context, vendix-prisma-scopes, vendix-frontend, vendix-zoneless-signals, vendix-error-handling
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group wallet`; `docker logs --tail 40 vendix_backend`
   Business decision: una reserva digital y un débito Wallet real preceden al cierre económico; fallo o timeout no puede producir segundo débito, segundo pago o venta pagada ficticia.
   Why: Wallet no es un mero método DIRECT; se implementa después del gate común y antes de cerrar el contrato de cobro.
   Output: selección Wallet+otro medio, procesamiento idempotente y UI de pendiente/reintento/resultado.
   Verification: Playwright cubre Wallet suficiente+efectivo, saldo insuficiente, doble clic/reintento y vista de orden/pagos coherente tras recarga.
4. Unificar cotización por alias y fiscalidad de tarifa editada (R4, R19).
   Skills: vendix-ecommerce-checkout, vendix-address-geocoding, vendix-calculated-pricing, vendix-tax-typing, vendix-currency-formatting, vendix-backend, vendix-frontend, vendix-zoneless-signals, vendix-angular-forms
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group shipping`; `bash scripts/buildcheck.sh --watch`
   Business decision: la tarifa elegida sigue siendo fuente de modo/tasa de IVA aunque cambie el importe; alias y cliente formal con la misma dirección reciben las mismas opciones y cobertura.
   Why: cotización y snapshot deben concordar antes de probar cobro/contra entrega a domicilio.
   Output: override explícito con identidad fiscal de tarifa, total/breakdown correcto y selección automática por alias.
   Verification: Playwright compara alias vs cliente, IVA incluido/agregado antes y después de editar, finaliza la venta y comprueba el mismo importe/impuesto en detalle de orden.
5. Conservar identidad e imágenes al editar borrador POS (R16).
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-frontend-state, vendix-angular-forms, vendix-backend, vendix-inventory-stock
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group draft`; `bash scripts/buildcheck.sh --watch`
   Business decision: Guardar durante edición actualiza la orden existente y no repite las decisiones iniciales de cliente/entrega; imágenes de líneas históricas sobreviven a añadir ítems.
   Why: reutilizar `PUT /store/orders/:id/editor` evita cancelación/recreación y preserva pagos, reservas e historial.
   Output: ruta de guardar distinguida por modo edición y carga estable de imágenes firmadas.
   Verification: Playwright crea borrador, anota ID e imágenes, reabre en POS, añade producto y guarda; ID, imágenes y cantidad persisten al recargar, sin nueva orden ni wizard inicial.
6. Aplicar sobreventa configurada en toda superficie POS (R17).
   Skills: vendix-inventory-stock, vendix-product-variants, vendix-settings-system, vendix-frontend, vendix-zoneless-signals, vendix-frontend-state, vendix-error-handling
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group oversell`; `docker logs --tail 40 vendix_backend`
   Business decision: `allow_negative_stock=true` permite unidades sin disponible con advertencia; OFF bloquea por producto/variante faltante en todos los puntos de entrada.
   Why: el backend ya conoce la política, pero grilla, variante y carrito pueden impedir llegar a él; corregirlos antes de la prueba de cocina/despacho.
   Output: política disponible en POS y guards coherentes en selección, incremento, carrito desktop y móvil.
   Verification: Playwright alterna ON/OFF en configuración local y vende un producto agotado; muestra advertencia y stock negativo solo con ON, bloqueo claro con OFF.
7. Cerrar el bypass de cocina en despacho y entrega total (R6).
   Skills: vendix-restaurant-ops, vendix-inventory-stock, vendix-dispatch-routes, vendix-backend, vendix-frontend, vendix-zoneless-signals, vendix-error-handling
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group dispatch-kitchen`; `docker logs --tail 40 vendix_backend`
   Business decision: tener una gaseosa lista no autoriza despachar toda una orden si queda un plato pendiente; entrega individual directa sí continúa; la barrera vive en transiciones backend además de la UI.
   Why: protege el inventario y los estados antes de cualquier rediseño de acciones COD.
   Output: policy, `shipOrder`, entrega global y remisión coherentes con estado KDS.
   Verification: Playwright crea domicilio mixto, entrega ítem directo, observa despacho global bloqueado con razón, lleva plato a listo y entonces despacha sin marcarlo entregado antes de tiempo.
8. Reintegrar insumos al cancelar KDS según etapa (R18).
   Skills: vendix-restaurant-ops, vendix-inventory-stock, vendix-inventory-valuation, vendix-auto-entries, vendix-accounting-rules, vendix-backend, vendix-frontend, vendix-zoneless-signals
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group kitchen-cancel`; `docker logs --tail 40 vendix_backend`
   Business decision: pendiente ⇒ retorno automático; en preparación o posterior ⇒ decisión explícita de reutilizar o mermar; cancelar dos veces o por otra superficie nunca duplica stock/COGS/asiento.
   Why: las tres vías —ticket, ítem y orden— deben compartir disposición segura; no cambiar el `cancelTicketInTx` interno de reenvío sin distinguir intención.
   Output: disposición por estado, reversa FIFO/auditoría exacta y modal claro para estados avanzados.
   Verification: Playwright compara inventario antes/después de cancelar pendiente y avanzado con ambas elecciones, luego reintenta cancelar y comprueba que el inventario no cambia dos veces.
9. Reparar división financiera y UX en mesa/POS/detalle (R12).
   Skills: vendix-restaurant-ops, vendix-calculated-pricing, vendix-tax-typing, vendix-currency-formatting, vendix-backend, vendix-backend-api, vendix-validation, vendix-permissions, vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-frontend-modal, vendix-ui-ux
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group split`; `bash scripts/buildcheck.sh --watch`
   Business decision: una sola orden física, cuentas solo financieras, cuatro titulares visibles, pagos sin duplicar ingreso/stock/cocina; una tarifa gravada se reparte fiscalmente o se rechaza antes de prometer una división, nunca se elimina el IVA silenciosamente.
   Why: el ledger existente es la base, pero sus entradas difieren y el bloqueo de envío gravado contradice la experiencia integral solicitada.
   Output: creación/preview/confirmación/cobro de cuatro cuentas en todas las entradas, UI accesible y proyección fiscal válida con envío gravado.
   Verification: Playwright divide una mesa de cuatro, asigna titulares, paga parcial y total, recarga mesa y detalle, comprueba netos/estados y repite con envío gravado y rechazo de intentos duplicados.
10. Separar contra entrega del método real y limpiar acciones del detalle (R20).
   Skills: vendix-payment-processors, vendix-restaurant-ops, vendix-inventory-stock, vendix-backend, vendix-backend-api, vendix-validation, vendix-permissions, vendix-frontend, vendix-zoneless-signals, vendix-frontend-modal, vendix-currency-formatting
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group cod`; `docker logs --tail 40 vendix_backend`
   Business decision: contra entrega es modalidad de recaudo, no método final; el marcador pendiente persiste como procedencia y al cobrar se crea/liquida un tramo del medio real, una vez; despacho de domicilio no se bloquea solo por deuda COD.
   Why: después de estabilizar despacho y collector, se puede reutilizar `flow/pay` y retirar la confirmación ciega sin crear un segundo motor.
   Output: selector de medio real al confirmar, historial dual, pago/estado coherentes, una sola acción de despacho y ninguna recogida en domicilio.
   Verification: Playwright crea COD, comprueba pendiente + único despacho, despacha, cobra por efectivo y en otro caso por transferencia/datáfono, recarga y ve modalidad y medio; doble confirmación no genera segundo cobro.
11. Corregir precios de oferta/variantes y comparación fiscal (R9, R14, R21).
   Skills: vendix-product-variants, vendix-product-pricing, vendix-calculated-pricing, vendix-currency-formatting, vendix-ecommerce-checkout, vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-ui-ux
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group pricing`; `bash scripts/buildcheck.sh --watch`
   Business decision: precio actual, tachado y vista previa se calculan con el mismo modo fiscal; la variante seleccionada es la fuente de precio/imagen/cart, con fallback explícito a base cuando no hay override.
   Why: ambas vistas consumen `final_price` pero algunas muestran base local; corregirlas en un bloque evita otro comparativo engañoso.
   Output: previews de oferta con IVA incluido/agregado, POS y storefront con precio/imágenes de variante reactivos y precio tachado final.
   Verification: Playwright prueba oferta gravada con precio regular tachado, IVA incluido y agregado, cambia entre variantes con imagen propia/sin imagen y comprueba precio en carrito/checkout en POS y ecommerce.
12. Ajustar listados y cerrar publicación (R8, R10, R13 y auditoría global).
   Skills: vendix-frontend-data-display, vendix-currency-formatting, vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-frontend, vendix-zoneless-signals, how-to-test, buildcheck-dev, git-workflow, vendix-engram, vendix-known-errors
   Resources: `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --group lists`; `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --all`; `bash scripts/buildcheck.sh --watch`; `docker logs --tail 40 vendix_backend`; `git diff --check`; `git push origin develop`
   Business decision: el neto resta solo reembolsos completados; filtrar un método significa al menos un tramo liquidado de ese método; la publicación y el reporte solo declaran casos respaldados por UI local, sin fingir aprobación de lo no verificado.
   Why: los listados proyectan resultados de los bloques anteriores; el barrido global y push se hacen al final para no publicar una mitad funcional.
   Output: columna Estado retirada de tabla clientes, filtro por medio real con permisos correctos, neto/indicador parcial en desktop y móvil, suite E2E completa, reporte y commits en `develop` publicados.
   Verification: Playwright filtra órdenes multimétodo y comprueba reembolso parcial/completo/pendiente en lista; todos los grupos E2E de UI terminan verdes, watches limpios y `git ls-remote --heads origin develop` coincide con HEAD publicado.

## End-to-End Verification
1. `NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-2026-09-27.spec.cjs --all` usa Chromium/Playwright con `ignoreHTTPSErrors: true`, `https://vendix.com`, usuario local provisto por variables de entorno y fixtures propios. Cada R1–R21 registra resultado feliz, error y prueba de integridad/abuso pertinente; capturas y trazas se guardan fuera del repositorio o en directorio gitignored.
2. Navegador UI: recorrer POS → borrador/editar → cobrar multimétodo/Wallet/crédito → envío/COD → detalle/orden, verificar valores, botones, estados, historial y ausencia de error en consola. No sustituir estas aserciones por respuestas HTTP.
3. Navegador UI: recorrer mesa/KDS → cuatro cuentas → cobros individuales → cancelación pendiente/avanzada → inventario → despacho; verificar que ningún plato salta cocina y no hay devoluciones duplicadas.
4. Navegador UI: recorrer producto con oferta/IVA/variantes → grilla POS → storefront → carrito/checkout; verificar precio final, tachado e imagen tras cada selección y recarga.
5. `bash scripts/buildcheck.sh --watch` y `docker logs --tail 40 vendix_backend` confirman salud de compilación/runtime; no son prueba funcional de UI. `git diff --check` y SHA remoto confirman entrega en `develop`.

## Knowledge Gaps
- Wallet+otro tramo puede requerir coordinación transaccional adicional entre débito y medios directos; documentar el contrato exacto y no habilitar la opción visual antes de disponer de compensación/idempotencia.
- El split financiero actual rechaza envío gravado; la proyección fiscal por cuenta debe conservar impuestos/redondeo y puede necesitar cambio aditivo de persistencia. Una migración nueva solo se creará si es indispensable, siguiendo `vendix-prisma-migrations`; nunca modificar migraciones aplicadas ni datos productivos sin autorización específica.
- Los tools `mcp__playwright__browser_*` no están expuestos en esta sesión; Playwright está instalado globalmente. Usar su API Node local con `NODE_PATH=/opt/homebrew/lib/node_modules` para E2E real y no informar que se usó MCP.
- La cuenta de prueba fue entregada sin `organization_slug`/`store_slug`; resolverlo desde la UI o el contexto local autorizado, sin escribir la contraseña en el repositorio.
- El plan de split previo y otras sesiones/worktrees pueden tocar áreas afines; volver a inspeccionar el árbol antes de cada edición y no sobrescribir cambios ajenos. El usuario preautorizó ejecutar y publicar en `develop`, pero no una operación destructiva de datos.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.

Autorización ya recibida en esta conversación: «ejecuta todo», «trabaja todo en develop» y «súbelo todo»; por tanto se continúa la ejecución sin interrumpir al usuario durante la noche.
