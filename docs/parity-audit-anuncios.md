# Parity Audit — Marketing — Anuncios (STORE_ADMIN)

**Skill**: `mobile-parity-audit` v1.1 · **Date**: 2026-07-08
**Branch**: `feature/mobile-marketing-promotions-parity`
**Status**: 🚨 **GAP CRÍTICO** — Mobile NO implementa Anuncios en absoluto.

---

## Visual Baseline Loaded

- **Web Visual Pattern**: Centered-card modal anatomy (max-width 480px en `md`, backdrop `rgba(15,23,42,0.45)`), `text-xs font-bold uppercase text-gray-700` labels, footer con outline+primary content-sized buttons right-aligned + `border-top` separator, toast strings verbatim.
- **Code-level reference**: Engram `#384 — Mobile Web Visual Parity Pattern` (RNModal transparent wrapper, backdrop Pressable, KeyboardAvoidingView, maxWidth 480, exact tokens).
- **Mobile promotions precedent**: ya existe `apps/mobile/src/features/store/components/promotion-upsert-modal.tsx` con centered-card custom + `apps/mobile/app/(store-admin)/marketing/promotions/` como espejo funcional de web. El mismo patrón debe replicarse para Anuncios.

---

## Scope

- **Web target**: Módulo **"Anuncios"** (AI-driven ad creative generator para social publishing) — `apps/frontend/src/app/private/modules/store/marketing/anuncios/`
- **Surface / app_type**: `STORE_ADMIN` (sidebar gated by `panel_ui.marketing_anuncios === true`, no industry gating)
- **Mobile counterpart**: 🚫 **NO EXISTE** — `apps/mobile/app/(store-admin)/marketing/` solo tiene `promotions/` y un comment que menciona `coupons` (futuro, P2). El segmento `anuncios` no está en ninguna ruta, drawer, ni API endpoint.
- **Shared backend domain**: `apps/backend/src/domains/store/marketing-ad-creatives/` (controlador, servicio, 3 DTOs)

---

## Web Functional Inventory

### 1. Navigation / routes
| Path | Componente | Tipo |
|---|---|---|
| `/admin/marketing/anuncios` | `AnunciosComponent` | list + stats |
| `/admin/marketing/anuncios/create` | `AnuncioCreateWizardPageComponent` | 2-step wizard (Crear → Resultado) |

Sidebar entry: **Marketing → Anuncios** (icon `image`, `panel_ui.marketing_anuncios`).

### 2. Screens / views
- **List view** (`AnunciosComponent`)
  - 4 stats cards sticky (Anuncios total / Listos / Procesando / Fallidos)
  - Toolbar: title + count, search debounce 700ms, status select, "+ Nuevo anuncio" outline icon-only button
  - `ResponsiveDataView` table ↔ card list (md breakpoint)
- **Preview modal** (size `xl`) — image stage + sidebar (title / description / products / post sugerido)
- **Generation modal** (size `lg`) — streaming preview
- **Wizard page** (`AnuncioCreateWizardPageComponent`)
  - StickyHeader back → `/admin/marketing/anuncios`, badge `1/2` o `2/2`
  - Steps ribbon (Crear / Resultado) clickable
  - Step 0: form-card (hero strip, `app-input-buttons` format selector, textarea prompt, action dock, info banner sugerencias, error banner)
  - Step 0 sidebar (xl+): Resumen card + selected products chips + selected resources chips + live Resultado panel
  - Step 1: result grid (image stage con skeleton/halos/scan/prism animations + post-card aside)
  - Action dock final: `Crear otro` / `Regenerar con correccion` / `Ver biblioteca`
- **Modales adicionales del wizard**:
  - **Products picker** (size `lg`) — search input + list selectable de productos
  - **Gallery picker** (size `lg`) — grid de resources (logo, QR, sliders, fotos propias, fotos de producto) + `app-product-image-source-modal` para upload
  - **Correction modal** (size `md`) — textarea "Que quieres corregir?"

### 3. Actions / CTAs
**List view**:
- Search input (`app-inputsearch` debounce 700ms)
- Status select (Todos / Borrador / Procesando / Listos / Fallidos)
- `+ Nuevo anuncio` outline button → `router.navigate(['/admin/marketing/anuncios/create'])`
- Row click → `openPreviewModal`
- Row actions menu (ghost variants):
  - `Ver` (eye) → preview modal
  - `Copiar` (copy, only if `image_url`) → `clipboard.write(blob)`
  - `Descargar` (download) → save blob as `<slug>.<ext>`
  - `Compartir` (share-2) → `navigator.share({files, text, title})` con fallback a `clipboard.writeText`
  - `Eliminar` (trash-2, danger) → confirm dialog → DELETE
- Empty-state action `Crear anuncio` → navigate create
- Refresh on error / Clear filters on filtered-empty

**Preview modal footer**:
- `Copiar` / `Descargar` / `Compartir` (outline, sm)
- `Abrir tienda` (primary, external-link, only if `ecommerceUrl()`) → `window.open`

**Generation modal footer**:
- `Cerrar` (primary) — disabled while generating

**Wizard step 0 action dock** (4 buttons):
- `Cancelar` (ghost) → `goBack()`
- `Galeria` (outline, badge count) → gallery modal
- `Productos` (outline, badge count) → products modal
- `Sugerir` (outline, sparkles, loading) → `POST /suggest-prompt`
- `Generar anuncio` (primary, image-plus, loading) → `createAiAnuncio()`

**Wizard step 1 actions** (when not generating):
- `Crear otro` (ghost, rotate-ccw) → `restartWizard()`
- `Regenerar con correccion` (outline, refresh-cw) → open correction modal
- `Ver biblioteca` (primary) → navigate back

**Submodales**:
- Products picker: select toggle per row + `Listo` (primary footer)
- Gallery picker: `Agregar` (outline, upload-cloud) + resource toggle cards + `Listo` (primary footer)
- Correction modal: `Cancelar` (outline) + `Regenerar` (primary, refresh-cw, loading, disabled if `!correctionText.value.trim()`)

### 4. Forms & fields

**List filter form** (uncontrolled):
- `searchControl: FormControl<string>` (debounce 700ms)
- `<select>` status filter

