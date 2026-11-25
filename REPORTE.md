# Reporte — Configurabilidad de secciones y galería en el editor de apps (`feat/apps-sections`)

## Historia de usuario

> Como dueño o administrador de una tienda en `STORE_ADMIN`, quiero elegir fotos directamente desde la galería de la tienda en cualquier sección y elegir variantes de diseño y apariencia por bloque en **Product Page**, **Service Page** y **Booking**, para personalizar la página pública con aspecto profesional sin pegar URLs a mano ni romper páginas ya publicadas.

### Pasos observables para probar en pantalla

1. Abrir **Apps → Página de producto / Página de servicios / Reservas → Contenido**.
2. Seleccionar **Portada**: elegir diseño (`Centrado`, `Imagen a la derecha`, `Imagen de fondo`), cargar imagen principal o de fondo con el botón **Galería**, ajustar la intensidad del velo (`0-80 %`), el alto (`Auto / Compacto / Completo`) y la alineación del texto; ver la actualización inmediata en la vista previa.
3. Seleccionar **Galería**: pulsar **Agregar desde galería** para añadir varias fotos (carrusel de múltiples imágenes), reordenar o quitar ítems, alternar entre `Cuadrícula`, `Carrusel` y `Mosaico`, ajustar `Columnas (2-4)` y `Proporción (1:1, 4:3, 16:9)`.
4. Agregar o editar **Destacados** (o **Beneficios** en Product Page): alternar entre `Tarjetas`, `Lista` y `Banda`, elegir color de acento, asignar foto desde galería e icono a cada ítem.
5. Abrir el grupo plegable **Apariencia de la sección** en cualquier bloque: definir color de fondo o imagen de fondo con velo (`0-80 %`), espaciado (`Compacto / Normal / Amplio`) y alineación (`Izquierda / Centrado / Derecha`).
6. Guardar y abrir la página pública real: las variantes, fondos y fotos coinciden con la vista previa; cualquier documento antiguo sin estas propiedades sigue viéndose exactamente igual.

---

## Resumen de cambios por tarea

### TAREA 1 — Imágenes desde la galería (`app-media-field`)
- **Nuevo componente reutilizable**: `apps/frontend/src/app/private/modules/store/apps/components/app-media-field/app-media-field.component.ts`
  - Muestra miniatura de la imagen actual, botón principal **Galería** (abre `AppMediaPickerComponent` bajo demanda), botón para quitar e input de URL `https://` opcional con validación inline.
  - Emite la URL estable entregada por `AppMediaService` / `AppMediaPickerComponent`.
- **Integración en todas las propiedades de imagen**:
  - `hero`: `image_url`, `background_image_url`.
  - `gallery`: `image_urls` (`media_list`, hasta 12 fotos con botón directo **Agregar desde galería**, además de agregar/quitar/reordenar por ítem).
  - `highlights` y `benefits`: `items[].image_url`.
  - `team` (Service Page): `items[].photo_url`.
  - `cta`: `image_url`.
  - Apariencia común de bloque: `background_image_url`.

### TAREA 2 — Variantes por sección y apariencia por bloque
- **`hero`**:
  - `variant`: `'centered' | 'image_right' | 'background'`
  - `background_image_url`: URL https (galería)
  - `overlay_opacity`: entero `0..80`
  - `height`: `'auto' | 'compact' | 'full'`
  - `align`: `'left' | 'center' | 'right'`
- **`gallery`**:
  - `variant`: `'grid' | 'carousel' | 'mosaic'`
  - `image_urls`: lista de hasta 12 URLs https
  - `columns`: entero `2..4`
  - `aspect_ratio`: `'1:1' | '4:3' | '16:9'`
- **`highlights` (y `benefits` en Product Page)**:
  - `variant`: `'cards' | 'list' | 'band'`
  - `accent_color`: `#RRGGBB`
  - `items[]`: `title`, `text`, `image_url` (galería), `icon` (catálogo cerrado de 14 iconos registrados en `icons.registry.ts`).
  - Se añadió el bloque `highlights` al catálogo de `product_page`, `service_page` y `booking` (sin alterar los `page.blocks` por defecto de ninguna plantilla).
