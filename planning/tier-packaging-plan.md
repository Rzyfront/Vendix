# Plan: Empaque por Tarifa (units-per-tier packaging)

## Context
Hoy el "empaque" (unidades por caja/bulto) vive en un campo único a nivel producto (`products.units_per_package` + `package_consumes_multiple_stock`) que no se usa en producción. El negocio requiere que la cantidad de unidades por empaque viva en la **tarifa** (price tier), con override opcional por producto, para vender "caja x6 mayorista" descontando 6 de stock y cobrando el precio de la caja. Resultado esperado: tarifas con cantidad opcional, formulario de producto con multiselect de tarifas (precio/margen/cantidad por tarifa), POS que cuenta paquetes y unidades, y backend/facturas que procesan y muestran el empaque.

## General Objective
Mover la configuración de empaque desde el producto hacia la tarifa (con override por producto) y completar la UI/lógica de POS, órdenes y facturas para vender por paquete.

## Specific Objectives
1. `price_tiers.units_per_package` (Int?, opcional) existe y se configura desde el módulo de tarifas.
2. `product_price_tier_overrides` admite `override_price` nulo y un `override_units_per_package` (Int?) por producto+tarifa.
3. Las columnas `products.units_per_package` y `products.package_consumes_multiple_stock` se eliminan (UI + DB), autorizado por el usuario (sin datos productivos).
4. `PriceResolverService.resolveWithTier` calcula `unitPrice` como precio de paquete (`base × packSize × (1−desc)`), o usa `override_price` cuando existe, y devuelve `unitsPerPackage = packSize` resuelto por cascada (override → tarifa → 1).
5. Un único helper de empaque resuelve `packSize` + `stock_units_consumed` y es consumido por orders, payments, quotations y sales-orders (elimina la lógica duplicada).
6. El formulario de producto: quita la sección "Empaque"; convierte "Multi-Tarifa" en multiselect buscable (patrón Promociones) con precio↔margen bidireccional y cantidad por tarifa.
7. El POS suma por paquete y muestra "N paquetes (= N×packSize unidades)"; el +/- escalona por paquete.
8. La factura (PDF tienda + detalle frontend) muestra tarifa aplicada y empaque (unidades descontadas), igual que el PDF de organización.

## Approach Chosen
Extender el modelo existente (tarifa + overrides + assignments) en vez de crear modelos nuevos, porque ya soporta snapshots (`applied_price_tier_id`, `stock_units_consumed`) y el grano producto+variante+tarifa. La cantidad de empaque se resuelve por cascada `override_units_per_package → tarifa.units_per_package → 1`. El precio de tarifa sigue siendo opcional: si existe `override_price` es el precio de la caja; si no, `base × packSize × (1−discount_percentage)`. Con `packSize=1` la fórmula degenera al comportamiento actual (cero regresión). Se centraliza el cálculo de `stock_units_consumed` en un helper puro reutilizado por los 4 servicios que hoy lo duplican.

## Alternatives Considered
- Mantener el empaque en el producto y solo togglear por tarifa: rechazado — no permite override por producto (anotación 3) ni que la tarifa sea la fuente de verdad (anotación 1).
- Crear un modelo nuevo `tier_packaging`: rechazado — duplica `product_price_tier_overrides`, que ya tiene el grano correcto y los snapshots.
- Conservar columnas del producto sin usarlas: rechazado — el usuario pidió explícitamente eliminarlas y no hay datos productivos.

