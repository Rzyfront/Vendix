## Context
El sistema de promociones ya tiene entidades, configuracion basica, motor de elegibilidad y soporte parcial en POS, pero los flujos de catalogo, carrito, checkout, orden y pago no comparten una fuente de verdad para calcular descuentos. Hoy e-commerce no aplica promociones/cupones al crear orden, POS envia descuentos calculados por frontend y el backend no reconstruye el total de forma autoritativa, y las cards de POS/e-commerce solo muestran ofertas por `sale_price`, no promociones por producto o categoria. El cambio debe completar promociones por producto, categoria y compra general, mantener los cupones donde aplican, y no afectar ventas sin promociones ni configuraciones existentes de POS/e-commerce.

## General Objective
Garantizar que promociones y cupones se configuren, visualicen, calculen, persistan y paguen correctamente de punta a punta en POS y e-commerce sin romper los flujos de venta existentes.

## Specific Objectives
1. Validar que la configuracion de promociones por producto, categoria y compra general sea consistente en backend y frontend.
2. Exponer descuentos activos de promociones por producto/categoria en las cards de POS y e-commerce, incluyendo productos que califican por categoria.
3. Recalcular promociones y cupones en backend como fuente de verdad al vender por POS, checkout normal y checkout WhatsApp.
4. Persistir en la orden el total correcto, `discount_amount`, detalles de promociones y uso de cupones con importes separados.
5. Crear pagos por el `grand_total` final de la orden despues de descuentos, incluyendo Wompi y metodos manuales.
6. Mostrar en detalle de orden, confirmaciones y resumen de checkout los descuentos aplicados sin recalcular ordenes historicas.
7. Cubrir regresiones de venta sin promociones, venta con solo cupon, venta con promocion por producto, categoria y compra general.

## Approach Chosen
Centralizar el calculo promocional en backend reutilizando `PromotionEngineService`, `CouponsService` y `PriceResolverService`, y exponer una respuesta de cotizacion/descuento que consuman catalogo, POS, checkout y ordenes. Este enfoque mantiene el backend como fuente de verdad economica, permite que frontend solo muestre estimaciones o snapshots devueltos por API, y evita duplicar reglas de elegibilidad en cada pantalla.

## Alternatives Considered
- Mantener el calculo principal en frontend y solo guardar IDs en backend: se rechaza porque permite diferencias entre UI, orden y pago, y ya es la raiz del bug actual en POS.
- Aplicar promociones directamente sobre `final_price` de productos en base de datos: se rechaza porque mezclaria snapshots temporales con precio base/sale price, romperia ordenes historicas y afectaria flujos sin promociones.
- Crear un segundo motor de promociones exclusivo para e-commerce: se rechaza porque duplicaria reglas existentes y haria que POS y e-commerce diverjan.