**Wizard form** (`FormGroup<WizardFormControls>`):
| Field | Type | Default | Validator | Visible |
|---|---|---|---|---|
| `intent` | string | `'highlight_store'` | nonNullable | backend-only (rendered as `app-input-buttons` 6 options en OPTIONS extra — visual shown: Tienda, Producto/servicio, Novedad, Contacto, Promocion, QR) |
| `channel` | string | `'instagram_story'` | nonNullable | backend-only |
| `cta` | string | `'visitar_tienda'` | nonNullable | backend-only |
| `visual_style` | string | `'profesional'` | nonNullable | backend-only |
| `brief` | string | `''` | `maxLength(1500)` | backend-only |
| `prompt` | string | `''` | `maxLength(2000)` | **UI** (textarea rows=5, label "Idea o instrucciones") |
| `format` | `'square' \| 'story' \| 'landscape'` | `'story'` | nonNullable | **UI** (app-input-buttons 3 options) |

**Correction form**:
- `correctionText: FormControl<string>` default `''`, validator `maxLength(1000)`. Renders as `app-textarea` rows=5 label "Que quieres corregir?"

**State select (list)** — enum `['draft', 'processing', 'completed', 'failed']`

### 5. States
- **List loading** — `ResponsiveDataView.loading` skeleton
- **Empty / No data** — `icon='image-plus'`, title "Aun no tienes anuncios", CTA "Crear anuncio"
- **Empty / filtered** — title "Sin anuncios para estos filtros", showEmptyClearFilters
- **Empty / error** — title "No se pudieron cargar los anuncios", description = error, showEmptyRefresh
- **Generation streaming** — modal con message reactivo: "Preparando recursos..." → progress messages → "Recibiendo vista previa..." (con partial_image) → "Imagen lista. Redactando post..." → "Anuncio listo."
- **Wizard step 1 generating** — orbit animation, holo-grid, aurora, sparkles, halo, scan, prism, skeleton lines para post
- **Preview no-image** — `image-off` icon, "Este anuncio aun no tiene imagen generada."
- **Wizard gallery empty** — "Aun no hay recursos disponibles", icon `images`
- **Wizard products loading/error/empty** — spinner / empty-state with refresh / "Sin resultados"
- **Deletion dialog** — `DialogService.confirm({title:'Eliminar anuncio', message:'Se eliminara "{title}".', confirmText:'Eliminar', cancelText:'Cancelar'})`

### 6. Data display
**Table columns** (priority-driven responsive):
| Key | Label | Width | Sortable | Type |
|---|---|---|---|---|
| `preview_url` | '' | 56px | no | image (center) |
| `title` | 'Anuncio' | 260px | yes | text semibold, primary color md |
| `products_label` | 'Productos' | 240px | no | text, default "Sin productos" |
| `format` | 'Formato' | 140px | yes | transform: 'Feed cuadrado' / 'Historia vertical' / 'Banner horizontal' |
| `status` | 'Estado' | 120px center | yes | badge custom colorMap (draft/processing/completed/failed) |
| `created_at` | 'Creado' | 170px | yes | `Intl.DateTimeFormat('es-CO', {dateStyle:'medium', timeStyle:'short'})` |

**Card list**: avatar `preview_url` (square shape, fallback icon `image`), title, subtitle (description/prompt/"Sin descripcion"), detail keys (products_label `icon='package'`, format `icon='image'`), footer `created_at` "Creado".

### 7. Permissions & gating
- Frontend: route NO tiene guard. Sidebar gated por `panelUiConfig[STORE_ADMIN].marketing_anuncios === true` (`menu-filter.service.ts:102`).
- Backend: `@UseGuards(PermissionsGuard)` + per-route `@Permissions(...)`:
  - read: `store:marketing_anuncios:read` · `store:promotions:read` · `store:social_sales:read`
  - create: `store:marketing_anuncios:create` · `store:promotions:create` · `store:social_sales:manage`
  - generate: `store:marketing_anuncios:generate` · `store:promotions:create` · `store:social_sales:manage`
  - update: `store:marketing_anuncios:update` · `store:promotions:update` · `store:social_sales:manage`
  - delete: `store:marketing_anuncios:delete` · `store:promotions:delete` · `store:social_sales:manage`
- panel_ui default `marketing_anuncios: true` (`default-store-settings.ts:183`).
- Industry: NOT gated.
- Tenant scope: every endpoint hereda `RequestContextService.getContext()` (store_id auto from request).

### 8. Consumed endpoints (backend)
Base: `${environment.apiUrl}/store/marketing/ad-creatives`

| # | Method | Path | Permissions | Code | Body / Response |
|---|---|---|---|---|---|
| 1 | GET | `/summary` | read | 200 | `ApiResponse<MarketingAdCreativeSummary>` `{total, completed, processing, failed}` |
| 2 | GET | `/` | read | 200 | Query: `{page?, limit?(12), search?, status?, format?}` → `ApiResponse<MarketingAdCreative[]>` paginated |
| 3 | GET | `/ecommerce-domain` | read | 200 | `ApiResponse<MarketingAdEcommerceDomain \| null>` |
| 4 | GET | `/product-images/:imageId/proxy` | read/create/generate | 200 | binary `StreamableFile` |
| 5 | GET | `/:id/image` | read/create/generate | 200 | binary `StreamableFile`, query `variant=full\|thumb` `disposition=attachment\|inline` |
| 6 | POST | `/` | create | 201 | `CreateMarketingAdCreativeDto` → `ApiResponse<MarketingAdCreative>` msg "Anuncio creado" |
| 7 | POST | `/manual` | create | 201 | `CreateManualMarketingAdCreativeDto` (extends + `image_base64`) → msg "Anuncio manual creado" |
| 8 | POST | `/suggest-prompt` | create/generate | 200 | `SuggestMarketingAdPromptDto` → `ApiResponse<SuggestedMarketingAdPrompt>` `{suggested_prompt, suggested_title?, notes?}` msg "Sugerencia generada" |
| 9 | **SSE** | `/:id/generate-stream` | generate | 200 (event-stream) | `MessageEvent` con events `progress \| partial_image \| completed \| post_copy \| done \| error`; query `request_id`, `correction` |
| 10 | GET | `/:id` | read | 200 | `ApiResponse<MarketingAdCreative>` |
| 11 | PATCH | `/:id` | update | 200 | `UpdateMarketingAdCreativeDetailsDto` → msg "Anuncio actualizado" |
| 12 | DELETE | `/:id` | delete | 204 | msg "Anuncio eliminado" |

**DTO field constraints (verbatim)**:
- `title`: required, MaxLength(255)
- `description`: optional, MaxLength(1000)
- `prompt`: optional, MaxLength(2000)
- `intent`/`channel`: MaxLength(80)
- `cta`: MaxLength(120)
- `visual_style`: MaxLength(80)
- `brief`: MaxLength(1500)
- `format`: enum `['square','story','landscape']`, default `'square'`
- `product_ids`: array int, ArrayMaxSize(12)
- `product_image_ids`: array int, ArrayMaxSize(12)
- `reference_images`: array, ArrayMaxSize(12), `MarketingAdReferenceImageDto { image_url?(2048), image_base64?(16MB, regex data:image), source_type?(80), label?(255) }`
- `ai_app_key`: regex `/^[a-z][a-z0-9_]*$/`, MaxLength(100), default `'marketing_ad_image_generator'`
- `correctionText` (wizard only): MaxLength(1000)

