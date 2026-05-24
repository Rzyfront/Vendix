# POS Stock Scope Fix — Server-Side Filtering

## Context

POS está mostrando stock agregado de todas las bodegas activas aunque `settings.inventory.pos_stock_scope === 'main_location'` esté configurado. La causa es una cadena de datos rota en cuatro puntos: (a) el login no expone `default_location_id` del store activo, (b) `products.service.findAll()` con `pos_optimized=true` no aplica `resolvePosStockScope`, (c) `sumVariantStock` agrega sin filtro por bodega, y (d) el `select` de Prisma para `stock_levels` omite `location_id` plano, impidiendo el filtro client-side. El resultado neto es que el frontend siempre degrada a la rama "all_locations" y la configuración no surte efecto.

## General Objective

El endpoint `/store/products?pos_optimized=true` devuelve cantidades de stock que respetan el `pos_stock_scope` configurado, y el frontend POS las consume sin lógica adicional de filtrado.

## Specific Objectives

1. `products.service.findAll()` con `pos_optimized=true` resuelve el scope vía `resolvePosStockScope(store, settings)` y devuelve solo stock de `mainLocationId` cuando el scope es `main_location`.
2. `product.stock_quantity` y `variant.stock` / `variant.stock_quantity` retornados por el endpoint POS reflejan el stock filtrado por bodega, no la suma denormalizada.
3. El login (`auth.service.ts`) expone `default_location_id` en `cleanStore` con la misma forma que `environment-switch.service.ts`, garantizando paridad de contrato.
4. `pos-product.service.transformProducts()` deja de filtrar client-side y confía en los valores ya scopeados del backend, eliminando la rama defensiva `useMainLocationOnly`.
5. Una llamada POS contra una tienda con `pos_stock_scope='main_location'` retorna `stock_quantity` igual al disponible solo en la bodega principal; cambiar a `all_locations` retorna la suma global.

## Approach Chosen

Filtrado **server-side** en la rama `pos_optimized` de `products.service.findAll()` aplicando `where: { location_id: mainLocationId }` al include de `stock_levels` (producto y variantes), recalculando `stock_quantity` del producto desde las filas filtradas, y dejando que `sumVariantStock` agregue sobre datos ya scopeados (sin cambio de firma). El frontend se simplifica: elimina la lógica `useMainLocationOnly` porque los datos ya llegan correctos.

Razones: (1) el helper `resolvePosStockScope` ya existe y se usa idénticamente en `stock-levels.service.ts:277` — patrón probado; (2) filtrar al nivel de Prisma `where` garantiza que `quantity_available` se calcule sobre el set correcto, evitando inconsistencias entre `stock_quantity` (denormalizado) y `stock_levels[]`; (3) un único lugar de autoridad evita la duplicación de reglas en cada cliente (web, mobile, futuros consumidores).

## Alternatives Considered

- **Filtrar en el frontend (estado actual):** rechazado. Requiere que el backend exponga `location_id` plano en cada `stock_levels` row y que cada cliente (web, mobile, dispatch-notes) reimplante el filtro. Multiplica los puntos de fallo y ya tiene la fuga estructural que produjo el bug.
- **Añadir un parámetro `?location_id=` opcional al endpoint POS:** rechazado. Empuja la decisión al cliente, contradice el contrato "el scope vive en `store_settings`" y abre la puerta a clientes maliciosos pidiendo cualquier bodega.
- **Aplicar el filtro también a la rama no-`pos_optimized`:** rechazado. Ese path lo consumen pantallas de admin y `dispatch-notes` que necesitan ver el stock total — el scope POS no aplica fuera de POS.

## Critical Files

- `apps/backend/src/domains/store/products/products.service.ts` — `findAll()` rama `pos_optimized` añade resolución de scope y aplica filtro al include; recálculo de `stock_quantity`.
- `apps/backend/src/domains/store/inventory/shared/helpers/pos-stock-scope.helper.ts` — helper canónico `resolvePosStockScope` (sin cambios, solo se consume).
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — `mergeStoreSettingsWithDefaults` (sin cambios, solo se consume).
- `apps/backend/src/domains/auth/auth.service.ts:1870-1882` — `cleanStore` del login: añadir `default_location_id`.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-product.service.ts` — `transformProducts()`, `getPosStockScope()`, `getDefaultLocationId()`: simplificar y eliminar la lógica defensiva client-side.
- `bruno/Vendix/Store/Products/Filters/POS Stock Scope - main_location.bru` — nuevo test que verifica el filtrado server-side.
- `bruno/Vendix/Store/Products/Filters/POS Stock Scope - all_locations.bru` — nuevo test que verifica el path opuesto.

## Reusable Assets

- `apps/backend/src/domains/store/inventory/shared/helpers/pos-stock-scope.helper.ts` — `resolvePosStockScope(store, settings)` devuelve `{ scope, mainLocationId }` ya con fallback defensivo cuando `default_location_id` es null. Reutilizamos sin modificar.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts:350` — `mergeStoreSettingsWithDefaults()` ya merge defaults con el JSON persistido; mismo patrón que `stock-levels.service.ts:320`.
- `apps/backend/src/common/context/request-context.service.ts` — `RequestContextService.getStoreId()` para resolver el store activo, idéntico al uso en `stock-levels.service.ts:291`.
- `apps/backend/src/prisma/services/store-prisma.service.ts` — el `StorePrismaService` ya scopea `stock_levels` vía la relación `inventory_locations`, así que no hay riesgo de fuga multi-tenant al introducir el `where.location_id`.