## Critical Files
- `apps/backend/src/domains/store/promotions/promotion-engine/promotion-engine.service.ts` - motor base para elegibilidad, calculo y persistencia de promociones.
- `apps/backend/src/domains/store/promotions/promotions.service.ts` - configuracion, validacion y consulta de promociones activas.
- `apps/backend/src/domains/store/promotions/promotions.module.ts` - exporta el motor para otros dominios.
- `apps/backend/src/domains/store/promotions/dto/create-promotion.dto.ts` - contrato de creacion/edicion de promociones.
- `apps/backend/src/domains/store/coupons/coupons.service.ts` - validacion y registro de cupones.
- `apps/backend/src/domains/store/coupons/coupons.module.ts` - exporta cupones para checkout/pagos.
- `apps/backend/src/domains/store/products/products.service.ts` - listado POS y datos de productos con promociones activas.
- `apps/backend/src/domains/store/products/products.module.ts` - composicion de dependencias de productos.
- `apps/backend/src/domains/store/products/services/price-resolver.service.ts` - calculo base/sale/tax actual de productos y variantes.
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.ts` - catalogo publico y `has_discount`.
- `apps/backend/src/domains/ecommerce/catalog/catalog.module.ts` - dependencias de catalogo.
- `apps/backend/src/domains/ecommerce/catalog/dto/catalog-query.dto.ts` - filtros de catalogo con descuentos.
- `apps/backend/src/domains/ecommerce/cart/cart.service.ts` - precios y resumen de carrito autenticado.
- `apps/backend/src/domains/ecommerce/cart/cart.module.ts` - dependencias de carrito.
- `apps/backend/src/domains/ecommerce/checkout/checkout.service.ts` - creacion de orden, pago y Wompi desde e-commerce.
- `apps/backend/src/domains/ecommerce/checkout/checkout.module.ts` - dependencias de checkout.
- `apps/backend/src/domains/ecommerce/checkout/dto/checkout.dto.ts` - payload normal de checkout.
- `apps/backend/src/domains/ecommerce/checkout/dto/whatsapp-checkout.dto.ts` - payload checkout WhatsApp.
- `apps/backend/src/domains/ecommerce/account/account.service.ts` - detalle de orden e-commerce.
- `apps/backend/src/domains/store/payments/payments.service.ts` - venta POS, persistencia de orden y pago.
- `apps/backend/src/domains/store/payments/dto/create-pos-payment.dto.ts` - payload de pagos POS con promociones/cupones.
- `apps/backend/src/domains/store/orders/orders.service.ts` - lectura y detalle de ordenes store.
- `apps/backend/src/domains/store/orders/dto/create-order.dto.ts` - contrato de ordenes store.
- `apps/frontend/src/app/private/modules/store/marketing/promotions/components/promotion-form-modal/promotion-form-modal.component.ts` - formulario de promociones.
- `apps/frontend/src/app/private/modules/store/marketing/promotions/interfaces/promotion.interface.ts` - tipos frontend de promociones.
- `apps/frontend/src/app/private/modules/store/marketing/promotions/services/promotions.service.ts` - llamadas frontend de promociones.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-product.service.ts` - tipos y mapeo de productos POS.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-product-selection.component.ts` - cards de productos POS.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.ts` - descuentos, promociones y cupones en carrito POS.
- `apps/frontend/src/app/private/modules/store/pos/cart/pos-cart.component.ts` - resumen POS y cupones.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts` - payloads de venta POS.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts` - confirmacion de venta POS.
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` - detalle de orden store.
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html` - visualizacion de descuentos store.
- `apps/frontend/src/app/private/modules/ecommerce/services/catalog.service.ts` - tipos y filtros de catalogo e-commerce.
- `apps/frontend/src/app/private/modules/ecommerce/components/product-card/product-card.component.ts` - card de producto e-commerce.
- `apps/frontend/src/app/private/modules/ecommerce/services/cart.service.ts` - carrito e-commerce autenticado/invitado.
- `apps/frontend/src/app/private/modules/ecommerce/pages/cart/cart.component.ts` - resumen visual de carrito e-commerce.
- `apps/frontend/src/app/private/modules/ecommerce/services/checkout.service.ts` - contrato frontend de checkout.
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts` - flujo de checkout, Wompi y resumen.
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.html` - visualizacion de totales checkout.
- `apps/frontend/src/app/private/modules/ecommerce/pages/account/order-detail/order-detail.component.ts` - detalle de orden e-commerce.
- `apps/frontend/src/app/private/modules/ecommerce/pages/account/order-detail/order-detail.component.html` - visualizacion de descuentos e-commerce.
- `apps/backend/src/domains/store/promotions/promotion-engine/promotion-engine.service.spec.ts` - pruebas nuevas del motor/cotizacion promocional.
- `apps/backend/src/domains/store/payments/payments.service.spec.ts` - regresiones POS.
- `apps/backend/src/domains/ecommerce/checkout/checkout.service.spec.ts` - pruebas nuevas de checkout con descuentos.
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.spec.ts` - regresiones de catalogo e-commerce.
- `apps/backend/src/domains/store/products/products.service.spec.ts` - regresiones de listado POS.

## Reusable Assets
- `apps/backend/src/domains/store/promotions/promotion-engine/promotion-engine.service.ts` - ya valida fechas, uso, scope y calcula descuentos por orden/producto/categoria.
- `apps/backend/src/domains/store/promotions/promotions.service.ts` - ya valida seleccion de productos/categorias y devuelve promociones activas.
- `apps/backend/src/domains/store/coupons/coupons.service.ts` - ya valida cupones por producto/categoria/compra total y calcula `discount_amount`.
- `apps/backend/src/domains/store/products/services/price-resolver.service.ts` - resuelve precio base, sale price, impuestos y variantes sin mezclar promociones temporales.
- `apps/frontend/src/app/shared/services/pricing/price-resolver.service.ts` - patron frontend existente para resolver precios de productos/variantes.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.ts` - ya tiene aplicacion local de promociones/cupones para UX POS.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-api.service.ts` - ya consulta promociones activas y valida cupones.
- `apps/frontend/src/app/shared/pipes/currency/currency.pipe.ts` - formato de moneda centralizado.
- `apps/frontend/src/app/shared/components/modal/modal.component.ts` - modal estandar para configuracion sin crear UI paralela.
- `apps/backend/src/common/responses/response.service.ts` - respuestas API consistentes.
- `apps/backend/src/prisma/services/store-prisma.service.ts` - scoping multi-tenant de `order_promotions` y entidades store.

## Steps
1. Formalizar la cotizacion promocional backend
   Skills: vendix-business-analysis, vendix-product-pricing, vendix-calculated-pricing, vendix-backend, vendix-prisma-scopes, vendix-validation, vendix-naming-conventions
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/store/promotions/promotion-engine/promotion-engine.service.spec.ts`
   Business decision: El backend es la fuente de verdad; promociones `is_auto_apply` aplican automaticamente, promociones manuales solo aplican si llegan por ID, cupones siguen siendo separados, y los descuentos se calculan sobre totales de productos antes de shipping.
   Why: Va primero porque POS, catalogo, checkout, orden y pago deben consumir el mismo resultado economico para no divergir.
   Output: `PromotionEngineService` con metodo de cotizacion reusable que devuelve descuentos por promocion, descuento total, precio promocional por item/producto y metadata para persistir `order_promotions`.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/store/promotions/promotion-engine/promotion-engine.service.spec.ts` cubre promocion por producto, categoria, orden, cap maximo, min purchase, no elegible y stacking existente.
2. Endurecer configuracion de promociones
   Skills: vendix-backend-api, vendix-validation, vendix-frontend, vendix-angular-forms, vendix-zoneless-signals, vendix-frontend-modal, vendix-ui-ux
   Resources: `npm run zoneless:audit`
   Business decision: Promocion por producto requiere productos, promocion por categoria requiere categorias, promocion de compra general no requiere seleccion, y una promocion invalida no debe quedar guardada ni parecer activa en venta.
   Why: Debe corregirse antes de confiar en promociones activas, porque el motor depende de datos de configuracion coherentes.
   Output: Validaciones backend/frontend alineadas, mensajes claros en el modal de promocion y payloads normalizados para productos/categorias/compra general.
   Verification: `npm run zoneless:audit` valida patrones Angular; prueba manual en `http://localhost:4200/store/marketing/promotions` crea/edita una promocion por producto, una por categoria y una general sin errores visuales ni de validacion.