**Cross-module endpoints consumed**:
- `GET /store/products?...` (limit 80) — products picker
- `GET /store/products/:id` — hydrate product images on select
- `GET /store/ecommerce/settings` — qr_code_data_url, slider.photos, inicio.logo_url

### 9. Side-effects
- **Toasts** (verbatim):
  - success: `'Anuncio eliminado.'`, `'Imagen descargada.'`, `'Imagen copiada.'`, `'Enlace copiado.'`, `'Enlace copiado para compartir.'`, `'Post copiado.'`
  - error: `'No se pudo generar la imagen.'`, `'No se pudo conectar con la generacion.'`, `'No se pudo descargar la imagen.'`, `'No se pudo compartir la imagen.'`, `'No se pudo copiar la imagen.'`, `'No se pudo leer el stream de generacion.'`, `'Se perdio la conexion con el stream.'`
  - Sugerir prompt error: `extractApiErrorMessage(error)`
- **Browser primitives**:
  - `navigator.clipboard.writeText(post_copy)` + `Enlace copiado.`
  - `navigator.clipboard.write(new ClipboardItem({ [mime]: blob }))` + `Imagen copiada.`
  - `navigator.share({files, title, text})` con fallback `clipboard.writeText` + `Enlace copiado para compartir.`
  - `URL.createObjectURL` + `<a download>` for file download
  - `window.open(url, '_blank', 'noopener,noreferrer')` for ecommerce URL
- **EventSource**: opened via `new EventSource(`${apiUrl}/${id}/generate-stream?token=...`)` (token via query, EventSource no soporta headers custom); listens `ai-chunk` MessageEvent.
- **Side-effects NOT triggered**: no journal entries, no inventory changes, no POS interactions, no DIAN.

### 10. Formatting concerns
- Currency: NO se renderiza currency en este módulo (productos tienen `base_price`/`sale_price` en payload pero no se muestran en UI).
- Dates:
  - Listado: `Intl.DateTimeFormat('es-CO', {dateStyle:'medium', timeStyle:'short'})`
  - Default title (cuando sugerencia vacía): `'YYYY-MM-DD HH:MM'` (locale `es-CO`)
  - Default description: `'Creado desde Anuncios el {YYYY-MM-DD HH:MM}'`
- Locale: `es-CO`. Toda la UI es español hardcoded.
- Time strings: `'Sin fecha'` fallback.
- Label maps:
  - `status` → 'Borrador' / 'Procesando' / 'Listo' / 'Fallido'
  - `format` (list) → 'Feed cuadrado' / 'Historia vertical' / 'Banner horizontal'
  - `format` (wizard sidebar) → `formatLabel()` returns the same (computed).
- Filename slug: `title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)` + extension from MIME (`.png`/`.jpg`/`.webp`).
- Image proxy URL: appends `?token=...` from `vendix_auth_state.tokens.access_token`.
- Post copy: append `\n\nConsigue esto y más en {host}` if `ecommerceUrl` exists and post doesn't already contain hostname.

### 11. Cross-module dependencies
**Services injected (DI)**:
- `AnunciosService`, `AdCreativeAssetService`
- `ProductsService`, `EcommerceService`
- `StoreSettingsFacade`, `ToastService`, `DialogService`
- `Router`, `DestroyRef`, `extractApiErrorMessage`, `ERROR_MESSAGES`

**Components reused**:
- `app-stats`, `app-card`, `app-button`, `app-modal`, `app-inputsearch`, `app-sticky-header`, `app-steps-line`, `app-input-buttons`, `app-textarea`, `app-icon`, `app-alert-banner`, `app-empty-state`, `app-responsive-data-view`, `app-product-image-source-modal`

### 12. Edge cases & business rules
- **Daily quota**: 3 generaciones por tienda cada 48h via Redis Lua (`consumeGenerationQuotaLua`). Error `MKT_AD_RATE_LIMIT_001` → "Alcanzaste el limite diario de 3 anuncios generados para esta tienda. Intenta de nuevo manana."
- **Redis Lua failure**: `MKT_AD_RATE_LIMIT_002` → "No pudimos verificar el limite diario de generacion. Intenta de nuevo en unos minutos."
- **Storage guard**: backend checks `hasAdStorage()` (3 tables: `marketing_ad_creatives`, `marketing_ad_creative_products`, `marketing_ad_creative_images`). If missing → falls back to raw SQL path / `MKT_AD_STORAGE_001`.
- **Generation idempotency**: `if (this.generatingId()) return;` (list component); wizard gates by `submitDisabled() = form.invalid || creating || generating`.
- **SSE stream lifecycle**: `markProcessing` → `aiEngine.runImageStream` (high quality, PNG, partialImages=2, inputFidelity='high' if references) → `saveGeneratedImage` → `consumeDailyGenerationQuota` → emit `completed` → `marketing_ad_post_copywriter` → emit `post_copy` → `done`.
- **Token in SSE**: `getAccessToken()` from `vendix_auth_state` localStorage.
- **Empty ecommerce domain**: `ecommerceUrlError='No hay dominio ecommerce activo.'` (preview still opens, "Abrir tienda" button hidden).
- **Status updates after SSE**: `done` and `error` events re-call `loadAnuncios()` + `loadSummary()`.
- **Replace strategy on completion**: `replaceAnuncio` swaps by id, otherwise prepends.
- **Resource dedupe in summary chip**: dedupes by `preview_url || id` to avoid `product-image-<id>` collisions when two products share images.
- **Image proxy**: backend echoes `Access-Control-Allow-Origin` from request + `Vary: Origin` + `Cross-Origin-Resource-Policy: cross-origin` to allow `<img>` rendering from same origin.
- **Generation modal**: while generating, `closeOnBackdrop=false`, `closeOnEscape=false`.
- **Dedupe of products during creation**: `uniqueNumbers(product_ids)`.
- **AI app key**: defaults to `marketing_ad_image_generator`; manual flow overrides to `manual_ad_editor`.
- **Tenant check**: `if (products.length !== productIds.length)` → `SYS_VALIDATION_001` "Uno o varios productos no pertenecen a la tienda actual."
- **QR overlay**: if any `creative_images[].source_type` includes `qr`, sharp composites the QR panel (max 280px) in a corner with 96% white background panel + 12% padding.
- **Manual image size limit**: 10MB (`sizeInBytes > 10 * 1024 * 1024` → `SYS_VALIDATION_001` "La imagen manual supera el tamano maximo permitido.").