- **`cta`**: gana `image_url` opcional (layout dividido cuando tiene imagen; centrado clásico si no tiene).
- **Apariencia común en cada bloque** (Product Page, Service Page, Booking):
  - `background_color` (`#RRGGBB`), `background_image_url` (URL https), `overlay_opacity` (`0..80`), `spacing` (`'compact' | 'normal' | 'spacious'`), `align` (`'left' | 'center' | 'right'`). La visibilidad sigue gobernada por `enabled`.
- **Tienda en línea (`store_home`) intacta**: no se modificó ninguna plantilla, builder ni vista de `store_home`, y el contrato de `store_home` no añade estas propiedades.

### TAREA 3 — Catálogo, contrato y controles del inspector
- **Backend**: `apps/backend/src/domains/store/apps/shared/app-page.contract.ts`
  - Catálogos cerrados exportados (`APP_HERO_VARIANTS`, `APP_HERO_HEIGHTS`, `APP_GALLERY_VARIANTS`, `APP_GALLERY_ASPECT_RATIOS`, `APP_HIGHLIGHTS_VARIANTS`, `APP_HIGHLIGHTS_ICONS`, `APP_BLOCK_SPACINGS`, `APP_TEXT_ALIGNS`).
  - Validación cerrada de enums, rangos enteros (`0..80`, `2..4`), colores `#RRGGBB` (`kind: 'color'`) y URLs `https://`.
  - Mantiene `APP_PAGE_SCHEMA_VERSION = 1`: 100 % aditivo y compatible hacia atrás.
- **Frontend tipos, plantillas y puente**:
  - `apps/frontend/src/app/private/modules/store/apps/templates/app-page.types.ts`
  - `apps/frontend/src/app/private/modules/store/apps/templates/product-page.template.ts`
  - `apps/frontend/src/app/private/modules/store/apps/templates/service-page.template.ts`
  - `apps/frontend/src/app/private/modules/store/apps/templates/booking.template.ts`
  - `apps/frontend/src/app/private/modules/store/apps/builder/builder.types.ts`
  - `apps/frontend/src/app/private/modules/store/apps/page-builder/page-builder-document.ts`
  - `apps/frontend/src/app/private/modules/store/apps/page-builder/product-page/product-page-builder.ts`
  - `apps/frontend/src/app/private/modules/store/apps/page-builder/service-page/service-page-builder.ts`
  - `apps/frontend/src/app/private/modules/store/apps/page-builder/booking/booking-builder.ts`
  - `apps/frontend/src/app/private/modules/store/apps/page-builder/app-page-builder-page.component.ts`
  - `apps/frontend/src/app/private/modules/store/apps/components/app-page-editor/app-page-editor.component.ts` (compatibilidad de `@switch` para los nuevos tipos de campo).
- **Inspector**: `apps/frontend/src/app/private/modules/store/apps/builder/builder-inspector.component.ts`
  - Controles nuevos: `app-media-field` (single y lista), chips con estado «Por defecto», desplegables (`select`), sliders (`range`) con lectura numérica y botón «Restablecer», selector de color `#RRGGBB` con limpieza, lista de imágenes con «Agregar desde galería», agregar/quitar/reordenar, y grupo plegable **Apariencia de la sección** con indicador «Personalizada».

### TAREA 4 — Renderizado en preview y página pública real
- `apps/frontend/src/app/public/app-page/app-page-view.component.ts` y `apps/frontend/src/app/public/app-page/app-page-view.util.ts`
  - Tanto el iframe de vista previa (`AppPagePreviewFrameComponent`) como las vistas públicas reales (`ProductPageViewComponent`, `ServicePageHomeViewComponent`, `BookingPageHomeViewComponent`) renderizan mediante `<app-app-page-view>`.
  - Sin HTML libre: todo sale del documento validado (`safeUrl`, `cssBgUrl`, `safeColor`, catálogos cerrados).
  - Documentos previos sin propiedades nuevas conservan exactamente las clases, espaciados y atributos anteriores.

### TAREA 5 — Tests añadidos y actualizados
- Backend: `apps/backend/src/domains/store/apps/shared/app-page.contract.spec.ts` (válidos, inválidos, rangos, colores, URLs y protección de `store_home`).
- Campo de medios: `apps/frontend/src/app/private/modules/store/apps/components/app-media-field/app-media-field.component.spec.ts` (apertura de galería, emisión de URL estable, miniatura, limpieza y error de URL).
- Variantes y apariencia: `apps/frontend/src/app/public/app-page/app-page-view.component.spec.ts` (3 layouts de hero + velo/alto/alineación, 3 layouts de gallery + columnas/proporción/carrusel, 3 layouts de highlights + imagen/icono/acento, apariencia común por bloque, imagen de CTA y compatibilidad hacia atrás).
- Inspector: `apps/frontend/src/app/private/modules/store/apps/builder/builder-inspector.component.spec.ts` (chips, sliders, lista de medios con `app-media-field` y grupo de apariencia).
- Plantillas y round-trip: `apps/frontend/src/app/private/modules/store/apps/templates/app-page-templates.spec.ts` (documento sin tokens nuevos conserva su estructura exacta tras validar y pasar por `pageToBlocks` / `blocksToPage`).

