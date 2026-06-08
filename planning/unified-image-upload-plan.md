# Plan: Unificación de carga de imágenes (archivo + URL + cámara + recorte) en todos los flujos de display

## Context

Hoy existe UN solo componente con la experiencia completa de carga de imágenes (subir archivo, traer desde URL, captura por cámara y recorte previo): `product-image-source-modal` (productos, marcas, categorías). El resto de flujos de imágenes de display (avatar de usuario, logo/favicon de organización y tienda, slider/logo/favicon de ecommerce, logo/favicon de dominio, logo/banner de tienda, foto de usuarios de organización, portada de artículos de help-center) usan `<input type=file>` ad-hoc que solo suben archivo, sin URL ni recorte; tres de ellos (domain-create, domain-edit, store-edit) ni siquiera suben imagen (solo aceptan una URL escrita a mano). El objetivo es que **todos** los flujos de imágenes de display compartan la misma capacidad completa. Alcance acordado con el usuario: **solo display assets**; quedan explícitamente FUERA los importadores masivos (CSV/ZIP/Excel), los escáneres OCR (RUT/factura), los recibos/adjuntos/documentos (gastos, soporte, DIAN, PUC) y las imágenes inline del editor markdown (autoría de contenido), porque recortar o pegar URL no aplica a esos casos. Capacidad acordada: archivo + URL + **cámara** + recorte.

## General Objective

Extraer el cropper canónico a un componente compartido genérico y migrar todos los flujos de imágenes de display del frontend para que ofrezcan subir-archivo, traer-desde-URL, captura-por-cámara y recorte previo de forma consistente.

## Specific Objectives

1. Existe `apps/frontend/src/app/shared/components/image-source-modal/` exportado en `shared/components/index.ts` con selector `app-image-source-modal`, sin dependencia de `ProductsService`, que emite `imagesAdded: string[]` (dataURLs) y soporta archivo+URL+cámara+recorte.
2. Existe un `ImageUploadService` compartido que envuelve `POST /upload/remote-image-preview` (fetch desde URL) y `POST /upload` (multipart genérico con `entityType`), más una util compartida `dataUrlToFile()`.
3. Productos, marcas y categorías usan el componente compartido sin cambio de comportamiento observable (productos sigue enviando dataURL directo; marcas/categorías siguen guardando `key`).
4. Cada flujo de display migrado (avatar perfil, usuarios org, logo/favicon org, logo/favicon tienda, slider/logo/favicon ecommerce, logo/favicon dominio, logo/banner store-edit, portada help-center) abre `app-image-source-modal` y persiste la `key` de S3 (o dataURL donde el endpoint lo procesa).
5. El backend acepta `entityType` para banner de tienda (única brecha de upload detectada), preservando el patrón de `S3PathHelper` y presets de imagen.
6. `npm run build:prod -w apps/frontend` y `npm run zoneless:audit` pasan sin errores tras la migración.

## Approach Chosen

Extraer el componente existente `product-image-source-modal` a un componente compartido genérico `app-image-source-modal` en `shared/components/`, eliminando su acoplamiento a `ProductsService`: la llamada de URL pasa a un `ImageUploadService` compartido y el AI-enhance (específico de productos) se vuelve un input opcional de callback (`aiEnhanceHandler`) que solo productos cablea. El componente sigue siendo UI-pura y emite dataURLs; la conversión a archivo y la subida quedan en cada consumidor mediante el `ImageUploadService` compartido (`/upload` genérico) o el endpoint de dominio existente (slider, brands, categories, help-center mantienen su ruta con su `S3PathHelper`). Se preserva el contrato `imagesAdded`/`imageEdited` para no romper productos/marcas/categorías. La migración es incremental por grupos de flujos.

## Alternatives Considered

- Construir un componente nuevo de cero: rechazado — desperdicia 1294 líneas de cropper Canvas ya probado (rotación/flip/aspect/cámara/URL) y reintroduce bugs ya resueltos.
- Mantener inputs ad-hoc por flujo y solo añadir URL+crop a cada uno: rechazado — duplica lógica en ~10 sitios, viola la regla de reuso-primero de `vendix-frontend-component` y diverge en mantenimiento.
- Que el componente compartido suba internamente y emita `key` (en vez de dataURL): rechazado — rompería el comportamiento de productos (que envía dataURL directo al endpoint de creación) y mezclaría rutas S3 de dominio dentro del componente UI.

## Critical Files

