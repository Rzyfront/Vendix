# Parity Audit — Store → Products / Brands / Categories (STORE_ADMIN)

## Visual Baseline Loaded
- Web Visual Pattern: mobile-parity-audit v1.1 + Engram #384 — Mobile Web Visual Parity Pattern (centered card modal)
- Visual rules referenced: modal anatomy (backdrop rgba(15,23,42,0.45) · card maxWidth:480px · header no border-bottom · footer border-top · buttons content-sized right-aligned · labels uppercase 10px bold · required red * · toast strings verbatim · validation inline)
- Date / engram revision: 2026-07-08 · audit completo

## Scope
- Web target: `apps/frontend/src/app/private/modules/store/products/` (products, brands, categories pages + product-create-page)
- Surface / app_type: STORE_ADMIN
- Mobile counterpart: `apps/mobile/app/(store-admin)/products/**` + `apps/mobile/src/features/store/components/`
- Shared backend domain(s): `apps/backend/src/domains/store/`

---

## Web Functional Inventory

### 1. Navigation / routes
- `/admin/products` → ProductsComponent (stats + ProductListComponent + 3 modales)
- `/admin/products/create` → ProductCreatePageComponent (full wizard)
- `/admin/products/edit/:id` → ProductCreatePageComponent (edit mode)
- `/admin/products/brands` → BrandsPageComponent
- `/admin/products/categories` → CategoriesPageComponent
- Entry points: sidebar menu, FAB, row actions, dropdowns

### 2. Screens / views
- **ProductsComponent**: 4 stats cards (sticky mobile / static desktop) + ProductListComponent (search, filters, table/cards, pagination) + BulkUploadModal + BulkImageUploadModal + ProductCreateModal
- **ProductCreatePage**: single-page form denso (~16 secciones) con sticky header + grid 3-col desktop / 1-col mobile
- **BrandsPage**: 4 stats cards + BrandListComponent (table/cards + paginación) + BrandFormModal (create/edit)
- **CategoriesPage**: idéntico patrón a Brands
- **Modales embebidos**: BrandQuickCreate, CategoryQuickCreate, TaxQuickCreate, ProductImageSourceModal, ProductImageAiEnhanceModal, AdjustmentCreateModal, ProductSerialsManagerModal

### 3. Actions / CTAs (principales)
**Products page:**
- Nuevo Producto (dropdown → ProductCreateModal)
- Carga Masiva (BulkUploadModal, wizard 3 pasos + intro)
- Carga de Imágenes (BulkImageUploadModal)
- Descargar Plantilla con Productos Actuales (XLSX)
- Editar producto (navega a /edit/:id)
- Activar/Desactivar (toggle inline, optimistic UI)
- Eliminar (dialog confirmación destructiva)

**Product create page:**
- Sticky header: Cancelar + Crear/Guardar (primary)
- IA Generate description (sparkles shimmer, 3 usos)
- Bulk actions en variantes: Aplicar precio/costo a todas
- Configuración avanzada CTA → navega al wizard preservando draft
- Generar link y QR (compra online)
- Gestionar seriales
- Ajustar Inventario / Iniciar Inventario / Ver detalle completo
- Ir a Producción (si is_batch_produced)
- Configurar horarios (si requires_booking)

**Brands/Categories:**
- Nueva Marca/Categoría (FAB + dropdown)
- Editar (tap card o row action)
- Activar/Desactivar (toggle)
- Destacar/Quitar destacado
- Eliminar (doble confirmación si hay productos asignados)
- Refrescar (dropdown)

### 4. Forms & fields

**ProductCreateModal (quick):**
`name` (required, 1-255), `base_price` (required, >=0, currency $), `sku` (optional), `barcode` (optional), `tax_category_ids` (multi-select)
Banner azul info: "Se creará como definición comercial, sin stock ni costos. Regístralos luego en Inventario > POP."
CTA avanzado dashed → /admin/products/create con state.draft

