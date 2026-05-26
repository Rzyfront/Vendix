## Context

Los productos y servicios necesitan un enlace único de compra online y un QR asociado, visibles desde la vista de edición/detalle del producto. El enlace debe construirse exclusivamente con el dominio activo de la tienda para `STORE_ECOMMERCE`, usando la ruta pública existente `/products/:slug`. Hoy el catálogo ya tiene `slug`, `available_for_ecommerce`, `store_settings.settings.ecommerce`, `domain_settings` activos y un `QrService`, pero el producto no persiste ni expone metadatos de compra online.

## General Objective

Cada producto o servicio de tienda puede mostrar, copiar, abrir y generar su enlace/QR de compra online desde la edición/detalle, siempre usando el dominio activo principal de ecommerce de la tienda.

## Specific Objectives

1. Agregar campos persistidos al modelo `products` para `online_purchase_url`, `online_purchase_qr_code`, `online_purchase_domain_id` y `online_purchase_generated_at`.
2. Crear lógica backend que resuelva elegibilidad ecommerce, dominio activo `STORE_ECOMMERCE`, URL pública `/products/:slug` y QR data URL con `QrService`.
3. Autogenerar o refrescar el link/QR al crear o actualizar productos cuando la tienda tenga configuración ecommerce válida y dominio activo.
4. Exponer un endpoint manual para generar o regenerar link/QR cuando un producto existente no lo tenga.
5. Mostrar en la página de edición/detalle del producto una sección de compra online con QR, link, copiar, abrir y generar/regenerar.
6. Verificar migración, backend, frontend y logs Docker de los servicios afectados.

## Approach Chosen

Persistir los metadatos de compra online directamente en `products` y mantenerlos desde `ProductsService`. Este enfoque permite detectar realmente cuándo un producto "no tiene" link/QR, mostrar la acción manual en UI, y conservar un contrato estable para web, POS, mobile o futuros canales sin recalcular QR en cada render. La generación se mantiene idempotente y se refresca cuando el slug o dominio activo cambia.

## Alternatives Considered

- Calcular link/QR solo bajo demanda sin persistir: rechazado porque no permite distinguir productos existentes sin QR/link y obliga a regenerar QR en cada lectura.
- Guardar solo la URL y generar el QR en frontend con `qrcode`: rechazado porque duplicaría reglas de dominio y QR en clientes; el backend ya tiene `QrService`.
- Crear una tabla separada `product_online_purchase_links`: rechazado por sobre-diseño; el requerimiento es exactamente un link/QR por producto o servicio.

## Critical Files

- `apps/backend/prisma/schema.prisma` — añadir campos persistidos de compra online en `products`.
- `apps/backend/prisma/migrations/<timestamp>_add_product_online_purchase_link_qr/migration.sql` — migración idempotente para las nuevas columnas e índice de dominio.
- `apps/backend/src/domains/store/products/products.service.ts` — resolver dominio ecommerce activo, generar URL/QR, autogenerar en create/update/findOne y endpoint manual.
- `apps/backend/src/domains/store/products/products.controller.ts` — exponer `POST /store/products/:id/online-purchase-link`.
- `apps/backend/src/domains/store/products/products.module.ts` — registrar `QrService` para el módulo de productos.
- `apps/backend/src/domains/store/products/products.service.spec.ts` — cubrir generación, ausencia de dominio/config y refresh por cambio de slug.
- `apps/frontend/src/app/private/modules/store/products/interfaces/product.interface.ts` — añadir tipos de metadatos y respuesta de generación.
- `apps/frontend/src/app/private/modules/store/products/services/products.service.ts` — método para llamar el endpoint manual.
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts` — estado y acciones de UI para link/QR en edición.
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.html` — sección visual en la vista de edición/detalle.

## Reusable Assets