---

## Decisiones técnicas destacadas

1. **Montaje diferido de `AppMediaPickerComponent`**: `app-media-field` y el botón rápido de lista en el inspector montan `<app-app-media-picker>` solo dentro de `@if (pickerOpen())`. Así una galería con 12 fotos no monta 12 modales ni dispara peticiones HTTP hasta que el usuario abre la galería.
2. **Round-trip exacto sin ensuciar borradores antiguos**:
   - `cleanTypedItems` en `page-builder-document.ts` elimina subcampos vacíos (`''`) introducidos por `readListItems` (p. ej. `image_url: ''`, `icon: ''` en ítems antiguos), igualando el comportamiento de `cleanScalar` del backend.
   - `cleanBlockProps` solo elimina claves con valor `undefined` (enviado al limpiar un control opcional), preservando cadenas vacías preexistentes intencionales como `check_in: ''` en las plantillas de `booking`.
3. **Catálogo cerrado de iconos**: `APP_HIGHLIGHTS_ICONS` solo incluye 14 claves verificadas en `apps/frontend/src/app/shared/components/icon/icons.registry.ts`, evitando iconos huérfanos en runtime.
4. **Aislamiento de `store_home`**: `supportsSectionCustomization(kind)` retorna `false` para `store_home` y `APP_PAGE_BLOCKS.store_home` mantiene `CARDS` sin `BLOCK_APPEARANCE`, asegurando cero impacto en la Tienda en línea.

---

## Comandos de verificación ejecutados

1. **Verificación de runners activos** (antes de cada ejecución):
   ```bash
   ps -eo pid,comm,args | grep -E '(^|[ /])(jest|karma|vitest)(\s|$)|ng test' | grep -v grep
   ```
   Resultado: sin otros procesos `jest`/`karma`/`vitest` corriendo.

2. **Contrato backend (Jest acotado)**:
   ```bash
   npm run test:path -w apps/backend -- src/domains/store/apps/shared/app-page.contract.spec.ts
   ```
   Resultado: **PASS — 1 suite, 21 passed, 21 total** (`12.8s`).
   *(Nota: `npm run buildcheck:test` falló inicialmente por límite de heap de Node en `scripts/buildcheck.sh`; se ejecutó con el runner acotado oficial `test:path`.)*

3. **Specs de frontend (Karma ChromeHeadless acotado a los archivos tocados + los 4 page builders)**:
   ```bash
   cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless \
     --include=src/app/private/modules/store/apps/components/app-media-field/app-media-field.component.spec.ts \
     --include=src/app/private/modules/store/apps/builder/builder-inspector.component.spec.ts \
     --include=src/app/private/modules/store/apps/templates/app-page-templates.spec.ts \
     --include=src/app/public/app-page/app-page-view.component.spec.ts \
     --include=src/app/private/modules/store/apps/page-builder/product-page/product-page-builder-page.component.spec.ts \
     --include=src/app/private/modules/store/apps/page-builder/service-page/service-page-builder-page.component.spec.ts \
     --include=src/app/private/modules/store/apps/page-builder/booking/booking-builder-page.component.spec.ts \
     --include=src/app/private/modules/store/apps/page-builder/store-home/store-home-builder-page.component.spec.ts
   ```
   Resultado: **TOTAL: 125 SUCCESS (0 FAILED)**.

4. **Auditoría Zoneless**:
   - `npm run zoneless:audit`: `UI state plano en archivos cambiados: 0`.
   - Verificación directa sobre todos los componentes nuevos/editados (`app-media-field`, `builder-inspector`, `app-page-view`): `0` ocurrencias de `@Input`/`@Output`, `EventEmitter`, `NgZone`, `markForCheck`, `detectChanges`, `*ngIf`/`*ngFor`/`*ngSwitch` o `BehaviorSubject`.