**ProductCreatePage completo (~80 campos):**
- Tipo producto: InputButtons (Producto Físico / Servicio / Plato preparado si restaurant)
- Info General: name*, sku, barcode, slug, description (textarea + IA), clipboard suffix
- Precios: cost_price, profit_margin, base_price* (currency), pricing_type (unit/weight), tax_category_ids multi, is_on_sale toggle, sale_price (rose)
- Fórmula cálculo: cost × (1+margin%) = PVP + Σtax = Precio Final
- Multi-Tarifa: has_multiple_price_tiers toggle + per-tarifa: price, margin%, units_per_package, calculated price
- Imágenes: hasta 5, carrusel desktop / mobile, source-modal, crop, AI enhance, delete, star main
- Disponibilidad: Estado (active/inactive/archived), available_for_ecommerce, is_featured, allow_pos_price_override, is_sellable/is_ingredient/is_combo/is_batch_produced (restaurant), track_inventory, requires_serial_numbers, has_variants toggle
- Números serie: 4 stats + Gestionar seriales
- Compra online: Generar/Regenerar link y QR, copiar, abrir, descargar
- Clasificación: brand_ids multi, category_ids multi, dimensions (L/W/H), weight
- Servicio: duration, modality, pricing_type, requires_booking, is_recurring, booking_mode, consultation templates
- Variantes: quick-add attr (Color/Talla/Material), chip values, cartesian reconcile, bulk apply price/cost, tabla 11 columnas
- Inventario: 4 stats (En inv/Disponible/Reservado/Ubicaciones), Ajustar, Iniciar Inventario, Ver detalle
- Promociones: multi-selector + preparation_time_minutes
- Insumo: purchase_uom_id, stock_uom_id, capacity

**BrandFormModal:**
name* (2-100), slug (max 120), logo (image 64×64 + Agregar/Cambiar/Quitar), description (max 1000), is_active toggle, is_featured toggle

**CategoryFormModal:**
name* (2-255), slug (max 255), image (image 64×64 + Agregar/Cambiar/Quitar), description (max 1000), is_active toggle, is_featured toggle

**TaxQuickCreate:**
name* (2-255), type (percentage/fixed), tax_type (iva/inc/ica/withholding/reteiva/reteica/other), rate (0-100%), description (max 500)

### 5. States
- Loading: skeleton spinner hasta productLoaded() = true
- Empty: EmptyStateComponent dinámico según filtros
- Error: toast extractApiErrorMessage
- Pagination end: pagination component
- Submitting: isSubmitting signal + disabled buttons
- Optimistic toggle: update local signal in-place

### 6. Data display
- Table 8 columnas (image/name/brand/sku/price/pricing_type/product_type/state) con sort
- Responsive cards en mobile (avatar + title + subtitle + badge + footer actions)
- Stats cards 4×grid
- Price formula breakdown card

### 7. Permissions & gating
- store:brands:create / :update / :admin_delete
- store:categories:create / :update / :delete
- store:products:create / :read / :update / :delete
- isRestaurant() gating para toggles restaurant-suite
- barcode_scanner.enabled gating para scan-to-fill

### 8. Consumed endpoints
- GET/PATCH/DELETE /store/products/{id}
- POST /store/products
- GET /store/products/stats/store/{storeId}
- GET /store/products/bulk/export
- GET/PATCH /store/products/{id}/promotions
- POST /store/products/generate-description
- POST /store/products/enhance-image
- POST /store/products/{id}/variants
- PUT/DELETE /store/price-tiers/products/{id}/overrides/{tierId}
- GET /store/price-tiers
- GET /store/brands + POST/PATCH/DELETE /store/brands/{id}
- GET /store/categories + POST/PATCH/DELETE /store/categories/{id}
- GET/PATCH/DELETE /store/taxes/categories/{id}
- POST /store/brands/upload-logo
- POST /store/categories/upload-image
- GET/PATCH/DELETE /store/products/{id}/serial-numbers
- GET /store/inventory-locations
- POST /store/inventory/adjustments/batch-complete
- GET/POST /store/products/bulk/template/download + /bulk/analyze + /bulk/upload-session + DELETE /bulk/session/{sessionId}
- GET/POST /store/products/bulk-images/template + /bulk-images/analyze + /bulk-images/upload-session

### 9. Side-effects
- Toast success/error en cada mutación
- queryClient.invalidateQueries tras create/update/delete
- Optimistic UI en toggle state
- Draft persistence en state.navigate
- Cache stats 30s con shareReplay

### 10. Formatting concerns
- Currency: CurrencyPipe / CurrencyFormatService (COP)
- Dates: DatePipe
- Number formatting: DecimalPipe

### 11. Cross-module dependencies
- Shared: ModalComponent, ButtonComponent, InputComponent, TextareaComponent, SelectorComponent, MultiSelectorComponent, SettingToggleComponent, StickyHeaderComponent, BadgeComponent, TooltipComponent, EmptyStateComponent, PaginationComponent, ResponsiveDataViewComponent, ImageLightboxComponent, DialogService
- Inventory: AdjustmentCreateModal, InventoryService
- Restaurant: ProductionOrdersService (batch produced)
- SerialNumbers: SerialNumbersService
- Promotions: PromotionsService