---

## Web Visual Inventory

### 13. Visual & UX presentation

**Modal anatomy (universal)**:
| Modal | Size | Anatomy | Header | Footer |
|---|---|---|---|---|
| Preview modal | `xl` (1024px) | centered card | title + status subtitle, `cancel/closed` events | outline Copiar/Descargar/Compartir + primary "Abrir tienda", right-aligned, border-top separator |
| Generation modal | `lg` (640px) | centered card | "Generando anuncio" + dynamic subtitle, closeOnBackdrop disabled while generating | single primary "Cerrar" right-aligned |
| Products picker (wizard) | `lg` | centered card | "Agregar productos" + subtitle | single primary "Listo" right-aligned |
| Gallery picker (wizard) | `lg` | centered card | "Galeria de recursos disponibles" + subtitle | single primary "Listo" right-aligned |
| Correction modal (wizard) | `md` (480px) | centered card | "Regenerar con correccion" + subtitle | outline "Cancelar" + primary "Regenerar" right-aligned, gap-2 |

**Inputs (web `app-textarea` / `app-input-buttons`)**:
- Label: `text-xs font-bold uppercase` + tracking-wide
- Required indicator: red `*` (none required by `Validators`, all defaults keep form valid)
- Placeholders verbatim:
  - prompt: `'Ejemplo: quiero destacar mi tienda y que las personas escaneen el QR para ver el catalogo. Puedes escribirlo o usar Sugerir anuncio.'`
  - correctionText: `'Ej: el logo salio cortado, el texto no se lee...'`
  - search products modal: `'Buscar productos o servicios...'`
  - search anuncios: `'Buscar anuncios...'`
- Field wrapper: `rounded-[10px]` inputs, border `var(--color-border)`, focus ring primary.
- Error display: `app-alert-banner variant="danger"` inline (NO toast for form errors).

**Buttons (web `app-button`)**:
- Variants: `primary`, `outline`, `ghost`, `danger` (only on delete action).
- Sizes used: `sm` (32px), `md` (40px). Icons via `<app-icon slot="icon" name="..." size="...">`.
- Footer layout: outline + primary pair, content-sized (no fullWidth), right-aligned with `space-x-2/3`, `border-top` separator above.

**Labels (case/weight)**:
- All UI strings: Spanish, hardcoded (no `translate()`).
- Section title mobile: `text-[13px] font-semibold tracking-wide text-text-secondary`. Desktop: `md:text-lg md:font-semibold md:tracking-normal md:text-text-primary`.
- Card titles: bold; secondary text: `text-text-secondary` token.
- "Producto" chip badge inside selected product chips: `text-[10px] font-semibold uppercase leading-4 tracking-wide` + bg `var(--color-primary-light)` + text `var(--color-primary)`.
- "AI count badge" (wizard Galeria/Productos buttons): `min-width:1.1rem; height:1.1rem; border-radius:9999px; font-size:0.7rem; font-weight:600; color:var(--color-primary); background:rgba(var(--color-primary-rgb),0.14)`.

**Colors / tokens**:
- Stats cards: `bg-sky-100/text-sky-600`, `bg-emerald-100/text-emerald-600`, `bg-amber-100/text-amber-600`, `bg-red-100/text-red-600`.
- Status badge `colorMap`: `draft=#6b7280, processing=#f59e0b, completed=#22c55e, failed=#ef4444`.
- Primary token: `var(--color-primary)`, `var(--color-primary-light)`, `var(--color-primary-rgb)`.
- Success: `var(--color-success, #16a34a)`; Success soft: `var(--color-success-soft, #dcfce7)`.
- Info: `var(--color-info, #6366f1)`; Danger: `var(--color-danger, #dc2626)`.
- Surface: `var(--color-surface)`, `var(--color-surface-muted)`, `var(--color-background)`.
- Text: `var(--color-text-primary)`, `var(--color-text-secondary)`, `var(--color-text-muted)`.

**Icons used (Lucide via `app-icon`)**:
`image`, `image-plus`, `image-off`, `check-circle`, `loader-2` (with `[spin]`), `triangle-alert`, `plus`, `copy`, `download`, `share-2`, `trash-2`, `eye`, `external-link`, `sparkles`, `x`, `images`, `package`, `barcode`, `upload-cloud`, `search-x`, `check`, `clipboard-check`, `rotate-ccw`, `refresh-cw`, `megaphone`, `tag`, `layout-grid`, `smartphone`, `monitor`, `store`, `message-square`.

**Animations (wizard only)**:
- `ai-orbit`, `ai-holo-grid`, `ai-holo-aurora`, `ai-result-stage__halo`, `ai-result-stage__shimmer`, `ai-result-stage__scan`, `ai-result-stage__prism`, `ai-dot-pulse`, `ai-sparkle--a..e`, `ai-skeleton-line`, `ai-scan-line`, `ai-icon-breathe`, `ai-soft-pulse`, `ai-shimmer-sweep`, `ai-halo-spin`, `ai-orbit-spin`, `ai-holo-grid-drift`, `ai-holo-aurora-shift`, `ai-breathe`, `ai-sparkle-twinkle`.
- `@media (prefers-reduced-motion: reduce)` disables all custom animations.

**Spacing & radii**:
- `p-2 md:p-6`, `gap-2/3/4`, `rounded-[10px]` inputs, `rounded-lg` cards, `rounded-2xl` AI panels, `rounded-full` badges.
- Sticky stats: `sticky top-0 z-20 bg-background md:static md:bg-transparent`.
- Toolbar sticky: `sticky top-[99px] z-10 -mt-[5px] bg-background px-2 py-1.5`.

### 14. Toast & feedback copy (verbatim)

**Successes**:
- `'Anuncio eliminado.'`
- `'Imagen descargada.'`
- `'Imagen copiada.'`
- `'Enlace copiado.'`
- `'Enlace copiado para compartir.'`
- `'Post copiado.'`

