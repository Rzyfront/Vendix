## Context

La tienda online actual renderiza un home simple con hero/slider y una grilla llamada "Productos destacados", pero esa grilla hoy sale de `sort_by='best_selling'` y no de un flag editable del producto. El slider guarda imagen, titulo y caption en `store_settings.settings.ecommerce.slider.photos`, pero no guarda accion por slide ni permite que el click del banner navegue a un destino configurable. Ya existen endpoints publicos para categorias y marcas, `categories.image_url`, `brands.logo_url` y un `CategoriesShowcaseComponent`, pero el home no lo usa, no hay showcase de marcas, y el admin solo captura URLs manuales para imagen/logo. La card de producto centraliza la experiencia en `ProductCardComponent`, pero hoy tiene borde visible, boton "Comprar" intrusivo y click a quick-view en vez de navegar directo al detalle. El worktree ya tiene cambios no relacionados en productos/precios/inventario, asi que la ejecucion debe inspeccionar y preservar esas ediciones antes de tocar archivos compartidos.

## General Objective

Convertir el home de `STORE_ECOMMERCE` en una experiencia configurable de merchandising con sliders accionables, secciones de categorias, marcas y productos destacados reales, y cards de producto mas ligeras orientadas a navegacion y compra rapida.

## Specific Objectives

1. Hacer que cada slide del slider pueda tener una accion configurable desde la configuracion ecommerce de la tienda.
2. Agregar al home secciones configurables para categorias, marcas y productos destacados en orden `hero -> categorias -> marcas -> destacados`.
3. Permitir administrar imagenes de categorias y logos/imagenes de marcas con flujo S3 correcto, guardando keys y firmando URLs solo al leer.
4. Agregar `products.is_featured` como flag persistente editable desde admin y consumible por el catalogo publico.
5. Redisenar `ProductCardComponent` para click directo a detalle, sin borde/boton de compra por defecto y con accion suave de agregar al carrito cuando aplique.
6. Mantener reglas de tenant scope, permisos, variantes, stock opcional, servicios con reserva, moneda, accesibilidad mobile-first y Zoneless Signals.

## Approach Chosen

Extender la arquitectura existente: usar `store_settings.settings.ecommerce` para configuracion visual/home/slider, reutilizar `CatalogService` publico para categorias/marcas/productos, crear solo un campo nuevo `products.is_featured` para el flag comercial, y mantener una sola card reutilizable para home/catalog/wishlist. Este enfoque minimiza tablas nuevas, respeta el sistema de settings vigente, evita duplicar contratos publicos y deja la tienda configurable desde el admin sin acoplar el layout a datos hardcodeados.

## Alternatives Considered

- Mantener "destacados" como `best_selling`: rechazado porque el usuario necesita un flag editorial manual por producto, no un ranking calculado por ventas.
- Guardar IDs destacados en `store_settings.ecommerce`: rechazado porque dificulta filtros, paginacion, busqueda publica, bulk update y administracion desde el producto.
- Crear una tabla nueva de merchandising/home sections: rechazado para esta fase porque categorias, marcas, slider y productos ya tienen modelos/config suficientes; seria sobre-diseno hasta necesitar campanas o programacion temporal.
- Hacer que toda la card agregue al carrito: rechazado porque rompe variantes/servicios con reserva y contradice el objetivo de llevar al detalle al hacer click en la card.

## Critical Files