- `apps/frontend/src/app/private/modules/store/products/components/product-image-source-modal.component.ts` — fuente del cropper a extraer; queda como shim/subclase product-specific (AI-enhance).
- `apps/frontend/src/app/shared/components/image-source-modal/image-source-modal.component.ts` — NUEVO componente compartido genérico.
- `apps/frontend/src/app/shared/components/index.ts` — exportar el nuevo componente y selector.
- `apps/frontend/src/app/shared/services/image-upload.service.ts` — NUEVO servicio compartido (`/upload`, `/upload/remote-image-preview`).
- `apps/frontend/src/app/shared/utils/data-url.util.ts` — NUEVO util `dataUrlToFile()` (extraído de brand/category modals).
- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts` — repunta al componente compartido.
- `apps/frontend/src/app/private/modules/store/products/pages/brands-page/components/brand-form-modal.component.ts` — repunta + usa util compartida.
- `apps/frontend/src/app/private/modules/store/products/pages/categories-page/components/category-form-modal.component.ts` — repunta + usa util compartida.
- `apps/frontend/src/app/shared/components/profile-modal/profile-modal.component.ts` — avatar vía modal compartido (entityType `avatars`).
- `apps/frontend/src/app/private/modules/organization/users/components/user-create-modal.component.ts` — avatar vía modal compartido.
- `apps/frontend/src/app/private/modules/organization/users/components/user-edit-modal.component.ts` — avatar vía modal compartido.
- `apps/frontend/src/app/private/modules/organization/config/application/application.component.ts` — logo/favicon org vía modal (`onBrandAssetSelected`).
- `apps/frontend/src/app/private/modules/organization/config/services/organization-settings.service.ts` — reuso de `uploadOrganizationAsset` (entityType `logos`).
- `apps/frontend/src/app/private/modules/organization/domains/components/domain-create-modal/domain-create-modal.component.ts` — añade carga (hoy solo URL texto).
- `apps/frontend/src/app/private/modules/organization/domains/components/domain-edit-modal/domain-edit-modal.component.ts` — añade carga (hoy solo URL texto).
- `apps/frontend/src/app/private/modules/organization/stores/components/store-edit-modal/store-edit-modal.component.ts` — añade carga logo/banner (hoy stub).
- `apps/frontend/src/app/private/modules/store/settings/general/components/app-settings-form/app-settings-form.component.ts` — logo/favicon tienda vía modal.
- `apps/frontend/src/app/private/modules/store/settings/general/services/store-settings.service.ts` — reuso `uploadStoreLogo`/`uploadStoreFavicon`.
- `apps/frontend/src/app/private/modules/store/ecommerce/ecommerce.component.ts` — slider/logo/favicon vía modal.
- `apps/frontend/src/app/private/modules/store/ecommerce/services/ecommerce.service.ts` — reuso `uploadSliderImage`.
- `apps/frontend/src/app/private/modules/super-admin/help-center/pages/article-form/article-form.component.ts` — portada vía modal.
- `apps/backend/src/domains/upload/upload.controller.ts` — añadir `entityType` de banner de tienda.
- `apps/backend/src/domains/upload/dto/upload-file.dto.ts` — añadir valor al enum `UploadEntityType`.
- `apps/backend/src/common/helpers/s3-path.helper.ts` — añadir `buildStoreBannerPath` (espejo de favicon/logo).

## Reusable Assets

- `apps/frontend/src/app/private/modules/store/products/components/product-image-source-modal.component.ts` — cropper completo (Canvas, rotación, flip, aspect presets, URL, cámara); base de la extracción.
- `apps/frontend/src/app/shared/components/camera/camera.component.ts` (`app-camera`) — captura de cámara responsive ya integrada en el cropper.
- `apps/frontend/src/app/shared/components/modal/modal.component.ts` (`app-modal`) — contenedor modal usado por el cropper.
- `apps/backend/src/domains/upload/upload.controller.ts` — endpoints genéricos `/upload` y `/upload/remote-image-preview` (no requieren nuevos endpoints, salvo el enum de banner).
- `organization-settings.service.ts:118` `uploadOrganizationAsset`, `store-settings.service.ts:175` `uploadStoreLogo/Favicon`, `ecommerce.service.ts:47` `uploadSliderImage`, `brands.service.ts:134` `uploadBrandLogo`, `categories.service.ts:147` `uploadCategoryImage`, `help-center-admin.service.ts:119` `uploadImage` — métodos de upload por dominio reutilizables.
- `dataUrlToFile()` en `brand-form-modal.component.ts:333` y `category-form-modal.component.ts:337` — lógica duplicada a extraer a util compartida.

## Steps

1. Crear infraestructura compartida de upload
   Skills: vendix-s3-storage, vendix-frontend-state, vendix-zoneless-signals
   Resources: none
   Business decision: Se persiste la S3 key (no la URL firmada); el fetch desde URL pasa por el backend (`/upload/remote-image-preview`) para evitar CORS y validar el origen.
   Why: Es la base de la que dependen el componente compartido (Step 2) y todas las migraciones; va primero para evitar que cada flujo reinvente la subida.
   Output: `ImageUploadService` (`getRemoteImagePreview(url)`, `uploadFile(file, entityType, opts?)` → `{key,url,thumbKey?,thumbUrl?}`) en `shared/services/image-upload.service.ts` y `dataUrlToFile()` en `shared/utils/data-url.util.ts`.
   Verification: `npm run build:prod -w apps/frontend` exit 0; grep confirma que `ImageUploadService` llama exactamente a `/upload` y `/upload/remote-image-preview`.

2. Extraer `app-image-source-modal` compartido (desacoplar de ProductsService)
   Skills: vendix-frontend-component, vendix-zoneless-signals, vendix-frontend-modal
   Resources: none
   Business decision: El componente es UI-pura: emite dataURLs vía `imagesAdded`/`imageEdited` y no conoce rutas S3 de dominio; el AI-enhance (específico de productos) se inyecta como callback opcional `aiEnhanceHandler`.
   Why: Centraliza la experiencia completa antes de repuntar consumidores; depende de Step 1 (usa `ImageUploadService.getRemoteImagePreview`).
   Output: `shared/components/image-source-modal/image-source-modal.component.ts` (`app-image-source-modal`) con inputs `isOpen(model)`, `remainingSlots`, `mode`, `sourceImageUrl`, `allowCamera`, `aiEnhanceHandler?`, `aspectPresets?`; export en `shared/components/index.ts`.
   Verification: `npm run zoneless:audit` sin findings nuevos; `npm run build:prod -w apps/frontend` exit 0.

3. Repuntar productos, marcas y categorías al componente compartido
   Skills: vendix-frontend-component, vendix-zoneless-signals
   Resources: none
   Business decision: Sin cambio de comportamiento observable: productos sigue enviando dataURL directo a `POST /store/products`; marcas/categorías siguen subiendo a su endpoint de dominio y guardando `key`.
   Why: Valida la extracción contra los consumidores existentes antes de migrar flujos nuevos; deja `product-image-source-modal` como shim product-specific (AI-enhance) sin borrarlo.
   Output: `product-create-page`, `brand-form-modal`, `category-form-modal` usando `app-image-source-modal`; `dataUrlToFile` reemplazado por la util compartida.
   Verification: Manual UI — crear producto con imagen (archivo+recorte) y desde URL; crear marca con logo; build `npm run build:prod -w apps/frontend` exit 0.

4. Migrar avatares (perfil de usuario y usuarios de organización)
   Skills: vendix-frontend-component, vendix-zoneless-signals, vendix-s3-storage, vendix-frontend-modal
   Resources: none
   Business decision: Avatares usan `entityType: 'avatars'` en `/upload`; se guarda la `key` y la URL firmada la resuelve el backend en lectura.
   Why: Primer grupo de migración real; valida el flujo `dataURL → ImageUploadService.uploadFile → key` end-to-end con un entityType ya soportado.
   Output: `profile-modal`, `user-create-modal`, `user-edit-modal` abriendo `app-image-source-modal` y persistiendo `avatar_url = key`.
   Verification: Manual UI — subir avatar por archivo, por URL y con recorte en perfil; recargar y ver imagen firmada; `npm run build:prod -w apps/frontend` exit 0.

5. Migrar branding de organización y dominios (logo/favicon)
   Skills: vendix-frontend-component, vendix-zoneless-signals, vendix-s3-storage, vendix-settings-system, vendix-frontend-modal
   Resources: none
   Business decision: Logo/favicon de org y dominio usan `entityType: 'logos'`; en domain-create/edit se reemplaza el input de texto-URL por el modal (que igualmente permite pegar URL dentro), unificando la experiencia.
   Why: Cierra los flujos org-scoped; domain-create/edit y application comparten el mismo entityType y servicio (`uploadOrganizationAsset`).
   Output: `application.component`, `domain-create-modal`, `domain-edit-modal` con `app-image-source-modal` y `logo_url`/`favicon` = key.
   Verification: Manual UI — en config de org y en crear/editar dominio, subir logo por archivo+recorte y por URL; build exit 0.

6. Añadir entityType de banner + migrar settings de tienda y store-edit (logo/favicon/banner)
   Skills: vendix-s3-storage, vendix-prisma-scopes, vendix-frontend-component, vendix-zoneless-signals, vendix-settings-system, vendix-multi-tenant-context
   Resources: `npm run build -w apps/backend`
   Business decision: El banner de tienda es la única brecha de upload; se añade `entityType` dedicado con su `S3PathHelper.buildStoreBannerPath` (espejo de logo/favicon) en vez de reusar `marketing_ads`, para mantener rutas S3 trazables por entidad. Logo/favicon de tienda usan `store_logos`/`store_favicons`.
   Why: Requiere el cambio backend (enum + path helper) antes del frontend de store-edit; se agrupa con settings de tienda por compartir `store-settings.service`.
   Output: `upload.controller.ts` + `UploadEntityType` + `s3-path.helper.ts` con banner; `app-settings-form` y `store-edit-modal` usando `app-image-source-modal`.
   Verification: `npm run build -w apps/backend` exit 0; manual UI — subir logo, favicon y banner de tienda con recorte y por URL; build frontend exit 0.

7. Migrar ecommerce (slider + logo + favicon)
   Skills: vendix-frontend-component, vendix-zoneless-signals, vendix-s3-storage, vendix-frontend-modal
   Resources: none
   Business decision: Slider, logo y favicon siguen subiendo por `ecommerceService.uploadSliderImage` (endpoint de dominio con su S3 path); el slider conserva multi-imagen (`remainingSlots`/multi-select del modal).
   Why: Consolida los 3 métodos duplicados de ecommerce en un único flujo de modal; se hace tras validar el patrón en grupos anteriores por ser el más complejo (multi-imagen).
   Output: `ecommerce.component` con `app-image-source-modal` para slider (multi), logo y favicon; `slider.photos[].key`, `inicio.logo_url`, `inicio.favicon_url` = key.
   Verification: Manual UI — agregar varias imágenes al slider (archivo+URL+recorte) y logo/favicon; reordenar/guardar; build frontend exit 0.

8. Migrar portada de help-center
   Skills: vendix-frontend-component, vendix-zoneless-signals, vendix-s3-storage, vendix-frontend-modal
   Resources: none
   Business decision: La portada del artículo usa el endpoint existente `help-center-admin.service.uploadImage` y guarda `cover_image_url = key`; las imágenes inline del markdown quedan fuera de alcance (autoría de contenido, no display asset).
   Why: Último flujo de display; reemplaza el `app-file-upload-dropzone` de portada por el modal completo sin tocar el editor markdown.
   Output: `article-form.component` con `app-image-source-modal` para la portada.
   Verification: Manual UI — crear artículo subiendo portada por archivo+recorte y por URL; build frontend exit 0.

9. Verificación integral y limpieza
   Skills: buildcheck-dev, vendix-zoneless-signals
   Resources: `npm run build:prod -w apps/frontend`; `npm run zoneless:audit`; `npm run build -w apps/backend`
   Business decision: Ningún flujo de display queda sin archivo+URL+cámara+recorte; no se borran archivos sin permiso (el shim product-specific permanece).
   Why: Cierra el goal verificando que todos los flujos comparten la capacidad y que no hay regresiones de build/zoneless.
   Output: Reporte de cobertura (tabla flujo→capacidad) y builds verdes.
   Verification: Los 3 comandos de Resources exit 0; checklist manual de cobertura de los flujos de Specific Objective 4 marcado completo.

## End-to-End Verification

1. Build frontend producción: `npm run build:prod -w apps/frontend` exit 0.
2. Build backend (por el entityType de banner): `npm run build -w apps/backend` exit 0.
3. Auditoría zoneless: `npm run zoneless:audit` sin findings nuevos en los componentes tocados.
4. UI manual por flujo (ruta + estado esperado) para cada display asset: el botón abre `app-image-source-modal`, permite subir archivo, pegar URL y recortar; tras guardar, la imagen se persiste como S3 key y se muestra firmada al recargar. Flujos: avatar perfil, usuarios org (crear/editar), logo/favicon org, logo/favicon dominio (crear/editar), logo/favicon/banner tienda, slider/logo/favicon ecommerce, portada help-center, y regresión de productos/marcas/categorías.
5. Verificación S3 de banner: subir banner de tienda y confirmar vía `getPresignedUrl` que la key cae bajo el prefijo de `buildStoreBannerPath` (inspección de respuesta `{key,url}`).

## Knowledge Gaps

- None. (Exclusiones de alcance —importadores masivos, OCR, documentos, markdown inline— están documentadas en `Context` por decisión del usuario, no son gaps de skill.)

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