**Errors**:
- `'No se pudo generar la imagen.'`
- `'No se pudo conectar con la generacion.'`
- `'No se pudo descargar la imagen.'`
- `'No se pudo compartir la imagen.'`
- `'No se pudo copiar la imagen.'`
- `'No se pudo leer el stream de generacion.'`
- `'Se perdio la conexion con el stream.'`
- `extractApiErrorMessage(error)` for everything else → `ERROR_MESSAGES[error_code]` mapping:
  - `MKT_AD_RATE_LIMIT_001` → "Alcanzaste el limite diario de 3 anuncios generados para esta tienda. Intenta de nuevo manana."
  - `MKT_AD_RATE_LIMIT_002` → "No pudimos verificar el limite diario de generacion. Intenta de nuevo en unos minutos."
  - `MKT_AD_STORAGE_001` → "El modulo de Anuncios se esta preparando. Intenta de nuevo en unos minutos."
  - `AI_REQUEST_001` → "La solicitud al proveedor de IA fallo."
  - `SYS_VALIDATION_001` → "Los datos ingresados no son validos."
  - `SYS_NOT_FOUND_001` → "El recurso solicitado no fue encontrado."
  - `SYS_FORBIDDEN_001` → "No tiene permisos para realizar esta accion."
  - `SYS_UNAUTHORIZED_001` → "Debe iniciar sesion para continuar."
  - `PROD_IMAGE_001` → "Imagen no encontrada."
  - default → `'Ocurrio un error. Intente de nuevo.'`

**Inline alert banners**:
- `app-alert-banner variant="danger" icon="triangle-alert"` — surfaces API errors.
- `app-alert-banner variant="info" icon="sparkles"` — `suggestionNotes` returned by prompt-specialist.
- `app-alert-banner variant="info" icon="barcode"` — "El QR seleccionado se insertara identico en la imagen final, con buen contraste y sin tapar el diseno." (only when QR selected).

**Modal titles/subtitles (verbatim)**:
- Generation modal: `'Generando anuncio'` + `generationMessage()`
- Preview modal: title `selectedAnuncio()?.title || 'Anuncio'`, subtitle `selectedAnuncioStatusLabel()`
- Products modal: `'Agregar productos'` + `'Elige solo lo que debe influir en el anuncio.'`
- Gallery modal: `'Galeria de recursos disponibles'` + `'Logo, QR, sliders, fotos propias y las imagenes de tus productos para guiar la pieza visual.'`
- Correction modal: `'Regenerar con correccion'` + `'Describe que debe ajustar la IA y se generara sobre el mismo anuncio.'`
- Delete dialog: `'Eliminar anuncio'` + `Se eliminara "{title}".` + confirm `'Eliminar'` + cancel `'Cancelar'`

**Empty states (verbatim)**:
- Anuncios list default: title `'Aun no tienes anuncios'`, description `'Selecciona productos, agrega una idea y deja que la IA genere una pieza visual lista para compartir.'`, action `'Crear anuncio'`
- Filtered: title `'Sin anuncios para estos filtros'`, description `'Ajusta la busqueda o limpia los filtros para ver otros anuncios.'`
- Error: title `'No se pudieron cargar los anuncios'`, description = error message
- Products modal empty: title `'Sin resultados'`, description `'Prueba con otro nombre o SKU.'`
- Products error empty: title `'No se pudieron cargar productos'`, description = error message
- Gallery empty: title `'Aun no hay recursos disponibles'`, description `'Agrega productos o sube recursos para verlos aqui.'`
- Wizard summary no resources: `'Aun no has elegido fotos, logos o QR.'`
- Wizard summary no products: `'Aún no has agregado productos.'`
- Result no post hint: `'El texto del post se genera cuando la imagen este lista.'`
- Result error hint: `'Sin post aun: se genera tras una imagen exitosa.'`
- Preview no image: `'Este anuncio aun no tiene imagen generada.'`

**Wizard sticky header**: title `'Crear anuncio'`, subtitle `'Crea una imagen y un post listo para publicar.'`, badge `'1/2'` or `'2/2'`.

**Section titles**:
- List: `'Anuncios'` + count; sticky stats titles `'Anuncios'`, `'Listos'`, `'Procesando'`, `'Fallidos'`; smallTexts `'Creatividades creadas'`, `'Disponibles para publicar'`, `'Generaciones activas'`, `'Requieren reintento'`
- Table columns: `''` (preview), `'Anuncio'`, `'Productos'`, `'Formato'`, `'Estado'`, `'Creado'`
- Card list footer: `'Creado'`
- Step 0 hero: `'Que quieres comunicar?'` + helper `'Elige el formato, describe tu idea, agrega imágenes, productos o un QR, y genera el anuncio con Vendix IA.'`
- Step 1 headers: `'Generando tu anuncio'` / `'Tu anuncio esta listo'` + subtitle `generationMessage()` or `'Copia el post o vuelve a la biblioteca.'`
- Summary card: title `'Resumen'` + subtitle `formatLabel(currentFormat())` + rows: intentLabel, `'{n} productos'`, `'{n} recursos'`, `'QR exacto incluido'` (when QR selected)
- Result panel: title `'Resultado'` + subtitle `generationMessage()` or `'Anuncio listo'`
- Post ready labels: `'Post listo'` / `'Post para publicar'` / `'Post sugerido'`
- Pending post skeleton helper: `'Redactando post...'`

**Buttons (verbatim)**:
`'Cancelar'`, `'Galeria'`, `'Productos'`, `'Sugerir'`, `'Generar anuncio'`, `'Listo'`, `'Agregar'`, `'Regenerar'`, `'Crear otro'`, `'Regenerar con correccion'`, `'Ver biblioteca'`, `'Cerrar'`, `'Copiar'`, `'Descargar'`, `'Compartir'`, `'Abrir tienda'`, `'Eliminar'`

### 15. Validation message parity
- **Backend (class-validator)**:
  - `title`: `IsString @MaxLength(255)` (required)
  - `description`: `@IsOptional @IsString @MaxLength(1000)`
  - `prompt`: `@IsOptional @IsString @MaxLength(2000)`
  - `brief`: `@IsOptional @IsString @MaxLength(1500)`
  - `correctionText` (mobile+web side, no DTO): `Validators.maxLength(1000)`
  - `intent`/`channel`: `@MaxLength(80)`
  - `cta`: `@MaxLength(120)`
  - `visual_style`: `@MaxLength(80)`
  - `format`: `@IsIn(['square','story','landscape'])`
  - `product_ids`: `@ArrayMaxSize(12) @IsInt({each:true})`
  - `reference_images`: `@ArrayMaxSize(12) @ValidateNested({each:true})`
  - `image_base64` (ref/manual): `@Matches(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/)` @MaxLength(16_000_000)
  - `ai_app_key`: regex `/^[a-z][a-z0-9_]*$/` @MaxLength(100)
  - Query: `page @Min(1)`, `limit @Min(1) @Max(100)` default 12, `status @IsIn(['draft','processing','completed','failed'])`, `format @IsIn(['square','story','landscape'])`