3. Mostrar promociones activas en cards POS y e-commerce
   Skills: vendix-backend, vendix-backend-api, vendix-product-pricing, vendix-calculated-pricing, vendix-frontend, vendix-frontend-component, vendix-frontend-icons, vendix-currency-formatting, vendix-ui-ux, vendix-zoneless-signals
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/ecommerce/catalog/catalog.service.spec.ts src/domains/store/products/products.service.spec.ts`
   Business decision: Las cards muestran precio promocional y badge solo para promociones activas por producto/categoria; `base_price`, `sale_price` y `final_price` historicos no se sobrescriben, y `has_discount=true` incluye sale price o promocion activa.
   Why: Va despues de la cotizacion porque la UI no debe duplicar reglas ni inventar descuentos distintos a los del backend.
   Output: Catalogo e-commerce y listado POS devuelven campos de promocion activa, y las cards muestran precio original, precio con promo y etiqueta de descuento sin cambiar disponibilidad ni stock.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/ecommerce/catalog/catalog.service.spec.ts src/domains/store/products/products.service.spec.ts` valida producto directo, categoria y filtro `has_discount`.
4. Corregir calculo de venta POS y registro de pagos
   Skills: vendix-backend, vendix-backend-api, vendix-payment-processors, vendix-prisma-scopes, vendix-validation, vendix-currency-formatting, vendix-frontend, vendix-zoneless-signals
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/store/payments/payments.service.spec.ts`
   Business decision: POS puede mostrar una estimacion local, pero `processPosPayment` recalcula promociones/cupones en backend, actualiza `orders.discount_amount` y `orders.grand_total`, registra `order_promotions` y `coupon_uses` con importes separados, y crea el pago por el `grand_total` final de la orden.
   Why: Corrige el flujo de venta inmediato y evita que descuentos manipulados en frontend creen pagos u ordenes inconsistentes.
   Output: Venta POS con promociones/cupones genera orden, detalles de descuentos y pago con totales correctos; venta POS sin descuentos conserva el comportamiento actual.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/store/payments/payments.service.spec.ts` cubre venta sin promo, con promo producto, con promo categoria, con promo general, con cupon y con promo+cupon.