- `apps/backend/prisma/schema.prisma` - agregar `products.is_featured` e indice por `store_id/is_featured`.
- `apps/backend/prisma/migrations/20260526193000_add_product_featured_flag/migration.sql` - migracion idempotente del flag destacado.
- `apps/backend/src/domains/store/products/dto/index.ts` - incluir `is_featured` en DTOs create/update/bulk si aplica.
- `apps/backend/src/domains/store/products/products.service.ts` - persistir, mapear y devolver `is_featured` en lecturas admin.
- `apps/backend/src/domains/ecommerce/catalog/dto/catalog-query.dto.ts` - aceptar filtro publico `is_featured`.
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.ts` - filtrar destacados, mapear `is_featured`, corregir orden de `config/public` antes de `:slug` si se usa.
- `apps/backend/src/domains/ecommerce/catalog/catalog.controller.ts` - conservar rutas publicas especificas antes del parametro `:slug`.
- `apps/backend/src/domains/store/ecommerce/dto/ecommerce-settings.dto.ts` - extender slider photos y home sections.
- `apps/backend/src/domains/store/ecommerce/ecommerce.service.ts` - sanitizar/firmar nueva metadata de slider/home sin guardar URLs firmadas.
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` - tipar `EcommerceSettings` con slider actions y home sections.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` - defaults para secciones y acciones.
- `apps/backend/src/domains/store/categories/categories.controller.ts` - endpoint de upload de imagen de categoria si no se reutiliza uno existente.
- `apps/backend/src/domains/store/categories/categories.service.ts` - subida/sanitizacion/signing de `image_url`.
- `apps/backend/src/domains/store/brands/brands.controller.ts` - endpoint de upload de logo/imagen de marca.
- `apps/backend/src/domains/store/brands/brands.service.ts` - subida/sanitizacion/signing de `logo_url`.
- `apps/backend/src/common/helpers/s3-path.helper.ts` - agregar path centralizado para marcas si falta.
- `apps/frontend/src/app/core/models/domain-config.interface.ts` - tipar ecommerce slider actions y home sections en dominio publico.
- `apps/frontend/src/app/private/modules/store/ecommerce/interfaces/index.ts` - tipar configuracion admin.
- `apps/frontend/src/app/private/modules/store/ecommerce/ecommerce.component.ts` - agregar controles de acciones de slider y secciones home.
- `apps/frontend/src/app/private/modules/store/ecommerce/ecommerce.component.html` - UI de configuracion de acciones/orden/limites de home.
- `apps/frontend/src/app/private/modules/store/ecommerce/services/ecommerce.service.ts` - consumir uploads/updates necesarios.
- `apps/frontend/src/app/private/modules/store/products/interfaces/product.interface.ts` - incluir `is_featured`.
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts` - control de "Producto destacado".
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.html` - toggle de destacado en disponibilidad/ecommerce.
- `apps/frontend/src/app/private/modules/store/products/components/product-list/product-list.component.ts` - mostrar badge/accion de destacado en lista admin si encaja.
- `apps/frontend/src/app/private/modules/store/products/pages/categories-page/components/category-form-modal.component.ts` - reemplazar URL manual por upload/preview manteniendo opcion URL/key si aplica.
- `apps/frontend/src/app/private/modules/store/products/pages/brands-page/components/brand-form-modal.component.ts` - upload/preview de logo/imagen de marca.
- `apps/frontend/src/app/private/modules/ecommerce/services/catalog.service.ts` - tipar `is_featured`, `is_featured` query, categorias y marcas.
- `apps/frontend/src/app/private/modules/ecommerce/pages/home/home.component.ts` - cargar configuracion y datos de categorias/marcas/destacados.
- `apps/frontend/src/app/private/modules/ecommerce/pages/home/home.component.html` - renderizar secciones home en el orden definido.
- `apps/frontend/src/app/private/modules/ecommerce/pages/home/home.component.scss` - layout responsive de secciones sin cards anidadas.
- `apps/frontend/src/app/private/modules/ecommerce/components/hero-banner/hero-banner.component.ts` - resolver acciones por slide y corregir autoplay con signals.
- `apps/frontend/src/app/private/modules/ecommerce/components/hero-banner/hero-banner.component.html` - hacer clickable el slide/CTA de forma accesible.
- `apps/frontend/src/app/private/modules/ecommerce/components/categories-showcase/categories-showcase.component.ts` - corregir query param y hacer configuracion por input.
- `apps/frontend/src/app/private/modules/ecommerce/components/categories-showcase/categories-showcase.component.html` - estado visual final para home.
- `apps/frontend/src/app/private/modules/ecommerce/components/categories-showcase/categories-showcase.component.scss` - estilo mas editorial y mobile-first.
- `apps/frontend/src/app/private/modules/ecommerce/components/brands-showcase/brands-showcase.component.ts` - nuevo showcase de marcas.
- `apps/frontend/src/app/private/modules/ecommerce/components/brands-showcase/brands-showcase.component.html` - grilla/lista de marcas.
- `apps/frontend/src/app/private/modules/ecommerce/components/brands-showcase/brands-showcase.component.scss` - estilo responsive.
- `apps/frontend/src/app/private/modules/ecommerce/components/product-card/product-card.component.ts` - redisenar comportamiento y estilos de card.
- `apps/frontend/src/app/private/modules/ecommerce/pages/catalog/catalog.component.ts` - aceptar `category`/`brand` y mantener compatibilidad con `category_id`.
- `apps/frontend/src/app/shared/components/icon/icons.registry.ts` - registrar iconos faltantes para acciones suaves si el registry no los tiene.

## Reusable Assets

- `apps/frontend/src/app/private/modules/ecommerce/components/categories-showcase/*` - ya lista categorias con imagen y skeleton, se adapta en vez de recrearla.
- `apps/frontend/src/app/private/modules/ecommerce/components/product-card/product-card.component.ts` - unica card compartida por home/catalog; es el lugar correcto para el rediseño.
- `apps/frontend/src/app/private/modules/ecommerce/services/cart.service.ts` - ya maneja carrito guest/autenticado y emite animacion de agregado.
- `apps/frontend/src/app/private/modules/ecommerce/services/catalog.service.ts` - ya expone productos, categorias y marcas publicas con `x-store-id`.
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.ts` - ya firma imagenes, filtra ecommerce y resuelve precios finales.
- `apps/backend/src/domains/store/ecommerce/ecommerce.service.ts` - patron actual para guardar config ecommerce en `store_settings.settings.ecommerce`.
- `apps/backend/src/common/services/s3.service.ts` y `apps/backend/src/common/helpers/s3-url.helper.ts` - subida, signing y sanitizacion de keys S3.
- `apps/backend/src/common/helpers/s3-path.helper.ts` - rutas S3 centralizadas para productos/categorias/slider.
- `apps/frontend/src/app/shared/components/{button,input,textarea,setting-toggle,modal,icon}` - controles existentes para admin sin crear primitivas nuevas.
- `apps/frontend/src/app/shared/pipes/currency/currency.pipe.ts` - formato monetario correcto en cards.

## Steps

1. Congelar el contrato real antes de editar
   Skills: vendix-core, how-to-dev, git-workflow, vendix-business-analysis
   Resources: `git status --short && git diff -- apps/backend/prisma/schema.prisma apps/backend/src/domains/store/products/dto/index.ts apps/frontend/src/app/private/modules/store/products/interfaces/product.interface.ts apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.html`
   Business decision: no se revierte ningun cambio existente del worktree; los nuevos ajustes se integran encima de las ediciones actuales de productos/precios/inventario.
   Why: va primero porque el repo esta sucio en archivos que el plan tocara y es obligatorio preservar trabajo ajeno.
   Output: mapa final de diffs activos y confirmacion de los puntos exactos donde insertar `is_featured` y UI sin pisar cambios.
   Verification: el diff revisado muestra que ninguna edicion no relacionada fue eliminada o reescrita.

2. Modelar configuracion ecommerce de home y slider accionable
   Skills: vendix-settings-system, vendix-backend-api, vendix-validation, vendix-s3-storage, vendix-prisma-scopes
   Resources: `npm run test -w apps/backend -- --runInBand src/domains/store/ecommerce/ecommerce.service.spec.ts`
   Business decision: las acciones de slider soportan `none`, `internal_url`, `external_url`, `product`, `category` y `brand`; las secciones home tienen `enabled`, `title`, `subtitle`, `limit` y `sort_order`, con orden por defecto hero, categorias, marcas y destacados.
   Why: este contrato debe existir antes de construir UI o home publico para que admin/backend/frontend hablen el mismo idioma.
   Output: DTOs, interfaces y defaults de `ecommerce.slider.photos[].action_*` y `ecommerce.home_sections`.
   Verification: test unitario de ecommerce settings prueba merge/defaults, preservacion de keys S3 y validacion de action payloads.

3. Persistir y exponer productos destacados
   Skills: vendix-prisma, vendix-prisma-schema, vendix-prisma-migrations, vendix-backend, vendix-backend-api, vendix-validation, vendix-prisma-scopes
   Resources: `npm run db:migrate:dev -w apps/backend -- --name add_product_featured_flag --create-only && npm run prisma:generate -w apps/backend`
   Business decision: "destacado" es una decision editorial por producto de tienda, independiente de ventas, ofertas y disponibilidad ecommerce; solo productos activos y `available_for_ecommerce=true` aparecen en el home publico.
   Why: va antes del home porque el frontend necesita consultar un filtro real y el admin necesita guardar el flag.
   Output: columna `products.is_featured`, indice tenant-friendly, DTOs/admin mapping y filtro publico `GET /ecommerce/catalog?is_featured=true`.
   Verification: revisar `apps/backend/prisma/migrations/20260526193000_add_product_featured_flag/migration.sql` y ejecutar `npm run test -w apps/backend -- --runInBand src/domains/ecommerce/catalog/catalog.service.spec.ts src/domains/store/products/products.service.spec.ts`.

4. Agregar media administrable para categorias y marcas
   Skills: vendix-backend, vendix-backend-api, vendix-permissions, vendix-backend-auth, vendix-validation, vendix-s3-storage, vendix-prisma-scopes
   Resources: `curl -X POST -H "Authorization: Bearer $STORE_TOKEN" -F "file=@/tmp/category.webp" http://localhost:3000/store/categories/upload-image && curl -X POST -H "Authorization: Bearer $STORE_TOKEN" -F "file=@/tmp/brand.webp" http://localhost:3000/store/brands/upload-logo`
   Business decision: categorias y marcas guardan S3 keys propias de la tienda; las URLs firmadas solo se devuelven en lecturas admin/publicas y nunca se persisten.
   Why: va despues del contrato backend y antes de la UI admin, porque los formularios necesitan endpoints confiables para preview y guardado.
   Output: endpoints de upload protegidos con permisos existentes de update/create, rutas S3 por tienda, sanitizacion y signing consistente.
   Verification: `npm run test -w apps/backend -- --runInBand src/domains/store/categories/categories.service.spec.ts src/domains/store/categories/categories.controller.spec.ts src/domains/store/brands/brands.service.spec.ts src/domains/store/brands/brands.controller.spec.ts`.

5. Extender UI admin de ecommerce y productos
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-frontend-component, vendix-frontend-icons, vendix-ui-ux, vendix-settings-system, vendix-currency-formatting
   Resources: `npm run zoneless:audit`
   Business decision: el merchant puede configurar acciones de cada slide, activar/desactivar secciones del home, definir limites/titulos, subir imagenes de categorias/marcas y marcar productos destacados sin salir de los modulos existentes.
   Why: depende de los endpoints/contratos previos y evita crear pantallas paralelas de merchandising.
   Output: formularios signal/Zoneless-safe en ecommerce settings, category/brand modals y product create/edit con `is_featured`.
   Verification: `npm run zoneless:audit` sin nuevas violaciones y prueba manual en `/admin/ecommerce`, `/admin/products/categories`, `/admin/products/brands`, `/admin/products/new` y `/admin/products/edit/:id`.

6. Implementar home publico con secciones configurables
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-frontend-component, vendix-frontend-theme, vendix-ui-ux, vendix-currency-formatting
   Resources: `npm run zoneless:audit`
   Business decision: el home oculta automaticamente secciones sin datos, respeta el orden configurado y nunca muestra marcas/categorias inactivas ni productos no disponibles para ecommerce.
   Why: va despues de admin/backend para consumir datos reales y no simular configuracion.
   Output: `HomeComponent` carga categorias, marcas y `is_featured=true`; `CategoriesShowcaseComponent` se reutiliza; `BrandsShowcaseComponent` se crea module-local.
   Verification: prueba manual en dominio `STORE_ECOMMERCE`: home con categorias, marcas y destacados; home sin marcas oculta solo esa seccion.

7. Hacer slider accionable y corregir navegacion de filtros
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-frontend-routing, vendix-ui-ux, vendix-frontend-icons
   Resources: `npm run zoneless:audit`
   Business decision: un click en slide navega al destino configurado; clicks en indicadores/CTA no duplican eventos; links externos abren seguros con `noopener`; categorias y marcas navegan a `/products?category=<id>` y `/products?brand=<id>`.
   Why: se ejecuta junto al home porque la navegacion debe quedar coherente entre slider, showcases y catalogo.
   Output: `HeroBannerComponent` con resolver de acciones, autoplay corregido con inputs/signals, y `CatalogComponent` aceptando `category`, `category_id`, `brand` y `brand_id`.
   Verification: prueba manual de slide a producto, categoria, marca, URL interna y URL externa; catalogo filtra correctamente en cada caso.

8. Redisenar la card de producto
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-ui-ux, vendix-frontend-icons, vendix-currency-formatting, vendix-product-variants, vendix-ecommerce-checkout
   Resources: `npm run zoneless:audit`
   Business decision: la card navega al detalle en click principal; el icono de carrito solo agrega productos simples vendibles, y redirige a detalle/reserva cuando hay variantes o servicios con booking; productos agotados con tracking activo no muestran compra rapida.
   Why: va despues de filtros/rutas para que la navegacion final use el contrato publico estable.
   Output: card sin borde por defecto, hover con borde/shadow suave, sin boton "Comprar", con icon-only actions accesibles y mobile touch targets.
   Verification: prueba manual en home/catalog: producto simple agrega al carrito, variante abre detalle, servicio con booking abre reserva/detalle, producto agotado no permite compra rapida, card click abre `/products/:slug`.

9. Verificacion integral de desarrollo
   Skills: buildcheck-dev, vendix-backend, vendix-frontend, vendix-zoneless-signals
   Resources: `docker logs --tail 40 vendix_backend && docker logs --tail 40 vendix_frontend && docker logs --tail 40 vendix_postgres && docker ps`
   Business decision: la tarea no se considera completa si backend, frontend o Postgres muestran errores relevantes en watch-mode.
   Why: va al final porque valida la integracion real de Prisma, NestJS, Angular y runtime local.
   Output: evidencia de logs limpios, contenedores activos y flujos manuales cubiertos.
   Verification: `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`, `docker logs --tail 40 vendix_postgres` sin errores relevantes y `docker ps` con servicios activos.

## End-to-End Verification

1. Admin: en `/admin/ecommerce`, configurar un slide con accion a categoria, otro a marca, otro a producto y guardar; recargar dominio ecommerce y verificar que cada click navega al destino correcto.
2. Admin: crear/editar categoria con imagen y marca con logo desde `/admin/products/categories` y `/admin/products/brands`; `GET /ecommerce/catalog/categories` y `GET /ecommerce/catalog/brands` devuelven URLs firmadas vigentes.
3. Admin/publico: marcar un producto como destacado en `/admin/products/edit/:id`; `curl -H "x-store-id: $STORE_ID" "http://localhost:3000/ecommerce/catalog?is_featured=true&limit=16"` devuelve ese producto cuando esta activo y disponible para ecommerce.
4. Storefront: en home, verificar orden `hero -> categorias -> marcas -> destacados`, secciones vacias ocultas, responsive mobile sin overflow y card click a `/products/:slug`.
5. Carrito: desde card de producto simple se agrega al carrito y anima badge; producto con variantes o servicio con reserva no se agrega sin seleccion y navega al flujo correcto.
6. Calidad: `npm run test -w apps/backend -- --runInBand src/domains/ecommerce/catalog/catalog.service.spec.ts src/domains/store/products/products.service.spec.ts src/domains/store/categories/categories.service.spec.ts src/domains/store/brands/brands.service.spec.ts`, `npm run zoneless:audit`, `docker logs --tail 40 vendix_backend`, `docker logs --tail 40 vendix_frontend`, `docker logs --tail 40 vendix_postgres`, `docker ps`.

## Knowledge Gaps

- Patron nuevo detectado: "ecommerce storefront merchandising configurable" todavia no tiene skill dedicada. Si despues de implementar se estabiliza el patron de secciones configurables, acciones de slider y reglas de home, conviene crear `vendix-ecommerce-merchandising` o ampliar `vendix-ecommerce-checkout`/`vendix-settings-system` para documentar el estandar.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