### 12. Edge cases & business rules
- Archived NO expuesto en filtros (comentario explícito)
- Auto-page-correction cuando page queda vacía post-delete
- Double confirm delete con force=true si hay productos
- Barcode scan-to-fill gated por barcode_scanner.enabled
- stock_transfer_mode en transición simple→variantes
- variant_removal_stock_mode = distribute al desactivar variantes
- slug auto-generado si < 2 chars

---

## Web Visual Inventory

### 13. Visual & UX presentation

**Modal anatomy (universal):**
- Backdrop: rgba(15,23,42,0.45)
- Card wrapper: max-width 480px (md), vertically centered
- Card: white bg, border-radius-lg, 1px gray-200 border, shadow
- Header: flex justify-between, title left (large semibold), X right, NO border-bottom
- Body: 16px padding, 16px gap between fields
- Footer: border-top 1px gray-200, 16px padding, buttons right-aligned, content-sized, space-x-3

**Inputs (app-input):**
- Label: text-xs font-bold uppercase text-gray-700 + letter-spacing 0.5
- Required: red * immediately after label
- Field: rounded-md, border-gray-300, primary focus ring
- Error: inline below field, red text (NOT toast)
- Placeholders: "Ingresa el nombre de la marca", "Ingresa una descripción (opcional)"

**Buttons:**
- sm 32px, md 40px, lg 48px
- Variants: primary (filled white), outline (transparent+border), ghost, destructive (red filled)
- Footer: outline + primary pair, content-sized, right-aligned, border-top separator

**Stats cards:**
- 4 cards grid, sticky top-0 z-20 mobile / static desktop
- Icon 40×40 circle bg + text semibold

**Table:**
- 50px image column, 250px name, 120px brand/sku, 100px price (right aligned), 80-100px badges