## Critical Files
- `apps/backend/prisma/schema.prisma` — modelos `price_tiers`, `product_price_tier_overrides`, `products`.
- `apps/backend/prisma/migrations/<new>/migration.sql` — migración idempotente (add/alter/drop columnas).
- `apps/backend/src/domains/store/products/services/price-resolver.service.ts` — pricing por paquete + helper de empaque.
- `apps/backend/src/domains/store/price-tiers/dto/create-price-tier.dto.ts` — `units_per_package`.
- `apps/backend/src/domains/store/price-tiers/dto/update-price-tier.dto.ts` — PartialType.
- `apps/backend/src/domains/store/price-tiers/dto/upsert-product-override.dto.ts` — `override_price?` opcional + `override_units_per_package?`.
- `apps/backend/src/domains/store/price-tiers/price-tiers.service.ts` — persistencia de los nuevos campos.
- `apps/backend/src/domains/store/orders/orders.service.ts` — `resolveTierSnapshotsForItems` usa el helper.
- `apps/backend/src/domains/store/payments/payments.service.ts` — usa el helper.
- `apps/backend/src/domains/store/quotations/quotations.service.ts` — usa el helper.
- `apps/backend/src/domains/store/orders/sales-orders/sales-orders.service.ts` — usa el helper.
- `apps/backend/src/domains/store/orders/purchase-orders/purchase-orders.service.ts` — quita escritura de empaque al producto.
- `apps/backend/src/domains/store/orders/purchase-orders/dto/create-purchase-order.dto.ts` — quita campos de empaque.
- `apps/backend/src/domains/store/products/products.service.ts` — quita lectura/escritura de campos eliminados.
- `apps/backend/src/domains/store/products/products-bulk.service.ts` — quita mapeo "Unidades por Empaque".
- `apps/backend/src/domains/store/products/dto/bulk-product-analysis.dto.ts` — quita campos de empaque.
- `apps/backend/src/domains/store/products/dto/index.ts` — exports afectados.
- `apps/backend/src/domains/store/invoicing/services/invoice-pdf.builder.ts` — render empaque en PDF tienda.
- `apps/frontend/src/app/shared/services/pricing/price-resolver.service.ts` — pricing por paquete (espejo frontend).
- `apps/frontend/src/app/shared/services/pricing/types.ts` — tipos de empaque.
- `apps/frontend/src/app/private/modules/store/price-tiers/interfaces/price-tier.interface.ts` — `units_per_package`.
- `apps/frontend/src/app/private/modules/store/price-tiers/services/price-tiers.service.ts` — DTOs.
- `apps/frontend/src/app/private/modules/store/price-tiers/pages/price-tier-form-page/price-tier-form-page.component.ts` + `.html` — input de cantidad.
- `apps/frontend/src/app/private/modules/store/price-tiers/pages/price-tiers-list-page/price-tiers-list-page.component.ts` — columna empaque.
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts` + `.html` — quita Empaque, rehace Multi-Tarifa.
- `apps/frontend/src/app/private/modules/store/products/interfaces/product.interface.ts` — quita campos de empaque.
- `apps/frontend/src/app/private/modules/store/products/interfaces/bulk-product-analysis.interface.ts` — quita campos.
- `apps/frontend/src/app/private/modules/store/pos/models/cart.model.ts` — campos de tarifa/empaque (ya existen; ajustar semántica).
- `apps/frontend/src/app/private/modules/store/pos/cart/pos-cart.component.ts` — display paquetes/unidades + step.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.ts` — packSize desde tarifa.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-product.service.ts` — carga packSize de tarifa.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts` — display empaque.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-payment-interface.component.html` — display empaque.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-cart-modal.component.ts` — display empaque.
- `apps/frontend/src/app/shared/components/quantity-control/quantity-control.component.ts` — sublabel unidades.
- `apps/frontend/src/app/private/modules/store/invoicing/components/invoice-detail/invoice-detail.component.ts` — tarifa + empaque por línea.

## Reusable Assets
- `app-multi-selector` (`apps/frontend/src/app/shared/components/multi-selector/multi-selector.component.ts`) — patrón buscable a reusar en Multi-Tarifa.
- `PriceResolverService.resolveWithTier` (backend + frontend) — ya devuelve `isPackageUnit`/`unitsPerPackage`; extender, no duplicar.
- `StockLevelManager.reserveStock(..., stock_units_consumed)` — ya acepta override de unidades; sin cambios.
- Snapshots en `order_items`/`quotation_items`/`sales_order_items` (`applied_price_tier_id`, `applied_price_tier_name_snapshot`, `stock_units_consumed`) — ya existen; reutilizar.
- `order-pdf.builder.ts` (organización) — ya renderiza el empaque; copiar el patrón al PDF de tienda.
- `app-input [currency]`, pipe `currency`, `quantity-control` — reutilizar para inputs y conteo.