- **Frontend (reactive forms)**:
  - `prompt`: `Validators.maxLength(2000)`
  - `brief`: `Validators.maxLength(1500)`
  - `correctionText`: `Validators.maxLength(1000)`
  - No `Validators.required` — defaults keep form valid.
- **Error mapping**: backend `error_code` → `ERROR_MESSAGES[code]` → frontend `extractApiErrorMessage()` surfaces the human-readable string as toast.

---

## Mobile Current State

🚨 **El módulo Marketing en mobile es SOLO Promociones.** No existe nada relacionado con Anuncios:

| Capability | Mobile Status |
|---|---|
| Route `/(store-admin)/marketing/anuncios` | 🚫 **Ausente** |
| Route `/(store-admin)/marketing/anuncios/create` | 🚫 **Ausente** |
| Drawer entry "Anuncios" | 🚫 **Ausente** (sólo existe `Marketing → promotions`) |
| `Endpoints.STORE.MARKETING_AD_CREATIVES` constants | 🚫 **Ausente** en `apps/mobile/src/core/api/endpoints.ts` |
| `AnunciosService` | 🚫 **Ausente** en `apps/mobile/src/features/store/services/` |
| `AdCreativeAssetService` (download/share/copy) | 🚫 **Ausente** |
| Types `MarketingAdCreative`, `CreateMarketingAdCreativeDto`, etc. | 🚫 **Ausente** en `apps/mobile/src/features/store/types/` |
| Labels `ANUNCIO_LABELS` | 🚫 **Ausente** en `apps/mobile/src/features/store/constants/` |
| List screen + stats cards + filters | 🚫 **Ausente** |
| Create wizard (2-step) + products picker + gallery picker | 🚫 **Ausente** |
| Correction modal | 🚫 **Ausente** |
| Preview modal | 🚫 **Ausente** |
| Generation modal (SSE streaming) | 🚫 **Ausente** |
| `useAiStream` SSE hook | 🚫 **Ausente** (pero `use-query`+`react-query` ya están en `apps/mobile/src/core/api/`) |
| `use-can` permissions hook consumption | 🚫 **Ausente** (los permisos `store:marketing_anuncios:*` no se consultan en ningún componente mobile — gap de seguridad replicado del módulo promotions) |

**Mobile precedents reusable** (the Promociones module is the template to mirror):
- `apps/mobile/app/(store-admin)/marketing/_layout.tsx` — Stack parent
- `apps/mobile/app/(store-admin)/marketing/promotions/index.tsx` — list pattern (FlatList + infinite query + stats cards + filters + Pagination + ConfirmDialog)
- `apps/mobile/app/(store-admin)/marketing/promotions/[id].tsx` — detail pattern (StickyHeader + cards + footer actions)
- `apps/mobile/app/(store-admin)/marketing/promotions/_layout.tsx`
- `apps/mobile/src/features/store/services/promotions.service.ts` — axios service pattern
- `apps/mobile/src/features/store/types/promotions.types.ts`
- `apps/mobile/src/features/store/constants/promotion-labels.ts`
- `apps/mobile/src/features/store/components/promotion-{card,filters,stats-cards,tier-row,upsert-modal}.tsx`
- `apps/mobile/src/features/store/components/product-upsert-form.tsx` (lines ~430-433, ~2130-2160) — example of MultiSelector for cross-feature

**Visual baseline available in mobile**:
- Modal (centered-card custom + full-screen shared variants)
- ConfirmDialog (centered-card with primary/destructive header)
- StickyHeader, Button (primary/secondary/outline/ghost/destructive), Input, Textarea, Toggle, Selector, MultiSelector, InputButtons
- Card, Badge (default/neutral/primary/success/warning/error/info × xsm/xs/sm/md × solid/outline), ListItem, SearchBar (debounceMs), EmptyState, Spinner
- RowActionsMenu (info/primary/warning/danger variants), FilterDropdown (popover), Pagination, StatsCard/StatsGrid
- ToastContainer + `useToastStore` API (`toastSuccess`, `toastError`, `toastWarning`, `toastInfo`)
- DatePicker (native bottom sheet)
- Icon (lucide-react-native)
- BottomSheet, ScrollableTabs (exist but not used by marketing)

---

## Strategic Gap Map