- `apps/backend/src/common/services/qr.service.ts` — genera QR como data URL o buffer; se reutiliza para el QR de compra online.
- `apps/backend/src/domains/store/ecommerce/ecommerce.service.ts` — patrón de lectura de `store_settings.settings.ecommerce` y dominio ecommerce activo.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — `mergeStoreSettingsWithDefaults()` para leer configuración ecommerce sin caer en defaults incompletos.
- `apps/backend/src/prisma/services/store-prisma.service.ts` — acceso scopeado a `products`, `domain_settings` y `store_settings`.
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.*` — pantalla real de creación/edición de productos y servicios.
- `apps/frontend/src/app/shared/components/icon/icons.registry.ts` — ya tiene `link`, `copy`, `external-link`, `download`, `refresh-cw` y `shopping-cart`.

## Steps

1. Persistir metadatos de link/QR en productos
   Skills: vendix-prisma, vendix-prisma-schema, vendix-prisma-migrations, vendix-product-variants
   Resources: `npm run prisma:generate -w apps/backend`
   Business decision: cada producto o servicio tiene como máximo un link/QR de compra online persistido, ligado al dominio ecommerce activo usado para generarlo.
   Why: va primero porque backend y frontend necesitan un contrato de datos real para detectar productos sin link/QR y evitar recomputar QR en cada lectura.
   Output: campos `online_purchase_url`, `online_purchase_qr_code`, `online_purchase_domain_id`, `online_purchase_generated_at` en `products`, más FK nullable a `domain_settings` si Prisma lo permite sin conflicto.
   Verification: revisar `migration.sql` y ejecutar `npm run prisma:generate -w apps/backend`.

2. Implementar generador backend de link/QR
   Skills: vendix-backend, vendix-backend-api, vendix-prisma-scopes, vendix-settings-system, vendix-app-architecture, vendix-multi-tenant-context
   Resources: `none`
   Business decision: la URL solo se genera si existe configuración ecommerce real/habilitada y un dominio activo con `app_type='STORE_ECOMMERCE'`; no se usa dominio landing/admin como fallback.
   Why: este paso centraliza la regla de negocio antes de conectar create/update o la UI, evitando que cada consumidor invente el dominio.
   Output: métodos privados en `ProductsService` para resolver dominio activo, construir `https://{hostname}/products/{slug}`, generar QR con `QrService`, detectar staleness y devolver estado de elegibilidad.
   Verification: test unitario en `products.service.spec.ts` que valide URL con dominio ecommerce activo y que no genere con dominio ausente.

3. Autogenerar en create/update y exponer endpoint manual
   Skills: vendix-backend, vendix-backend-api, vendix-permissions, vendix-prisma-scopes
   Resources: `curl -X POST -H 'Authorization: Bearer $STORE_TOKEN' http://localhost:3000/store/products/1/online-purchase-link`
   Business decision: create/update intentan generar automáticamente cuando la tienda está lista; productos existentes sin link/QR se generan con acción manual desde edición.
   Why: depende del helper del paso 2 y desbloquea el caso principal del usuario: productos nuevos y existentes.
   Output: `POST /store/products/:id/online-purchase-link` protegido con `store:products:update`, y respuestas de `findOne/create/update` con campos `online_purchase_*`.
   Verification: test de controller/service para el endpoint y curl local que retorne `{ url, qr_data_url, domain_hostname }`.

4. Integrar UI en edición/detalle del producto
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-frontend-component, vendix-frontend-icons, vendix-ui-ux
   Resources: `apps/frontend/scripts/zoneless-audit.sh`
   Business decision: la sección aparece solo en modo edición/detalle; si hay link/QR muestra QR, URL, copiar y abrir; si falta muestra "Generar link y QR"; si la tienda no está lista explica que falta configurar/publicar ecommerce o dominio activo.
   Why: va después del endpoint para que la UI consuma un contrato estable y no replique reglas de dominio.
   Output: sección "Compra online" en `product-create-page.component.html` y estado signal-based en `product-create-page.component.ts`.
   Verification: `apps/frontend/scripts/zoneless-audit.sh` sin nuevas violaciones y prueba manual en `/admin/products/edit/:id`.

5. Cobertura y verificación de desarrollo
   Skills: buildcheck-dev, vendix-backend, vendix-frontend
   Resources: `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`, `docker logs --tail 40 vendix_postgres`, `docker ps`
   Business decision: la tarea no queda completa hasta que los servicios afectados estén compilando/corriendo sin errores relevantes en watch-mode.
   Why: va al final porque valida la integración real de migración, NestJS y Angular bajo el entorno de desarrollo del repo.
   Output: cambios verificados contra logs Docker y pruebas unitarias/zoneless ejecutadas según aplique.
   Verification: logs de `vendix_backend`, `vendix_frontend`, `vendix_postgres` sin errores relevantes y `docker ps` con servicios activos.

## End-to-End Verification

1. Crear o editar un producto activo y disponible para ecommerce en una tienda con `store_settings.settings.ecommerce.enabled=true` y dominio principal activo `STORE_ECOMMERCE`; `GET /store/products/:id` devuelve `online_purchase_url` con `/products/:slug` y `online_purchase_qr_code` data URL.
2. En `/admin/products/edit/:id`, la sección "Compra online" muestra QR, link, botón copiar y botón abrir; al cambiar el slug y guardar, el link se refresca al nuevo slug.
3. Para un producto existente sin metadatos, `POST /store/products/:id/online-purchase-link` genera y persiste link/QR; la UI cambia de estado sin recargar toda la página.
4. Para una tienda sin dominio ecommerce activo, el endpoint responde con estado no generado/mensaje claro y la UI muestra la acción bloqueada con explicación.
5. `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`, `docker logs --tail 40 vendix_postgres` y `docker ps` completan sin errores relevantes.

## Knowledge Gaps

- No existe una skill específica para "product online purchase links/QR". Si este patrón se repite para variantes, campañas o menús QR, conviene crear una skill nueva después de estabilizar la implementación.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