5. Corregir checkout e-commerce normal y WhatsApp
   Skills: vendix-ecommerce-checkout, vendix-customer-auth, vendix-payment-processors, vendix-backend, vendix-backend-api, vendix-multi-tenant-context, vendix-prisma-scopes, vendix-product-pricing, vendix-calculated-pricing, vendix-validation
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/ecommerce/checkout/checkout.service.spec.ts`
   Business decision: Checkout aplica promociones automaticas activas sobre items elegibles, aplica cupon solo cuando el payload lo provee y lo valida, excluye shipping de la base de descuento, y Wompi/metodos manuales usan siempre el `order.grand_total` persistido.
   Why: Va despues de POS porque reutiliza la misma cotizacion y cierra el mayor hueco actual del e-commerce.
   Output: Checkout normal y WhatsApp crean orden con `discount_amount`, detalles de promociones/cupon y pago por total final; frontend envia/recibe campos de descuento y muestra resumen consistente.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/ecommerce/checkout/checkout.service.spec.ts` cubre checkout invitado/autenticado, WhatsApp, Wompi, promocion por categoria y cupon invalido.
6. Mostrar detalles de descuentos en ordenes y confirmaciones
   Skills: vendix-backend-api, vendix-frontend, vendix-frontend-data-display, vendix-currency-formatting, vendix-zoneless-signals, vendix-ui-ux
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/store/orders/orders.service.spec.ts`
   Business decision: Las ordenes muestran snapshots persistidos de descuentos aplicados, no recalculan contra promociones activas actuales, para preservar historico fiscal/comercial.
   Why: Va despues de persistir descuentos, porque las pantallas deben leer datos reales de orden y no estados temporales del carrito.
   Output: Detalle store, detalle e-commerce, confirmacion POS y resumen de checkout muestran subtotal, promociones, cupones, descuento total, shipping y total final con nombres/importes.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/store/orders/orders.service.spec.ts` valida que el detalle incluya promociones/cupones; `npm run zoneless:audit` valida cambios frontend.
7. Verificacion integral y regresion de flujos sin promocion
   Skills: buildcheck-dev, vendix-bruno-test, vendix-backend, vendix-frontend, vendix-ecommerce-checkout, vendix-payment-processors
   Resources: `docker logs --tail 40 vendix_backend`; `docker logs --tail 40 vendix_frontend`; `docker ps`
   Business decision: El fix no puede cambiar el resultado de ventas sin promociones, ni bloquear configuraciones existentes de POS/e-commerce, ni introducir errores de watch-mode.
   Why: Cierra la ejecucion validando que los cambios cruzados no dejaron errores de runtime ni regresiones economicas basicas.
   Output: Resultado verificado en pruebas unitarias, auditoria zoneless, logs backend/frontend y recorrido manual POS/e-commerce.
   Verification: `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend` y `docker ps` sin errores relevantes; recorrido manual crea venta POS sin promo, venta POS con promo, checkout e-commerce sin promo y checkout e-commerce con promo.

## End-to-End Verification
1. `npm run test -w apps/backend -- --runInBand src/domains/store/promotions/promotion-engine/promotion-engine.service.spec.ts src/domains/store/payments/payments.service.spec.ts src/domains/ecommerce/checkout/checkout.service.spec.ts src/domains/ecommerce/catalog/catalog.service.spec.ts src/domains/store/products/products.service.spec.ts src/domains/store/orders/orders.service.spec.ts`
2. `npm run zoneless:audit`
3. `docker logs --tail 40 vendix_backend`
4. `docker logs --tail 40 vendix_frontend`
5. `docker ps`
6. Manual UI check at `http://localhost:4200/store/marketing/promotions`, `http://localhost:4200/store/pos`, `http://localhost:4200/products`, `http://localhost:4200/cart`, and `http://localhost:4200/checkout`: create product/category/general promotions, verify badges, create POS/e-commerce orders, and confirm order/payment totals match.

## Knowledge Gaps
- No existe una skill dedicada a promociones/cupones de venta end-to-end. Este fix formaliza un patron economico nuevo entre configuracion, catalogo, POS, checkout, orden y pago; al estabilizarlo se debe proponer una skill `vendix-promotions` para documentar reglas de stacking, base de descuento, snapshots historicos y verificacion.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