## Steps

1. Resolver scope y cargar store + settings en `findAll(pos_optimized)`
   Skills: vendix-inventory-stock, vendix-prisma-scopes, vendix-multi-tenant-context, vendix-backend-domain
   Resources: `none` (no external resources; lee del repo)
   Business decision: el POS solo descuenta y muestra stock de la bodega principal cuando `pos_stock_scope='main_location'`. La autoridad de esta regla vive en `store_settings.inventory`, no en el cliente.
   Why: este paso debe ir primero porque todos los siguientes (filtro de include, recálculo, simplificación del frontend) dependen del valor de `mainLocationId`. Sin esta resolución no hay forma de scopear.
   Output: dentro de la rama `pos_optimized` de `findAll()`, antes del `findMany`, se obtiene `const { scope, mainLocationId } = resolvePosStockScope(storeRef, mergedSettings);` reutilizando `loadStoreScopeRef` y `loadMergedSettings` con la misma forma usada en `stock-levels.service.ts:268-321` (extraer ambos helpers a métodos privados de `ProductsService` o inyectar `StockLevelsService` — decidir durante implementación basado en circular-dep).
   Verification: `npm run build -w apps/backend` exit 0 + un test unitario stub que verifique que `resolvePosStockScope` se invoca cuando `pos_optimized=true` (extender `apps/backend/src/domains/store/products/products.service.spec.ts` `describe('findAll')`).

2. Aplicar `where: { location_id: mainLocationId }` al include de `stock_levels` (producto + variantes) cuando `scope === 'main_location'`
   Skills: vendix-prisma-scopes, vendix-inventory-stock, vendix-backend-domain
   Resources: `none`
   Business decision: el filtro vive a nivel de Prisma `where` (no map/filter en memoria) para que `quantity_available` y `quantity_reserved` se calculen sobre exactamente el set que el scope dicta y para mantener una sola fuente de verdad por fila.
   Why: va segundo porque depende del `mainLocationId` resuelto en paso 1. Antes del paso 3 (recálculo de `stock_quantity`) porque el recálculo opera sobre el resultado de este include.
   Output: en `products.service.ts` líneas 683-697 y 717-731 el include condicional de `stock_levels` recibe `where: scope === 'main_location' ? { location_id: mainLocationId } : undefined`. Para la rama `all_locations` el comportamiento es idéntico al actual.
   Verification: `curl -H 'Authorization: Bearer $TOK' 'http://localhost:3000/store/products?pos_optimized=true&include_stock=true&limit=1'` en una tienda con `pos_stock_scope='main_location'` devuelve `data[0].stock_levels` solo con filas cuyo `inventory_locations.id === default_location_id`.

3. Recalcular `stock_quantity` del producto base en `pos_optimized` desde las `stock_levels` filtradas; mantener `sumVariantStock` sin firma nueva
   Skills: vendix-inventory-stock, vendix-backend-domain
   Resources: `none`
   Business decision: el campo denormalizado `products.stock_quantity` mezcla bodegas y no es fiable bajo `main_location` scope; el contrato POS debe devolver el valor scopeado calculado en el momento, no el denormalizado.
   Why: va tercero porque ya tenemos las `stock_levels` filtradas (paso 2). Si lo hiciéramos antes, recalcularíamos sobre datos sin filtrar. `sumVariantStock` no cambia de firma porque ya recibe las filas filtradas del include — la agregación es transparente al scope.
   Output: en el bloque `pos_optimized` (línea 791 aprox.), el objeto retornado reemplaza `stock_quantity: product.stock_quantity` por `stock_quantity: product.stock_levels.reduce((s, l) => s + (l.quantity_available ?? 0), 0)`. Las variantes mantienen `stock: variantStock` y `stock_quantity: variantStock` calculados con `sumVariantStock(variant)` sobre el `variant.stock_levels` ya filtrado.
   Verification: extender `apps/backend/src/domains/store/products/products.service.spec.ts` con un caso `findAll({ pos_optimized: true })` que mockee `stock_levels` de dos bodegas y verifique que `data[0].stock_quantity` equivale solo a la bodega principal cuando el scope mock retorna `main_location`.