| Capability | Web | Mobile (func) | Mobile (visual) | Status | Priority | Endpoint / gate | Visual notes |
|---|---|---|---|---|---|---|---|
| **List screen** (Anuncios) | ✅ | ❌ | — | Absent | P0 | `GET /store/marketing/ad-creatives` + `/summary` · perm `marketing_anuncios:read` | New route + screen |
| **4 stats cards** (total/completed/processing/failed) | ✅ | ❌ | — | Absent | P0 | `GET /store/marketing/ad-creatives/summary` | Mirror `PromotionStatsCards` pattern |
| **Search bar** (debounce 700ms) | ✅ | ❌ | — | Absent | P0 | `?search=` | Use shared `SearchBar` (existing mobile supports `debounceMs`) |
| **Status filter** (Todos/Borrador/Procesando/Listos/Fallidos) | ✅ | ❌ | — | Absent | P0 | `?status=` | Use `FilterDropdown` with status options |
| **Card list / table row** (avatar preview, title, products, format, status badge, created) | ✅ | ❌ | — | Absent | P0 | n/a (response payload) | Mirror `PromotionCard` shape (avatar `preview_url`, badge `status` with colorMap) |
| **Empty state** ("Aun no tienes anuncios" + CTA "Crear anuncio") | ✅ | ❌ | — | Absent | P0 | n/a | Mirror verbatim Spanish copy |
| **Empty state (filtered)** | ✅ | ❌ | — | Absent | P1 | n/a | Verbatim copy |
| **Empty state (error)** | ✅ | ❌ | — | Absent | P1 | n/a | Verbatim copy |
| **Pull-to-refresh** | ✅ | ❌ | — | Absent | P0 | n/a | Mirror `RefreshControl` from promotions |
| **Preview modal** (image + title + description + products + post sugerido) | ✅ | ❌ | — | Absent | P0 | `GET /store/marketing/ad-creatives/:id` | Custom centered-card modal (NOT full-screen shared Modal) |
| **Preview footer** (Copiar/Descargar/Compartir/Abrir tienda) | ✅ | ❌ | — | Absent | P0 | uses `AdCreativeAssetService` | Mirror button row with right-aligned outline buttons |
| **Delete confirm dialog** (Eliminar anuncio) | ✅ | ❌ | — | Absent | P0 | `DELETE /store/marketing/ad-creatives/:id` | Use shared `ConfirmDialog` |
| **Toast strings** ("Anuncio eliminado." etc.) | ✅ | ❌ | — | Absent | P0 | n/a | Verbatim strings, use `toastSuccess`/`toastError` |
| **Generation modal (SSE streaming)** | ✅ | ❌ | — | Absent | P0 | `SSE /store/marketing/ad-creatives/:id/generate-stream?token=...&request_id=...&correction=...` | Custom centered-card; React Native `EventSource` polyfill or `react-native-sse` |
| **Create wizard — Step 0** (StickyHeader + steps ribbon + form) | ✅ | ❌ | — | Absent | P0 | `POST /store/marketing/ad-creatives/suggest-prompt` + `POST /` | Custom full-screen route (wizard needs full vertical space) |
| **Format input-buttons** (1:1 Feed / 9:16 Story / 16:9 Banner) | ✅ | ❌ | — | Absent | P0 | n/a (form field) | Use shared `InputButtons` component |
| **Prompt textarea** | ✅ | ❌ | — | Absent | P0 | n/a (form field) | Use shared `Textarea` (maxLength 2000) |
| **Sugerir button** (sparkles, loading, calls suggest-prompt) | ✅ | ❌ | — | Absent | P0 | `POST /store/marketing/ad-creatives/suggest-prompt` | Verbatim "Sugerir" label, sparkles icon |
| **Products picker modal** (search + selectable list) | ✅ | ❌ | — | Absent | P0 | `GET /store/products?limit=80` + `GET /store/products/:id` | Custom centered-card modal, max 360px height scroll |
| **Gallery picker modal** (resources grid + Agregar + Listo) | ✅ | ❌ | — | Absent | P0 | uses `EcommerceService.getSettings()` + `StoreSettingsFacade` | Custom centered-card modal with 2/3/4 col grid |
| **Resource uploader (product-image-source-modal)** | ✅ | ❌ | — | Absent | P1 | depends on `ProductImageSourceModal` shared — already exists in mobile at `apps/mobile/src/features/store/components/image-source-modal.tsx` | Verify reuse; if functional-equivalent exists, wire it |
| **Correction modal** (md, textarea, Regenerar) | ✅ | ❌ | — | Absent | P0 | `POST /generate-stream?...&correction=...` | Centered-card modal with `Que quieres corregir?` label |
| **Wizard Step 1 — Result stage** (image + halo + scan + prism + sparkles) | ✅ | ❌ | — | Absent | P0 | SSE `completed` event | Full-screen route view; reduce-motion respect |
| **Wizard Step 1 — Post card** (whitespace-pre-line + copy button) | ✅ | ❌ | — | Absent | P0 | SSE `post_copy` event | React Native equivalent of `whitespace-pre-line` |
| **Wizard sidebar (xl+) — Resumen** (intent, products count, resources count, QR exacto) | ✅ | ❌ | — | Absent | P1 | computed from signals | Mobile renders as top sticky card instead of right sidebar |
| **Crear otro / Regenerar con correccion / Ver biblioteca** | ✅ | ❌ | — | Absent | P0 | n/a (UI only) | Verbatim labels |
| **Ecommerce URL detection** ("Abrir tienda" button + hostname display) | ✅ | ❌ | — | Absent | P1 | `GET /store/marketing/ad-creatives/ecommerce-domain` | Open external URL via `Linking.openURL` |
| **Image share/download/copy** (asset service) | ✅ | ❌ | — | Absent | P0 | `GET /store/marketing/ad-creatives/:id/image?variant=full` | RN: `expo-file-system` to save blob, `expo-sharing` for share, `expo-clipboard` for copy |
| **Permissions gating** (sidebar + per-action) | ✅ | ❌ | — | Absent | P1 | perm `marketing_anuncios:read` etc. | Use existing `useCan` or `usePermissions` hooks; owners/admins bypass (same as promotions) |
| **Daily quota error handling** (`MKT_AD_RATE_LIMIT_001`) | ✅ | ❌ | — | Absent | P1 | backend returns error_code | Surface via `extractApiErrorMessage` toast (already in `apps/mobile/src/core/api/`) |
| **Manual ad creation** (`POST /manual`) | ✅ | ❌ | — | N/A-mobile | — | backend capability exists, web does NOT use it | N/A-mobile (justified: web doesn't use it either) |
| **PATCH updateDetails** (`PATCH /:id`) | ✅ | ❌ | — | N/A-mobile | — | backend capability exists, web does NOT use it | N/A-mobile (justified: web doesn't use it) |

---

## Coverage Summary

- **Total capabilities inventoried**: 32
- **Functional axis**:
  - Present (mobile = web): **0 / 32 (0%)**
  - Partial: **0**
  - Absent: **30 / 32 (93.7%)**
  - N/A-mobile (justified): **2 / 32 (6.3%)** — manual ad + patch update (web doesn't use them either)
- **Visual axis**:
  - Not evaluated (nothing to compare against since functional is 0)
- **Combined parity**: **0%** — Mobile NO implementa el módulo Anuncios. El gap es total: no hay rutas, no hay drawer entry, no hay servicio, no hay tipos, no hay pantallas.

---

## Recommended Sequencing (input to how-to-plan)

The gap is total — implementation must build the module from scratch on top of the existing promotions precedent. Dependency-ordered:

### P0 (Block — must be first)

1. **API layer + types + labels** — define `Endpoints.STORE.MARKETING_AD_CREATIVES` constants, `MarketingAdCreative`/`AdCreativeFormat`/`AdCreativeStatus` types, `ANUNCIO_LABELS` constants (Spanish verbatim), `AnunciosService` (axios), `AdCreativeAssetService` (RN-friendly download/share/copy using `expo-file-system` + `expo-sharing` + `expo-clipboard`). **Reuse `promotions.service.ts` + `promotion-labels.ts` structure as template.**
2. **Drawer entry + route registration** — add "Anuncios" to drawer-menu.tsx (`icon='image'`, gated by `panelUiConfig[STORE_ADMIN].marketing_anuncios`), add `<Stack.Screen name="anuncios" />` to `marketing/_layout.tsx`.
3. **List screen** — `apps/mobile/app/(store-admin)/marketing/anuncios/index.tsx` mirroring `promotions/index.tsx`: FlatList + infinite query + 4 stats cards + search + status filter + PullToRefresh + EmptyState + ConfirmDialog.
4. **Stats cards component** — `anuncios-stats-cards.tsx` mirroring `promotion-stats-cards.tsx`.
5. **Card component** — `anuncio-card.tsx` with avatar `preview_url`, status badge with colorMap, products detail, format detail, footer date, RowActionsMenu (Ver/Copiar/Descargar/Compartir/Eliminar with visibility logic).
6. **Empty state + filters** — `anuncio-filters.tsx` with status select dropdown.
7. **Preview modal** — custom centered-card modal (NOT shared full-screen) with image + title + description + products + post sugerido + footer buttons (Copiar/Descargar/Compartir/Abrir tienda).
8. **Delete confirm + toast verbatim strings** — use shared `ConfirmDialog`, wire `toastSuccess('Anuncio eliminado.')` etc.
9. **Create wizard — Stack route + StickyHeader + steps ribbon** — `apps/mobile/app/(store-admin)/marketing/anuncios/create.tsx` with full-screen custom layout (wizard needs vertical space), StepsLine equivalent (use mobile pattern, possibly 2-pill ribbon).
10. **Create wizard — Step 0 form** — Format `InputButtons` (3 options square/story/landscape) + Prompt `Textarea` (maxLength 2000) + action dock (Cancelar/Galeria/Productos/Sugerir/Generar anuncio).
11. **Create wizard — Products picker modal** — custom centered-card with search input + selectable list (max 360px scroll).
12. **Create wizard — Gallery picker modal** — custom centered-card with 2/3/4 col resource grid + Agregar button (opens image-source-modal) + Listo.
13. **Create wizard — Generate action** — POST `/` then connect to SSE `generate-stream`. Need an SSE hook for React Native (no native EventSource — use `react-native-sse` or implement polling fallback).
14. **Create wizard — Generation modal / SSE consumer** — custom centered-card modal showing message + partial_image preview + final image.
15. **Create wizard — Step 1 result stage + post card + Crear otro / Regenerar con correccion / Ver biblioteca actions**.
16. **Correction modal** — custom centered-card with textarea "Que quieres corregir?" + Regenerar.
17. **Image share/download/copy integration** — `AdCreativeAssetService` uses `expo-file-system` to save blob to cache dir + `expo-sharing` to open share sheet + `expo-clipboard` for image copy. Mirror web `download`/`share`/`copy` flows.

### P1 (Important but not blocking)

18. **Permissions gating** — call `useCan('store:marketing_anuncios:read')` etc. in route components (gap that promotions already has).
19. **Ecommerce URL integration** — load `ecommerce-domain` on preview open, render "Abrir tienda" button with `Linking.openURL(url)`.
20. **Wizard sidebar Resumen card** (on wide screens or as top sticky card) — show intent + products count + resources count + QR exacto label.
21. **Reduce-motion respect** — wrap AI-style animations (orbit, halo, scan, prism, sparkles) in `AccessibilityInfo.isReduceMotionEnabled` checks or use simple RN `Animated` loops without custom SVG.

### P2 (Post-MVP polish)

22. **Empty state (filtered / error)** — separate titles + descriptions.
23. **Wizard action dock badge counters** — show count badges on Galeria and Productos buttons.

---

## Visual Acceptance Criteria (for any mobile implementation)

For each mobile implementation to count as `Present` on the visual axis, the following MUST be true (anchored to Web Visual Pattern):

1. **All modals** (preview, generation, products picker, gallery picker, correction, delete confirm) use **centered-card anatomy** (NOT the shared full-screen `Modal`):
   - Backdrop: `rgba(15,23,42,0.45)` or `rgba(0,0,0,0.45)` (consistent with promotions precedent)
   - Card wrapper: `maxWidth: 480` (md), 640 (lg), 1024 (xl)
   - Vertically centered
   - Card surface: white bg, border-radius `lg` (12px), 1px border `var(--color-border)`, shadow
   - Header: title + close X (NO border-bottom)
   - Body: 16px padding, 16px gap between fields
   - Footer: outline + primary pair, content-sized, right-aligned, `border-top` separator
2. **All toast strings verbatim** from §14.
3. **All empty-state copy verbatim** from §14.
4. **All button labels verbatim** from §14.
5. **All placeholder strings verbatim** from §14.
6. **All validation constraints** match backend DTO MaxLength and enum values from §8.
7. **All Spanish labels hardcoded** (no `translate()` calls in this module — same precedent as promotions).
8. **Color tokens**: use shared `colors`/`colorScales`/`spacing`/`borderRadius`/`typography` from `@/shared/theme` (NOT ad-hoc hex values).
9. **Icons via shared `Icon`** with Lucide names verbatim from §13.
10. **Reduced-motion** respected (omit AI-style CSS animations; use simple `Animated` loops where needed).

---

## Backend Domain Reference (for mobile implementation)

```
apps/backend/src/domains/store/marketing-ad-creatives/
├── marketing-ad-creatives.controller.ts        # 12 endpoints
├── marketing-ad-creatives.service.ts          # business logic + SSE generator + Redis quota
├── marketing-ad-creatives.module.ts
├── dto/
│   ├── create-marketing-ad-creative.dto.ts    # CreateManualMarketingAdCreativeDto + MarketingAdReferenceImageDto + SuggestMarketingAdPromptDto + UpdateMarketingAdCreativeDetailsDto
│   ├── query-marketing-ad-creatives.dto.ts    # page/limit/search/status/format
│   └── index.ts
```

**SSE events emitted** (consume from mobile `react-native-sse`):
```ts
type AdCreativeStreamEvent =
  | { type: 'progress'; message?: string }
  | { type: 'partial_image'; imageBase64?: string; partialImageIndex?: number }
  | { type: 'completed'; creative?: MarketingAdCreative; post_copy?: string; usage?: any; model?: string; revisedPrompt?: string }
  | { type: 'post_copy'; post_copy?: string; creative?: MarketingAdCreative }
  | { type: 'done' }
  | { type: 'error'; error?: string; error_code?: string; details?: Record<string, unknown> };
```

**Quota logic**:
- 3 generations per store per 48h via Redis Lua.
- `MKT_AD_RATE_LIMIT_001` → error message "Alcanzaste el limite diario de 3 anuncios generados..."
- `MKT_AD_RATE_LIMIT_002` → fallback when Redis unreachable.

---

## Handoff

**Input for `how-to-plan`**: This report's `Scope` → plan `Context`; each Absent/Partial capability → plan `Steps`; `Recommended Sequencing` → step order. Every plan step MUST list `mobile-dev` in `Skills` (edits exclusive to `apps/mobile/`), plus `vendix-permissions` (for permission gating P1) and any visual-acceptance references the step needs.

**Visual-partial rows** (none currently because functional is 0%) become plan steps with explicit visual acceptance criteria anchored on the Web Visual Pattern (§13-15 of this report + Engram #384).