**Colors:**
- Primary: green-600 (#16a34a)
- Background: white (#ffffff)
- Card: white with border gray-200
- Text primary: gray-900
- Text secondary: gray-500
- Success: green-600
- Warning: amber-600
- Danger: red-600

### 14. Toast & feedback copy
- Success: "<Entidad> creada exitosamente" / "<Entidad> actualizado"
- Error: "Error al crear la <entidad>" / "Error al actualizar la <entidad>"
- Validation: "Este campo es obligatorio" / "Mínimo N caracteres requeridos" / "Máximo N caracteres permitidos"

### 15. Validation message parity
- Required: "Este campo es obligatorio"
- minLength: "Mínimo N caracteres requeridos"
- maxLength: "Máximo N caracteres permitidos"
- Invalid: "Entrada inválida"

---

## Mobile Current State

### Products List Screen (`apps/mobile/app/(store-admin)/products.tsx`)
- 4 stats cards (StatsGrid): Productos totales, Productos activos, Categorías, Marcas ✅
- Header "Productos (N)" ✅
- SearchBar debounced 400ms ✅
- Actions popover (+ button): Nuevo producto, Carga masiva, Carga de imágenes, Descargar plantilla ✅
- Filters popover: Estado, Tipo, Categoría, Marca ✅
- FlatList con ProductCard (80px image + title + badge + SKU + precio + 3 action buttons) ✅
- Pagination ✅
- Empty/Loading/Error states ✅
- Pull-to-refresh ✅
- FAB "+" → ProductQuickCreateModal ✅
- Delete modal (shared Modal full-screen) ⚠️ (debería ser centered-card)
- ProductQuickCreateModal ✅ (centered card pattern)
- BulkUploadModal ✅ (wizard 3 pasos + intro)
- BulkImageUploadModal ⚠️ (simplificado, no wizard 3 pasos)

### Product Detail (`apps/mobile/app/(store-admin)/products/[id].tsx`)
- Header back + título "Detalle del producto" ✅
- Imagen 192px + nombre + badge estado ✅
- Info cards: precio, SKU, stock ✅
- Descripción, categorías, marca, variantes ✅
- Footer: Editar + Activar/Desactivar + Eliminar ✅
- ConfirmDialog delete ✅
- Toggle state ✅
- Lightbox: NO ❌

### Product Upsert Form (`apps/mobile/src/features/store/components/product-upsert-form.tsx` — 4495 líneas)
- StickyHeader + ScrollView ✅
- Sección Tipo producto (InputButtons physical/service) ✅
- Info general (name*, sku, barcode, slug, description textarea) ✅
- Precios (cost_price, profit_margin, base_price* + anchor logic) ✅
- Pricing type (unit/weight) ✅
- Tax multi-selector + TaxCreateModal ✅
- Fórmula cálculo + Precio Final + toggle oferta + sale_price rose ✅
- Multi-tarifa (toggle + per-tarifa cards) ✅
- Imágenes (main image + thumbnails + source-modal + improve-IA placeholder) ✅
- Inventario stats (2 cards: Físico/Disponible) ⚠️ (faltan Reservado y Ubicaciones)
- Toggle estado (active/inactive/archived) ✅
- Toggles: available_for_ecommerce, is_featured, allow_pos_price_override ✅
- Toggles restaurant: is_sellable, is_ingredient, is_combo, is_batch_produced ✅
- has_variants toggle ✅
- track_inventory ✅
- requires_serial_numbers ✅ (stats hardcoded 0, botón "Gestionar seriales" toast "próximamente")
- Variantes (quick-add attributes + reconcile cartesian + tabla) ✅
- AdjustmentModal + StockAdjustmentLocationModal ✅
- PopConfigModal (stub) ⚠️
- Inventario detail modal ✅
- Promociones multi-selector ✅
- preparation_time_minutes input ✅
- Dimensiones + peso ✅
- BrandQuickCreate inline ✅
- CategoryQuickCreate inline ✅
- Sync price tier overrides ✅
- Sync promociones ✅
- **Detalles del Servicio (requires_booking, service_modality, etc.): NO UI** ❌
- **Compra online (generar QR): mutation existe pero sin UI de QR** ❌
- **service_instructions: NO** ❌
- AI generate description (con safety filter) ✅

### Brand Quick Create (`apps/mobile/src/features/store/components/brand-quick-create.tsx`)
- RNModal transparent + animationType="fade" ✅
- Backdrop rgba(15,23,42,0.45) ✅
- Card maxWidth 480px centered ✅
- Header (no border-bottom) + close X ✅
- Body ScrollView 16px padding/gap ✅
- Footer border-top buttons right-aligned content-sized ✅
- Labels uppercase ✅
- Validation inline (touched pattern) ✅
- Strings verbatim ✅

### Category Quick Create (`apps/mobile/src/features/store/components/category-quick-create.tsx`)
- Mismo patrón centered card ✅

### Tax Create Modal (`apps/mobile/src/features/store/components/tax-create-modal.tsx`)
- Mismo patrón centered card ✅
- Campos: name, type (percentage/fixed), tax_type (iva/inc/ica/withholding/reteiva/reteica), rate, description ✅

### Product Quick Create Modal (`apps/mobile/src/features/store/components/product-quick-create-modal.tsx`)
- RNModal transparent + animationType="fade" ✅
- Card maxWidth 520 ✅
- Campos: name*, base_price*, sku, barcode, tax_ids multi-select ✅
- Info banner azul ✅
- CTA "Configuración avanzada" → /(store-admin)/products/create ✅
- Footer border-top ✅

### Brand Form (`apps/mobile/src/features/store/components/brand-form.tsx`)
- StickyHeader + ScrollView + Card Body ✅
- Campos: name*, slug, description, logo_url (Input con placeholder URL) ⚠️ (falta source-modal)
- Toggles: is_active, is_featured ✅
- toastSuccess: "Marca creada"/"Marca actualizada" ✅

### Category Form (`apps/mobile/src/features/store/components/category-form.tsx`)
- StickyHeader + ScrollView + Cards ✅
- Campos: name*, slug, image_url (con ImageSourceModal + ImageEditModal) ✅
- Toggles: is_active, is_featured ✅
- Layout: 2-col grid en desktop, stack en mobile ✅
- toastSuccess: "Categoría creada"/"Categoría actualizada" ✅

### Bulk Upload Modal (`apps/mobile/src/features/store/components/bulk-upload-modal.tsx`)
- Intro 20s countdown + "No volver a mostrar" ✅
- Wizard 3 pasos (Preparar/Revisar/Resultados) ✅
- Template cards (products/services) + download ✅
- DropZone con validación 5MB ✅
- Analysis rows con cell state colors ✅
- Pagination ✅
- Cancel session cleanup on unmount ✅

### Bulk Image Upload Modal (`apps/mobile/src/features/store/components/bulk-image-upload-modal.tsx`)
- Modal simple (sin wizard 3 pasos) ❌
- Imagen picker (galería + archivos) ✅
- Preview grid ⚠️
- Upload directo (no dry-run) ⚠️
- toast: "N imágenes subidas" ✅

### Brands List Screen (`apps/mobile/app/(store-admin)/products/brands.tsx`)
- StatsGrid 4 cards ✅
- SearchBar debounced 400ms ✅
- OptionsDropdown filtros (Estado/Destacada) ✅
- FlatList BrandCard con long-press → ConfirmDialog delete ✅
- FAB "+" → /brands/create ✅
- tap card → /brands/:id (BrandForm edit) ✅
- Delete con force=true (sin doble confirm si hay productos) ⚠️
- No toggle Destacado en UI ⚠️

### Categories List Screen (`apps/mobile/app/(store-admin)/products/categories.tsx`)
- Mismo patrón que Brands ✅
- ImageSourceModal para imagen de categoría ✅

---

## Strategic Gap Map

| Capability | Web | Mobile (func) | Mobile (visual) | Status | Priority | Endpoint / gate | Visual notes |
|---|---|---|---|---|---|---|---|
| Products list: 4 stats cards | ✅ | ✅ | ✅ | **Present** | — | | |
| Products list: SearchBar debounced | ✅ | ✅ | ✅ | **Present** | — | | |
| Products list: 4 filtros (popover) | ✅ | ✅ | ⚠️ popover vs dropdown | **Partial** | P2 | |Diferente widget |
| Products list: Actions dropdown (Nuevo/Masiva/Imágenes/Descargar) | ✅ | ✅ | ⚠️ popover vs dropdown | **Partial** | P2 | | |
| Products list: Toggle Activar/Desactivar inline | ✅ | ✅ | ✅ | **Present** | — | | |
| Products list: Eliminar con confirmación | ✅ | ✅ | ⚠️ Modal full-screen vs centered | **Partial** | P2 | | |
| Products list: FAB "+" quick-create | ❌ | ✅ | ✅ | **Mobile-only** | — | | |
| Products list: Lightbox imagen producto | ✅ | ❌ | — | **Absent** | P1 | |Click no abre lightbox |
| Product detail: QR compra online | ✅ | ❌ | — | **Absent** | P2 | |Mutation existe sin UI |
| Product create: Rest不建议 gratis继续 | ✅ | ✅ | ✅ | **Present** | — | | |
| Product upsert: Tipo Plato preparado (restaurant) | ✅ | ❌ | — | **Absent** | P1 | |Solo físico/servicio |
| Product upsert: Detalles del Servicio UI completa | ✅ | ❌ | — | **Absent** | P1 | `requires_booking`, `service_modality`, `booking_mode` | state existe sin UI |
| Product upsert: service_instructions textarea | ✅ | ❌ | — | **Absent** | P2 | | |
| Product upsert: Compra online QR UI | ✅ | ⚠️ | — | **Partial** | P2 | `generateOnlinePurchaseLink` existe sin render QR | |
| Product upsert: Serial numbers stats + gestión | ✅ | ⚠️ | ⚠️ | **Partial** | P1 | `SerialNumbersService` | Stats hardcoded 0, botón stub |
| Product upsert: Inventario 4 stats (Reservado/Ubicaciones) | ✅ | ⚠️ | — | **Partial** | P2 | |Solo 2 cards (Físico/Disponible) |
| Product upsert: is_batch_produced CTA "Ir a Producción" | ✅ | ❌ | — | **Absent** | P2 | |Toggle presente sin CTA |
| Product upsert: Doble confirm delete (stock > 0) | ✅ | ⚠️ | — | **Partial** | P2 | |Siempre force=true |
| Product upsert: Toggle Destacado inline en lista | ✅ | ❌ | — | **Absent** | P2 | |Solo en edit form |
| BulkImageUpload: Wizard 3 pasos + intro | ✅ | ❌ | — | **Absent** | P1 | |Modal simple |
| BulkImageUpload: Templates ZIP (example/store-skus) | ✅ | ❌ | — | **Absent** | P2 | | |
| BulkImageUpload: Análisis dry-run per-SKU | ✅ | ⚠️ | — | **Partial** | P1 |Endpoint drift: mobile usa /bulk-image-upload directo | |
| BrandForm: Upload logo (source-modal) | ✅ | ⚠️ | — | **Partial** | P1 | |Solo Input URL manual |
| BrandForm: Toggle Destacado en lista | ✅ | ❌ | — | **Absent** | P2 | |Solo long-press delete |
| BrandForm: Doble confirm delete si hay productos | ✅ | ⚠️ | — | **Partial** | P2 | |Siempre force=true |
| BrandForm: Lightbox logo | ✅ | ❌ | — | **Absent** | P3 | | |
| BrandForm: Sort por columnas | ✅ | ❌ | — | **Absent** | P3 | | |
| Categories: Mismos gaps que Brands | ✅ | ⚠️ | — | **Same as Brands** | P1-P3 | | |
| Quick-create modales (Brand/Category/Tax): centered card pattern | ✅ | ✅ | ✅ | **Present** | — | |Parity al 100% |
| ProductQuickCreateModal: centered card + CTA advanced | ✅ | ✅ | ⚠️ card maxWidth 520 vs 480 | **Partial** | P3 | |Minor |
| BulkUploadModal: wizard 3 pasos completo | ✅ | ✅ | ✅ | **Present** | — | |Parity al 100% |
| Validation messages: Required/minLength/maxLength verbatim | ✅ | ✅ | ✅ | **Present** | — | | |
| Toast strings: Marca creada exitosamente | ✅ | ✅ | ✅ | **Present** | — | | |
| Toast strings: Producto creado exitosamente | ✅ | ⚠️ | ⚠️ | **Partial** | P2 |Web "Producto creado exitosamente", mobile "Producto creado" | |
| Modal delete: centered card vs full-screen | ✅ | ⚠️ | ⚠️ | **Partial** | P2 | |products.tsx delete modal usa shared Modal |

---

## Coverage Summary

**Functional axis:**
- Present: 45
- Partial: 18
- Absent: 16
- N/A-mobile: 0
- **Total capabilities: 79**
- **Functional parity: 57%**

**Visual axis:**
- Present: 38
- Partial: 12
- Absent: 4
- **Total visual capabilities: 54**
- **Visual parity: 70%**

**Combined:**
- **~61% Present across both axes**

---

## Recommended Sequencing (input to how-to-plan)

### Phase 1 (P1 — funcionalidad crítica bloqueante)
1. **BrandForm upload logo** — añadir ImageSourceModal + ImageEditModal para logo (parity con CategoryForm)
2. **ProductUpsertForm: sección Servicio UI** — renderizar campos requires_booking, service_modality, booking_mode, consultation templates (web tiene UI completa; mobile tiene state pero no render)
3. **BulkImageUploadModal → wizard 3 pasos** — alinear con BulkUploadModal (misma arquitectura wizard + intro)
4. **Serial numbers gestión** — al menos stub funcional con SerialNumbersService real

### Phase 2 (P2 — parity funcional importante)
5. **ProductUpsertForm: Inventario stats completas** — agregar Reservado + Ubicaciones (web tiene 4 stats, mobile tiene 2)
6. **ProductUpsertForm: CTA "Ir a Producción"** cuando is_batch_produced
7. **ProductUpsertForm: QR UI** — mostrar link generado + QR image
8. **Products list: lightbox** — tap en imagen abre preview
9. **Products list: modal delete centered-card** — convertir de shared Modal a patrón centered card
10. **Brands/Categories: toggle Destacado** — acción de fila como en web
11. **Brands/Categories: doble confirm delete** — mostrar segundo dialog si hay productos asignados

### Phase 3 (P3 — polish)
12. **Toast strings verbatim** — actualizar a "Producto creado exitosamente" (web parity)
13. **Products list: popover → dropdown** — parity visual con web OptionsDropdown
14. **BrandForm: lightbox logo**
15. **Categories: lightbox imagen**
16. **BrandForm: sort por columnas**

---

## Handoff Notes

**Skills a cargar en cada implementación:**
- `mobile-dev` — obligatorio en todos los steps
- `vendix-restaurant-ops` — toggles restaurant suite (is_sellable/is_ingredient/is_combo/is_batch_produced)
- `vendix-product-variants` — reconcileVariants, cartesian, variant attributes
- `vendix-currency-formatting` — campos money
- `vendix-permissions` — gating en actions
- `vendix-frontend` — referencia para modal anatomy y centered-card pattern
- `vendix-subscription-gate` — si hay feature gates

**Backend:** compartido, no duplicar lógica. Endpoints ya consumidos por mobile via ProductService / BrandService / CategoryService.

**Visual acceptance criteria para cada step:**
- Modal centered card: backdrop rgba(15,23,42,0.45) · maxWidth 480px · header sin border-bottom · footer border-top 1px gray-200 · buttons content-sized right-aligned
- Labels: uppercase 10px bold gray-700 + red * required
- Toast verbatim strings de Web Visual Pattern