4. Exponer `default_location_id` en `cleanStore` del login
   Skills: vendix-backend-auth, vendix-multi-tenant-context, vendix-backend-domain
   Resources: `none`
   Business decision: el frontend trata el store activo del login y el del `environment-switch` como contratos intercambiables; omitir `default_location_id` en el login crea una asimetría que el cliente compensa con código defensivo, contradiciendo el principio "una sola fuente de verdad".
   Why: este paso es independiente del filtrado server-side, pero es necesario para que cualquier UI (sourcing modal, location pickers, mobile) que aún dependa del valor lo reciba consistentemente tras un login fresco. Se ubica después de los cambios server-side para minimizar el riesgo de redeploy: el filtrado solo no requiere este cambio.
   Output: en `apps/backend/src/domains/auth/auth.service.ts` líneas 1870-1882 el objeto `cleanStore` añade `default_location_id: storeToUse.default_location_id` justo después de `onboarding`. Verificar que el `select`/`include` en la query que carga `active_store` ya devuelva `default_location_id` (si no, ampliarlo).
   Verification: `curl -X POST -H 'Content-Type: application/json' -d '{"email":"x@y.z","password":"..."}' http://localhost:3000/auth/login | jq '.data.user.store.default_location_id'` retorna un número (no undefined) para una tienda con bodega principal configurada. Bruno: extender `bruno/Vendix/.../auth/login.bru` con assertion `expect(res.body.data.user.store.default_location_id).to.be.a('number')`.

5. Simplificar `transformProducts` en `pos-product.service.ts`
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-inventory-stock
   Resources: `none`
   Business decision: el cliente confía en los valores del backend; remover lógica defensiva client-side reduce divergencia entre web/mobile y elimina rutas muertas de fallback que estaban enmascarando el bug.
   Why: va al final porque depende del comportamiento del backend ya corregido (pasos 1-3). Si se hiciera antes, el frontend mostraría 0 stock cuando `default_location_id` no está en el login.
   Output: en `apps/frontend/src/app/private/modules/store/pos/services/pos-product.service.ts:353-499`, eliminar `getPosStockScope()`, `getDefaultLocationId()`, `useMainLocationOnly`, y las ramas de filtrado por `defaultLocationId`. `totalStock` queda como `product.stock_quantity ?? 0`. Variants: `v.stock ?? v.stock_quantity ?? 0`. Conservar `_rawStockLevels` / `_rawStockQuantity` solo si siguen siendo útiles para debugging (revisar callers).
   Verification: `npm run build:prod -w apps/frontend` exit 0 + `npm run zoneless:audit` sin nuevas violaciones. Manual: abrir POS en tienda con `pos_stock_scope='main_location'` y verificar que un producto con stock en bodega A=10 / B=5 muestra 10 (no 15) en la tarjeta del POS.

6. Añadir cobertura Bruno para ambos modos de scope
   Skills: vendix-bruno-test, vendix-inventory-stock
   Resources: `bru run "bruno/Vendix/Store/Products/Filters/POS Stock Scope - main_location.bru" --env Local`
   Business decision: el contrato server-side debe estar protegido por un test que ejercite el path completo (settings + include + recálculo) para evitar regresiones futuras.
   Why: al final del plan porque los archivos `.bru` reflejan el comportamiento estabilizado del endpoint tras los pasos 1-3. No tiene sentido escribirlos antes de que el contrato exista.
   Output: dos archivos nuevos en `bruno/Vendix/Store/Products/Filters/`: `POS Stock Scope - main_location.bru` (setea `pos_stock_scope='main_location'` vía `PUT /store/settings`, luego `GET /store/products?pos_optimized=true&include_stock=true&limit=5` y verifica que cada `stock_levels[*].inventory_locations.id === default_location_id`) y `POS Stock Scope - all_locations.bru` (path opuesto, verifica que aparecen múltiples bodegas distintas).
   Verification: ambos `.bru` corren verde con `bru run --env Local`. La aserción primaria es la cardinalidad de `inventory_locations.id` distintos en `stock_levels`.

## End-to-End Verification

1. `npm run build -w apps/backend` exit 0 y `npm run build:prod -w apps/frontend` exit 0.
2. `bru run "bruno/Vendix/Store/Products/Filters/POS Stock Scope - main_location.bru" --env Local` y `bru run "bruno/Vendix/Store/Products/Filters/POS Stock Scope - all_locations.bru" --env Local` ambos verde.
3. Manual UI: en una tienda con dos bodegas (A=10 principal, B=5), abrir POS con `pos_stock_scope='main_location'` configurado en Settings → la tarjeta del producto muestra `Stock: 10`. Cambiar a `all_locations` → muestra `Stock: 15`. Recargar la página y reverificar (descarta caché de `transformProducts`).
4. Inspección de logs del backend (docker watch): `docker logs --tail 200 vendix-backend | grep -i 'resolvePosStockScope\|pos_optimized'` no debe arrojar errores ni warnings tras 5 requests del POS.
5. Regresión multi-tenant: con un token de Store A, llamar al endpoint y verificar (con el ID de bodega de Store B) que ninguna `stock_levels.inventory_locations.id` corresponde a la otra tienda. Confirma que `StorePrismaService` sigue scopeando correctamente sobre el include modificado.

## Knowledge Gaps

None.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