## Steps
1. Backend: schema + migración + contrato de pricing/empaque
   Skills: vendix-prisma-schema, vendix-prisma-migrations, vendix-product-pricing, vendix-calculated-pricing, vendix-backend-api, vendix-validation
   Resources: edición de `schema.prisma`; migración SQL idempotente con header `-- DATA IMPACT:` (drop de 2 columnas autorizado, sin datos)
   Business decision: la tarifa es la fuente de verdad del empaque (cantidad opcional); `override_price` es el precio del paquete; `packSize = override_units → tarifa.units → 1`; con `packSize=1` no hay regresión.
   Why: define el contrato (campos + resolver + helper) del que dependen todos los consumidores y el frontend; va primero.
   Output: `price_tiers.units_per_package`; `product_price_tier_overrides.override_price` nullable + `override_units_per_package`; columnas de producto eliminadas; `resolveWithTier` con precio por paquete; helper puro `resolveStockUnitsConsumed(tierUnits, overrideUnits, quantity)`; DTOs de tarifa/override actualizados.
   Verification: revisión de código de `schema.prisma` + `migration.sql` (idempotente, no destructivo más allá de lo autorizado) + `price-resolver.service.ts` (fórmula packSize); `npx prisma validate`.
2. Backend: repuntar consumidores al helper + limpiar campos eliminados
   Skills: vendix-inventory-stock, vendix-backend-api, vendix-multi-tenant-context, vendix-prisma-scopes, vendix-validation
   Resources: none
   Business decision: `stock_units_consumed = quantity × packSize` cuando `packSize>1`, calculado por el helper único; purchase-orders deja de escribir empaque al producto.
   Why: una vez existe el contrato (paso 1), los consumidores son archivos disjuntos y se actualizan en paralelo sin colisión.
   Output: orders/payments/quotations/sales-orders usan el helper; purchase-orders y products(+bulk) sin referencias a campos eliminados.
   Verification: `grep -rn "units_per_package\|package_consumes_multiple_stock" apps/backend/src` no devuelve referencias a campos de PRODUCTO (solo de tarifa/override); revisión de código de cada servicio.
3. Frontend: contrato de pricing/tipos/servicio de tarifas
   Skills: vendix-zoneless-signals, vendix-currency-formatting, vendix-product-pricing, vendix-angular-forms
   Resources: none
   Business decision: espejo exacto del contrato backend (precio por paquete, packSize por cascada) para que POS y formulario calculen igual que el servidor.
   Why: POS y formulario de producto dependen de estos tipos/servicios; va antes de las features de UI.
   Output: frontend `price-resolver.service.ts`/`types.ts` con packSize; `price-tier.interface.ts` + `price-tiers.service.ts` con `units_per_package`/override; `product.interface.ts` sin campos eliminados.
   Verification: revisión de código de tipos/servicios; coherencia con DTOs backend.
4. Frontend: módulo de tarifas (input cantidad)
   Skills: vendix-angular-forms, vendix-zoneless-signals, vendix-frontend-component, vendix-currency-formatting
   Resources: none
   Business decision: la tarifa expone "Unidades por empaque (opcional)"; ≥2 marca `is_package_unit`.
   Why: habilita configurar la cantidad por defecto que el producto luego puede overridear.
   Output: `price-tier-form-page` con input de cantidad; `price-tiers-list-page` muestra el empaque.
   Verification: revisión de código del form/list; binding del nuevo control.
5. Frontend: formulario de producto (quita Empaque, rehace Multi-Tarifa)
   Skills: vendix-angular-forms, vendix-zoneless-signals, vendix-frontend-component, vendix-currency-formatting, vendix-product-pricing
   Resources: none
   Business decision: el producto base siempre se vende por unidad; la variabilidad de cantidad va atada a la tarifa; Multi-Tarifa = multiselect buscable (patrón Promociones) con precio↔margen y cantidad por tarifa (override del default).
   Why: es la UI central de la feature; depende del contrato (pasos 1 y 3).
   Output: sección "Empaque" eliminada; "Multi-Tarifa" con `app-multi-selector` + filas configurables (precio, margen bidireccional vs costo×packSize, cantidad override); persistencia vía assignments + overrides.
   Verification: revisión de código `.ts`/`.html`; eliminación de controles `units_per_package`/`package_consumes_multiple_stock`; cálculo margen↔precio.
6. Frontend: POS (paquetes/unidades + step) y POP
   Skills: vendix-zoneless-signals, vendix-currency-formatting, vendix-frontend-component
   Resources: none
   Business decision: la cantidad del carrito cuenta paquetes; muestra "N paquetes (= N×packSize unidades)"; el +/- escalona por paquete; el packSize sale de la tarifa (override producto).
   Why: cumple la anotación 4 en la capa de venta; depende del contrato frontend (paso 3).
   Output: `pos-cart` muestra paquetes+unidades; `quantity-control` sublabel; servicios POS/POP cargan packSize de la tarifa; confirmación/pago muestran empaque.
   Verification: revisión de código del carrito y servicios; coherencia del display y del payload enviado al backend.
7. Backend+Frontend: facturas con empaque
   Skills: vendix-currency-formatting, vendix-zoneless-signals, vendix-backend-api
   Resources: none
   Business decision: la factura muestra la tarifa aplicada y el empaque (unidades descontadas), replicando el PDF de organización en el de tienda.
   Why: cierra el flujo (anotación 4: "mostrarlo igual en las facturas"); depende de los snapshots ya persistidos.
   Output: `invoice-pdf.builder.ts` (tienda) con campo + render de empaque; `invoice-detail.component` con tarifa + unidades por línea.
   Verification: revisión de código; comparación con `order-pdf.builder.ts` (organización) que ya lo hace.
8. Verificación detallada (la "prueba")
   Skills: buildcheck-dev, vendix-product-pricing, vendix-inventory-stock
   Resources: `npx prisma validate`; `grep -rn` de campos eliminados; revisión de código cruzada backend↔frontend
   Business decision: la prueba es verificación de código a detalle (no runtime), por indicación del usuario.
   Why: valida coherencia del contrato extremo a extremo antes de cerrar.
   Output: informe de verificación por capa con la fórmula de precio/stock validada y sin referencias huérfanas.
   Verification: checklist de coherencia: schema↔DTO↔resolver↔consumidores↔frontend↔factura; cero referencias a campos de producto eliminados.

## End-to-End Verification
1. Contrato de datos: `npx prisma validate` pasa; `grep -rn "products.units_per_package\|package_consumes_multiple_stock" apps/backend/src apps/frontend/src` solo muestra el modelo `price_tiers`/override, nunca el producto.
2. Pricing: revisión de código confirma que para una tarifa "Caja x6" con `override_price=30000`, 2 cajas → `unit_price=30000`, `total=60000`, `stock_units_consumed=12`; sin override → `unit_price=base×6×(1−desc)`.
3. POS→orden→factura: revisión de código del flujo confirma que el `applied_price_tier_id` + `stock_units_consumed` viajan del carrito al `order_item` y se muestran en `invoice-detail` y el PDF de tienda.
4. Coherencia frontend↔backend: el helper de pricing frontend produce los mismos números que `resolveWithTier` backend (revisión cruzada de fórmulas).

## Knowledge Gaps
- Lógica de `stock_units_consumed` duplicada en 4 servicios (orders/payments/quotations/sales-orders): se centraliza en un helper en este plan. Si el patrón se consolida, proponer actualizar `vendix-inventory-stock` o `vendix-product-pricing` con la regla "packSize por cascada tarifa→override". Pendiente de confirmar tras estabilizar.

## Approval Request
Plan listo. El usuario dio directiva permanente "implementa y prueba todo" y respondió las 3 decisiones críticas (P1/P2/P3); se procede a ejecución bajo `how-to-dev` con equipos de agentes, todo en la rama `dev` tocando solo archivos de esta feature.
