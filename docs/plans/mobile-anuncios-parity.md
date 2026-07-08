## Context

El módulo **Marketing — Anuncios** (AI-driven ad creative generator para social publishing) está implementado al 100% en `apps/frontend` (12 endpoints, 2-step wizard con SSE streaming, products picker, gallery picker, correction modal, image share/download/copy, ecommerce domain integration con QR overlay, daily quota de 3 generaciones por tienda cada 48h vía Redis Lua) pero **NO EXISTE en `apps/mobile`**. La auditoría de paridad (`docs/parity-audit-anuncios.md`) reporta 0% de paridad funcional: ninguna ruta, ningún servicio, ningún componente, ningún endpoint. El módulo mobile **Promociones** (pariente en el mismo grupo de marketing) es la plantilla funcional y visual a replicar, con la salvedad de que Anuncios requiere SSE streaming y manejo de imágenes generado por IA, lo que introduce complejidad adicional no presente en Promociones.

Outcome esperado: la app móvil (Expo + React Native) replica el módulo web Anuncios end-to-end — lista con stats cards y filtros, preview modal, create wizard de 2 pasos con products picker y gallery picker, SSE generation streaming, correction modal, image share/download/copy — usando el patrón visual web (centered-card modals, labels uppercase con asterisco rojo, footer con outline+primary right-aligned, toast strings verbatim) sin duplicar lógica backend (mobile-dev RULE 6: reusar el endpoint compartido).

## General Objective

Implementar el módulo Marketing — Anuncios en `apps/mobile` con paridad funcional y visual completa respecto a `apps/frontend/src/app/private/modules/store/marketing/anuncios/`, reusando los endpoints backend existentes y la plantilla visual del módulo Promociones ya presente en mobile.

## Specific Objectives

1. Definir los endpoints `Endpoints.STORE.MARKETING_AD_CREATIVES`, los tipos TypeScript (`MarketingAdCreative`, `AdCreativeFormat`, `AdCreativeStatus`, `MarketingAdCreativeSummary`, `MarketingAdEcommerceDomain`, DTOs de create/query/suggest), el `AnunciosService` (axios) y el `AdCreativeAssetService` (download/share/copy usando `expo-file-system` + `expo-sharing` + `expo-clipboard`) — todo bajo `apps/mobile/src/features/store/services/` y `apps/mobile/src/features/store/types/`.
2. Crear las constantes de labels `ANUNCIO_LABELS` con todos los strings en español verbatim del web (estado Borrador/Procesando/Listo/Fallido, formato Feed cuadrado/Historia vertical/Banner horizontal, empty states, modal titles, button labels, toast strings).
3. Registrar el drawer entry "Anuncios" (`icon='image'`, gated por `panelUiConfig[STORE_ADMIN].marketing_anuncios`) y agregar `<Stack.Screen name="anuncios" />` a `apps/mobile/app/(store-admin)/marketing/_layout.tsx`.
4. Crear la pantalla lista en `apps/mobile/app/(store-admin)/marketing/anuncios/index.tsx` con FlatList + useInfiniteQuery + 4 stats cards + SearchBar (debounceMs 700) + FilterDropdown status + PullToRefresh + EmptyState + ConfirmDialog para delete — siguiendo exactamente el patrón de `promotions/index.tsx`.
5. Crear `anuncios-stats-cards.tsx` (4 cards: total / completados / procesando / fallidos) y `anuncio-card.tsx` (avatar preview_url con fallback `image`, badge de estado con colorMap, products detail, format detail, footer created_at formateado, RowActionsMenu con visibilidad por estado).
6. Crear la ruta detalle en `apps/mobile/app/(store-admin)/marketing/anuncios/[id].tsx` con StickyHeader + ScrollView + 4-6 cards (Identidad / Estado / Formato / Productos / Post sugerido) + footer actions.
7. Crear el modal de preview (centered-card custom ≤480px en `md`, 1024 en `xl`) con image + title + description + products + post sugerido + footer (Copiar/Descargar/Compartir/Abrir tienda).
8. Crear la ruta del wizard en `apps/mobile/app/(store-admin)/marketing/anuncios/create.tsx` con StickyHeader + 2-step ribbon (Crear / Resultado) — Step 0 con Format `InputButtons` (3 options) + Prompt `Textarea` (maxLength 2000) + action dock (Cancelar/Galeria/Productos/Sugerir/Generar anuncio).
9. Crear el modal products picker (centered-card custom `lg` con search input + lista selectable scroll 360px).
10. Crear el modal gallery picker (centered-card custom `lg` con grid 2/3/4 cols de resources + botón Agregar + Listo) que reutiliza `image-source-modal.tsx` para upload.
11. Implementar el consumo del SSE stream `GET /store/marketing/ad-creatives/:id/generate-stream?token=...&request_id=...&correction=...` con un hook `useAiStream` (React Native EventSource polyfill via `react-native-sse` o equivalente) que emite progress/partial_image/completed/post_copy/done/error events.
12. Crear el modal de correction (centered-card custom `md`) con textarea "Que quieres corregir?" + Regenerar (disabled if `!correctionText.trim()`).
13. Implementar la integración `expo-file-system` (download) + `expo-sharing` (share sheet) + `expo-clipboard` (copy image) en `AdCreativeAssetService`.
14. Crear el modal de generation (centered-card custom `lg`) con streaming preview (message reactivo + partial image preview).
15. Crear el step 1 del wizard con result stage (image final) + post card (whitespace-pre-line + copy button) + action dock final (Crear otro / Regenerar con correccion / Ver biblioteca).
16. Wire permisos `useCan('store:marketing_anuncios:read')` etc. en componentes que requieren gating (sidebar visibility, route access) — owners/admins bypass.
17. Manejar el error `MKT_AD_RATE_LIMIT_001` (cuota 3/día/48h) surfacing via `extractApiErrorMessage` toast.
18. Implementar la detección de ecommerce domain (`Abrir tienda` button via `Linking.openURL`).

## Approach Chosen

**Replicar el módulo Promociones como plantilla estructural y visual, extendiendo con SSE streaming + AI generation flow.**

Rationale:
- El módulo `marketing/promotions` mobile ya cubre los patrones comunes: Stack parent, drawer entry gated, FlatList + infinite query, stats cards, search + filter, card list, centered-card upsert modal, ConfirmDialog, RowActionsMenu, StickyHeader, toast wiring, axios service, type constants, labels verbatim. Replicar esto en `anuncios` minimiza código nuevo y maximiza consistencia.
- Para los componentes únicos de Anuncios (SSE streaming, image upload via image-source-modal, generation modal con progress, correction modal), uso el mismo patrón visual (centered-card custom) y los mismos tokens del theme.
- El SSE en React Native requiere un polyfill porque RN no soporta `EventSource` nativamente. Uso `react-native-sse` (paquete mantenido, API compatible con EventSource). Esto se declara como dependencia en `apps/mobile/package.json`.
- Las imágenes se manejan via `expo-file-system` (descarga a cache local), `expo-sharing` (abre share sheet nativo), `expo-clipboard` (copia binario al clipboard). Estos paquetes ya están en `package.json`.
- **NO** se reimplementa lógica backend en mobile (mobile-dev RULE 6). El mobile solo consume el endpoint compartido, incluyendo la quota Redis.

## Alternatives Considered

- **Reimplementar el módulo Anuncios como full-screen pages sin centered-card modals**: rechaza porque rompe la paridad visual con web y con el resto del módulo marketing mobile (Promociones). El usuario fue explícito: "debería verse exatamente igual en la app móvil".
- **Construir desde cero sin tomar Promociones como plantilla**: rechaza porque duplica trabajo (~10 archivos equivalentes ya existen para Promociones) e introduce inconsistencias visuales.
- **Usar polling en lugar de SSE**: rechaza porque SSE es el contrato del backend (`@Sse(':id/generate-stream')`) y el web ya lo consume así. Polling añade latencia y no refleja la API real.
- **Omitir la corrección modal y el gallery picker para reducir scope**: rechaza porque son capacidades P0 del parity audit. El usuario pidió ejecutar al 100%.

## Critical Files

- `apps/mobile/app/(store-admin)/marketing/_layout.tsx` — agregar Stack.Screen name="anuncios" y crear `_layout.tsx` para el sub-segmento
- `apps/mobile/app/(store-admin)/marketing/anuncios/_layout.tsx` — nuevo Stack interno para `anuncios`
- `apps/mobile/app/(store-admin)/marketing/anuncios/index.tsx` — nueva pantalla lista
- `apps/mobile/app/(store-admin)/marketing/anuncios/[id].tsx` — nueva pantalla detalle
- `apps/mobile/app/(store-admin)/marketing/anuncios/create.tsx` — nueva pantalla wizard
- `apps/mobile/src/core/api/endpoints.ts` — agregar `STORE.MARKETING_AD_CREATIVES` constants
- `apps/mobile/src/features/store/services/anuncios.service.ts` — nuevo axios service
- `apps/mobile/src/features/store/services/ad-creative-asset.service.ts` — nuevo service de download/share/copy
- `apps/mobile/src/features/store/services/index.ts` — re-export nuevos services
- `apps/mobile/src/features/store/types/anuncios.types.ts` — tipos TS + DTOs
- `apps/mobile/src/features/store/constants/anuncio-labels.ts` — strings verbatim
- `apps/mobile/src/features/store/components/anuncio-stats-cards.tsx` — 4 stats cards
- `apps/mobile/src/features/store/components/anuncio-card.tsx` — card de la lista
- `apps/mobile/src/features/store/components/anuncio-filters.tsx` — FilterDropdown status
- `apps/mobile/src/features/store/components/anuncio-preview-modal.tsx` — centered-card preview
- `apps/mobile/src/features/store/components/anuncio-generation-modal.tsx` — centered-card generation
- `apps/mobile/src/features/store/components/anuncio-correction-modal.tsx` — centered-card correction
- `apps/mobile/src/features/store/components/anuncio-products-modal.tsx` — picker productos
- `apps/mobile/src/features/store/components/anuncio-gallery-modal.tsx` — picker galería
- `apps/mobile/src/features/store/components/anuncio-wizard-step0.tsx` — form (format + prompt + action dock)
- `apps/mobile/src/features/store/components/anuncio-wizard-step1.tsx` — result stage + post card
- `apps/mobile/src/features/store/components/anuncio-step-ribbon.tsx` — 2-step ribbon
- `apps/mobile/src/features/store/hooks/use-ai-stream.ts` — SSE hook genérico
- `apps/mobile/src/features/store/components/product-upsert-form.tsx` — NO TOCAR (referencia para image-source-modal reuse)
- `apps/mobile/src/shared/layouts/drawer-menu.tsx` — agregar entry "Anuncios" (icon `image`)
- `apps/mobile/package.json` — agregar `react-native-sse` dependency
- `apps/mobile/src/shared/theme/index.ts` — verificar tokens disponibles (NO TOCAR si ya están)

## Reusable Assets

- `apps/mobile/app/(store-admin)/marketing/_layout.tsx` — Stack parent pattern (single-line edit: add Stack.Screen name="anuncios")
- `apps/mobile/app/(store-admin)/marketing/promotions/index.tsx` — list screen pattern (FlatList + infinite + stats + search + filter + empty + ConfirmDialog + Pagination)
- `apps/mobile/app/(store-admin)/marketing/promotions/[id].tsx` — detail screen pattern (StickyHeader + ScrollView + cards + footer actions)
- `apps/mobile/src/features/store/services/promotions.service.ts` — axios service pattern with `data`/`message` envelope
- `apps/mobile/src/features/store/types/promotions.types.ts` — types + DTOs structure
- `apps/mobile/src/features/store/constants/promotion-labels.ts` — Spanish verbatim labels pattern
- `apps/mobile/src/features/store/components/promotion-card.tsx` — card component pattern (avatar, badge, RowActionsMenu)
- `apps/mobile/src/features/store/components/promotion-stats-cards.tsx` — stats grid pattern
- `apps/mobile/src/features/store/components/promotion-upsert-modal.tsx` — centered-card custom modal pattern
- `apps/mobile/src/features/store/components/promotion-filters.tsx` — FilterDropdown pattern
- `apps/mobile/src/shared/components/modal/modal.tsx` — Modal centered-card custom (usado por promotions; NO se reusa directamente porque las capacidades únicas de anuncios requieren su propia implementación)
- `apps/mobile/src/shared/components/confirm-dialog/confirm-dialog.tsx` — ConfirmDialog reusable para delete
- `apps/mobile/src/shared/components/button/button.tsx` — Button (primary/secondary/outline/ghost/destructive)
- `apps/mobile/src/shared/components/input/input.tsx` — Input con label uppercase + required indicator
- `apps/mobile/src/shared/components/textarea/textarea.tsx` — Textarea con label + maxLength
- `apps/mobile/src/shared/components/selector/selector.tsx` — Selector con label + required
- `apps/mobile/src/shared/components/input-buttons/input-buttons.tsx` — InputButtons segmented cards
- `apps/mobile/src/shared/components/search-bar/search-bar.tsx` — SearchBar con debounceMs
- `apps/mobile/src/shared/components/filter-dropdown/filter-dropdown.tsx` — FilterDropdown popover
- `apps/mobile/src/shared/components/stats-card/stats-card.tsx` + `stats-grid.tsx` — StatsCard + StatsGrid
- `apps/mobile/src/shared/components/empty-state/empty-state.tsx` — EmptyState con action button
- `apps/mobile/src/shared/components/spinner/spinner.tsx` — Spinner default + sm
- `apps/mobile/src/shared/components/sticky-header/sticky-header.tsx` — StickyHeader con title/subtitle/back/actions
- `apps/mobile/src/shared/components/badge/badge.tsx` — Badge variants (default/neutral/primary/success/warning/error/info × sizes × solid/outline)
- `apps/mobile/src/shared/components/row-actions-menu/row-actions-menu.tsx` — RowActionsMenu anchored popover
- `apps/mobile/src/shared/components/pagination/pagination.tsx` — Pagination
- `apps/mobile/src/shared/components/icon/icon.tsx` — Icon (lucide-react-native)
- `apps/mobile/src/shared/components/toast/toast.tsx` + `toast.store.ts` — toastSuccess/toastError/toastWarning/toastInfo
- `apps/mobile/src/shared/components/date-picker/date-picker.tsx` — DatePicker native bottom sheet
- `apps/mobile/src/shared/components/image-carousel/image-carousel.tsx` — ImageCarousel
- `apps/mobile/src/shared/utils/currency.ts` — formatCurrency (referencia; NO usado por anuncios pero disponible)
- `apps/mobile/src/features/store/components/image-source-modal.tsx` — ProductImageSourceModal reusable para gallery "Agregar"
- `apps/mobile/src/core/api/pagination.ts` — `getNextPageParam` para useInfiniteQuery
- `apps/mobile/src/core/auth/use-permissions.ts` — permisos `store:marketing_anuncios:*` ya definidos
- `apps/mobile/src/shared/theme/index.ts` — colors / colorScales / spacing / borderRadius / typography tokens
- `apps/mobile/package.json` — ya tiene `expo-file-system`, `expo-sharing`, `expo-clipboard`, `axios`, `@tanstack/react-query` — solo falta agregar `react-native-sse`

## Steps

### Step 1 — Install react-native-sse + register Endpoints + types + labels

**Skills**: `mobile-dev`
**Resources**: `cd apps/mobile && npx expo install react-native-sse` (puede requerir `npx pod-install` en iOS, pero para dev basta con npm install)
**Business decision**: Mobile NO implementa lógica backend de streaming (mobile-dev RULE 6); consume el endpoint SSE compartido `GET /store/marketing/ad-creatives/:id/generate-stream?token=...` y el polyfill `react-native-sse` expone la misma API EventSource que el web consume.
**Why**: Step raíz — todos los demás pasos dependen de que el servicio, los tipos y los labels existan. Va primero porque sin endpoints tipados no se puede construir ningún componente.
**Output**:
- `react-native-sse` agregado a `apps/mobile/package.json` dependencies
- Nuevas constantes en `apps/mobile/src/core/api/endpoints.ts` bajo `Endpoints.STORE.MARKETING_AD_CREATIVES`: `LIST`, `SUMMARY`, `GET_BY_ID`, `ECOMMERCE_DOMAIN`, `IMAGE_PROXY`, `CREATE`, `CREATE_MANUAL`, `SUGGEST_PROMPT`, `UPDATE`, `DELETE`, `STREAM_GENERATE`
- Nuevo archivo `apps/mobile/src/features/store/types/anuncios.types.ts` exportando `AdCreativeStatus`, `AdCreativeFormat`, `MarketingAdCreativeProduct`, `MarketingAdCreativeImage`, `MarketingAdCreative`, `MarketingAdCreativeSummary`, `MarketingAdEcommerceDomain`, `CreateMarketingAdCreativeDto`, `CreateManualMarketingAdCreativeDto`, `UpdateMarketingAdCreativeDetailsDto`, `SuggestMarketingAdPromptDto`, `SuggestedMarketingAdPrompt`, `MarketingAdReferenceImageDto`, `ApiResponse<T>`, `AdCreativeStreamEvent`, `QueryMarketingAdCreativesParams`, `PaginatedResponse<T>`
- Nuevo archivo `apps/mobile/src/features/store/constants/anuncio-labels.ts` exportando `ANUNCIO_LABELS` con todos los strings verbatim del web (status, format, empty states, modal titles, button labels, toast messages, placeholder text, validation messages)
**Verification**: `cd apps/mobile && npx tsc --noEmit` debe pasar sin errores. Importar `Endpoints.STORE.MARKETING_AD_CREATIVES` en un archivo vacío no debe dar error TS.

### Step 2 — Create AnunciosService (axios) + AdCreativeAssetService (RN native sharing/download/copy)

**Skills**: `mobile-dev`, `vendix-frontend` (reference para patrón service)
**Resources**: `none` (no requiere comandos externos; solo typecheck)
**Business decision**: AnunciosService envuelve axios con el envelope `{data, message, meta}` del backend (mismo patrón que `promotions.service.ts`). AdCreativeAssetService usa APIs nativas de Expo (`expo-file-system` download + `expo-sharing` share + `expo-clipboard` write) para reflejar el web's `navigator.share` + `navigator.clipboard.write` + `<a download>`.
**Why**: Sin el service, no hay forma de invocar los endpoints. Va inmediatamente después de los types para que el resto de componentes tenga un cliente HTTP listo.
**Output**:
- `apps/mobile/src/features/store/services/anuncios.service.ts` con métodos `list(params)`, `getById(id)`, `getSummary()`, `getEcommerceDomain()`, `create(dto)`, `suggestPrompt(dto)`, `updateDetails(id, dto)`, `deleteAnuncio(id)`, `getImageBlob(id, variant)`, `productImageProxyUrl(imageId)` (devuelve URL con token), `streamGenerate(id, correction?, requestId?)` que retorna un `EventSource`-like via `react-native-sse`
- `apps/mobile/src/features/store/services/ad-creative-asset.service.ts` con `download(creative)`, `share(creative)`, `copy(creative)` que descargan blob desde `getImageBlob`, lo guardan en `expo-file-system` cache dir, y abren share sheet / clipboard
- Re-export en `apps/mobile/src/features/store/services/index.ts`
**Verification**: `npx tsc --noEmit` debe pasar. Un test unitario simple (no obligatorio en plan; el verification E2E valida integración) puede importar el service y verificar tipos.

### Step 3 — Drawer entry + Stack.Screen route registration

**Skills**: `mobile-dev`, `vendix-panel-ui`
**Resources**: `none`
**Business decision**: El drawer entry "Anuncios" se gated por `panelUiConfig[STORE_ADMIN].marketing_anuncios === true` (mismo mecanismo que `Marketing → 'marketing'` ya registrado para promotions). Esto replica el `MenuFilterService` del web. El icono es `image` (lucide).
**Why**: Sin la entrada en el drawer, el módulo es inaccesible desde la UI principal. Va antes de las pantallas para que las rutas estén registradas cuando se monten.
**Output**:
- Edit en `apps/mobile/src/shared/layouts/drawer-menu.tsx`: agregar entry `Anuncios: 'marketing_anuncios'` en el `moduleKeyMap` (mismo nivel que `Marketing: 'marketing'`), ruta `/(store-admin)/marketing/anuncios`, icon `image`
- Edit en `apps/mobile/app/(store-admin)/marketing/_layout.tsx`: agregar `<Stack.Screen name="anuncios" />` antes del `promotions`
- Nuevo `apps/mobile/app/(store-admin)/marketing/anuncios/_layout.tsx` con `Stack screenOptions={{ headerShown: false }}` + `<Stack.Screen name="index" />` + `<Stack.Screen name="[id]" />` + `<Stack.Screen name="create" />`
**Verification**: `npx tsc --noEmit` debe pasar. Reiniciar Expo client y navegar al drawer debe mostrar "Anuncios" bajo Marketing cuando `panelUi.marketing_anuncios === true`.

### Step 4 — useAiStream hook (SSE consumer) for React Native

**Skills**: `mobile-dev`
**Resources**: `none` (sin comandos externos; el paquete `react-native-sse` se instaló en Step 1)
**Business decision**: SSE streaming no es nativo en React Native. `react-native-sse` provee una API EventSource-compatible. El hook `useAiStream` envuelve el ciclo de vida: open/close, parse `ai-chunk` MessageEvents, mapear error_code a mensajes via `ERROR_MESSAGES` (mismo patrón que web).
**Why**: El hook es reusable para cualquier SSE en mobile, no solo anuncios. Va temprano porque los modales de generation/correction lo requieren.
**Output**:
- Nuevo archivo `apps/mobile/src/features/store/hooks/use-ai-stream.ts` exportando `useAiStream({ url, token, onEvent, enabled })` que retorna `{ start, stop, status }` (status: `idle | connecting | streaming | done | error`)
- El hook usa `EventSource(url)` de `react-native-sse`, escucha `ai-chunk` events, parsea JSON, llama `onEvent(parsed)` con tipo union `AdCreativeStreamEvent`
- Cleanup en `useEffect` unmount
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test manual: invocar `useAiStream` con un endpoint mock en una pantalla debug — debe recibir al menos 1 `ai-chunk` event.

### Step 5 — List screen + stats cards + card component + filters

**Skills**: `mobile-dev`
**Resources**: `none`
**Business decision**: La lista mobile replica el patrón de `promotions/index.tsx` (FlatList + infinite query + stats + search + filter + empty + ConfirmDialog + PullToRefresh). Las 4 stats cards (total/completados/procesando/fallidos) usan el colorMap del web (`#6b7280`/`#f59e0b`/`#22c55e`/`#ef4444`). El status badge dentro de la card usa el `Badge` component shared.
**Why**: Pantalla raíz del módulo. Sin ella no hay forma de acceder a los anuncios.
**Output**:
- `apps/mobile/src/features/store/components/anuncio-stats-cards.tsx` — 4 cards con iconos `image` / `check-circle` / `loader-2` / `triangle-alert` y labels verbatim
- `apps/mobile/src/features/store/components/anuncio-card.tsx` — card con avatar preview_url, badge status, products detail (`package` icon), format detail (`image` icon), footer created_at formateado con `Intl.DateTimeFormat('es-CO', {dateStyle:'medium', timeStyle:'short'})`, RowActionsMenu (Ver/Copiar/Descargar/Compartir/Eliminar con visibility por `image_url` y por estado)
- `apps/mobile/src/features/store/components/anuncio-filters.tsx` — FilterDropdown con secciones state y format
- `apps/mobile/app/(store-admin)/marketing/anuncios/index.tsx` — list screen con FlatList, useInfiniteQuery, SearchBar (debounceMs 700), 4 stats cards, AnuncioCard render, EmptyState verbatim ("Aun no tienes anuncios" / "Sin anuncios para estos filtros" / "No se pudieron cargar los anuncios"), ConfirmDialog para delete (verbatim "Eliminar anuncio" / `Se eliminara "{title}".`), toast verbatim ("Anuncio eliminado." / "Error al eliminar")
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test con Expo client: pantalla lista carga, stats cards muestran ceros cuando no hay datos, search funciona con debounce, status filter cambia la query, tap en card navega al detalle.

### Step 6 — Detail screen + preview modal

**Skills**: `mobile-dev`
**Resources**: `none`
**Business decision**: La ruta `/(store-admin)/marketing/anuncios/[id]` muestra el detalle con StickyHeader (title + subtitle status label + back + action Edit). El preview modal (centered-card custom ≤1024px xl) muestra image + título + descripción + productos + post sugerido con botón "Copiar" y footer con outline Copiar/Descargar/Compartir + primary "Abrir tienda" (visible si ecommerceUrl). El modal es custom (NO shared full-screen Modal) para paridad con web.
**Why**: Sin el detalle, el usuario no puede ver un anuncio específico ni compartir/descargar la imagen generada.
**Output**:
- `apps/mobile/app/(store-admin)/marketing/anuncios/[id].tsx` — pantalla detalle con StickyHeader (title=name, subtitle=statusLabel, action Edit), ScrollView con cards: Identidad (title + code), Estado + Formato, Vigencia, Productos, Post sugerido, footer stacked actions
- `apps/mobile/src/features/store/components/anuncio-preview-modal.tsx` — RNModal transparent wrapper con centered-card `xl` (maxWidth 1024), header title + subtitle status, body grid (image left + sidebar right en md+), footer outline+primary buttons, backdrop Pressable dismiss, KeyboardAvoidingView no necesario (no inputs)
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test con Expo client: tap en card de lista navega al detalle; tap en row action "Ver" abre preview modal; "Copiar" copia el post_copy al clipboard con toast "Post copiado.".

### Step 7 — Create wizard — Step 0 (form + action dock) + Step 1 (result stage + post card) + step ribbon

**Skills**: `mobile-dev`
**Resources**: `none`
**Business decision**: El wizard usa una **ruta dedicada** `/(store-admin)/marketing/anuncios/create` (NO modal) porque el flow necesita full vertical space y dos pasos separados. Step 0 contiene Format `InputButtons` (3 options square/story/landscape con iconos `layout-grid`/`smartphone`/`monitor`) + Prompt `Textarea` (maxLength 2000, label "Idea o instrucciones", placeholder verbatim) + action dock con botones Cancelar/Galeria/Productos/Sugerir/Generar anuncio (estos 2 últimos con badge counter opcional). Step 1 muestra result stage con image + animation skeleton + post card con copy button.
**Why**: Wizard es el corazón del feature. Sin él, no se pueden generar anuncios desde mobile.
**Output**:
- `apps/mobile/app/(store-admin)/marketing/anuncios/create.tsx` — pantalla full-screen con StickyHeader (title "Crear anuncio", subtitle verbatim, badge "1/2" o "2/2", back), step ribbon switchable, renders Step 0 o Step 1 según state
- `apps/mobile/src/features/store/components/anuncio-step-ribbon.tsx` — 2-pill ribbon con labels "Crear" / "Resultado" (clickable)
- `apps/mobile/src/features/store/components/anuncio-wizard-step0.tsx` — Format InputButtons + Prompt Textarea + action dock; valida `prompt` (maxLength 2000) y muestra submitDisabled si prompt vacío
- `apps/mobile/src/features/store/components/anuncio-wizard-step1.tsx` — result grid (image stage + post card) + action dock final (Crear otro / Regenerar con correccion / Ver biblioteca)
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test con Expo client: navegar a `/anuncios/create`, step ribbon visible, format select funciona, prompt text se persiste, "Generar anuncio" dispara `createAiAnuncio()` que llama `POST /` y luego `useAiStream`.

### Step 8 — Products picker modal + Gallery picker modal + correction modal

**Skills**: `mobile-dev`
**Resources**: `none`
**Business decision**: Los 3 submodales del wizard usan centered-card custom: Products picker (size `lg`, search + lista scroll 360px), Gallery picker (size `lg`, grid 2/3/4 cols con resources), Correction modal (size `md`, textarea + Regenerar). Reutiliza `image-source-modal.tsx` para el botón "Agregar" del gallery (ya existe en `apps/mobile/src/features/store/components/image-source-modal.tsx`).
**Why**: Sin los pickers, el usuario no puede seleccionar productos ni recursos para la generación. El correction modal permite iterar sobre generaciones.
**Output**:
- `apps/mobile/src/features/store/components/anuncio-products-modal.tsx` — RNModal centered-card `lg` con SearchBar (debounceMs 300, placeholder "Buscar productos o servicios...") + FlatList de productos (max-h 360px, scroll), tap toggle selección con check verde primary, footer "Listo" primary right-aligned
- `apps/mobile/src/features/store/components/anuncio-gallery-modal.tsx` — RNModal centered-card `lg` con grid 2/3/4 cols, cada resource card muestra preview_url + label + source_type ("QR exacto" / "Referencia visual" / "Foto de producto"), tap toggle con check verde, footer "Agregar" (abre `image-source-modal`) + "Listo" primary
- `apps/mobile/src/features/store/components/anuncio-correction-modal.tsx` — RNModal centered-card `md` con Textarea (label "Que quieres corregir?", placeholder "Ej: el logo salio cortado, el texto no se lee...", maxLength 1000) + footer Cancelar outline + Regenerar primary (disabled si text vacío, loading mientras regenera, `refresh-cw` icon)
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test con Expo client: en step 0, tap "Productos" abre modal; search filtra; tap selecciona; "Listo" cierra. Mismo flujo para Gallery. En step 1, "Regenerar con correccion" abre correction modal; submit dispara nuevo SSE stream.

### Step 9 — Generation modal (SSE streaming) + AbortController + cancellation

**Skills**: `mobile-dev`, `vendix-ai-streaming`
**Resources**: `none`
**Business decision**: El generation modal usa centered-card custom `lg` con backdrop Pressable dismiss (deshabilitado durante streaming). El SSE consumer (vía `useAiStream`) traduce eventos a UI: `progress` → update `generationMessage`; `partial_image` → preview base64 image; `completed` → save `generationResult` + update preview; `post_copy` → update result.post_copy; `done` → close modal + invalidate queries; `error` → toast error + cerrar. Errores del stream con `error_code` mapean via `ERROR_MESSAGES` (mismo patrón que web).
**Why**: El modal de generation es donde el AI hace su trabajo. Es la pieza más compleja del módulo.
**Output**:
- `apps/mobile/src/features/store/components/anuncio-generation-modal.tsx` — RNModal centered-card `lg`, header "Generando anuncio" + subtitle reactivo, body con image stage (loader-2 spin mientras connecting/streaming, base64 image cuando partial_image o completed), footer outline Copiar/Descargar/Compartir (solo si image_url presente) + primary "Cerrar" (disabled durante streaming)
- `apps/mobile/src/features/store/hooks/use-ai-stream.ts` (extensión de Step 4) — agregar retry logic con `request_id` deduplication y abort support
- Wiring en `create.tsx`: cuando user tap "Generar anuncio", llamar `AnunciosService.create(dto)` → set `generationResult` → invocar `useAiStream({...})` → renderizar modal
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test con Expo client: tap "Generar anuncio" abre modal; backend genera imagen (esperar 5-30s); modal muestra preview; al completarse, modal muestra image final + footer habilitado; "Cerrar" cierra y refresca lista.

### Step 10 — AdCreativeAssetService integration (download/share/copy)

**Skills**: `mobile-dev`, `vendix-s3-storage` (referencia para image handling)
**Resources**: `none`
**Business decision**: El asset service replica el web's `ad-creative-asset.service.ts` pero usa APIs nativas Expo en vez de `navigator.share`/`navigator.clipboard`/`<a download>`. Download usa `File.downloadFileAsync()` (expo-file-system) para guardar en cache dir, luego retorna URI local. Share usa `Sharing.shareAsync(uri)` que abre share sheet nativo. Copy usa `Clipboard.setImageAsync(...)` (expo-clipboard) con fallback a `Clipboard.setStringAsync(url)`.
**Why**: Sin esto, el usuario no puede descargar/compartir las imágenes generadas. Es P0 del parity audit.
**Output**:
- Extensión de `apps/mobile/src/features/store/services/ad-creative-asset.service.ts` con implementación real usando expo-file-system + expo-sharing + expo-clipboard (Step 2 dejó la firma pero no la implementación)
- Helper `buildFileName(creative, mime)` que slugifica title (NFD + lowercase + replace non-alphanumeric + slice(0,48)) + extension from MIME
- Integration en `anuncio-card.tsx` (RowActionsMenu items Copiar/Descargar/Compartir con visibility por `image_url`) y en `anuncio-preview-modal.tsx` (footer buttons)
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test con Expo client: tap "Descargar" en preview modal guarda archivo local + toast "Imagen descargada."; tap "Compartir" abre share sheet nativo iOS/Android; tap "Copiar" copia al clipboard + toast "Imagen copiada." o "Enlace copiado." (fallback).

### Step 11 — Permissions gating (sidebar + per-action) via useCan

**Skills**: `mobile-dev`, `vendix-permissions`
**Resources**: `none`
**Business decision**: Replicar el patrón de mobile Promociones (que también tiene este gap documentado pero NO resuelto). Agregar `useCan('store:marketing_anuncios:read')` en `anuncios/index.tsx` para redirigir a dashboard si el usuario no tiene permiso. Owners/admins tienen bypass automático. Los permisos `store:marketing_anuncios:read|create|generate|update|delete` ya están declarados en `apps/mobile/src/core/auth/use-permissions.ts`.
**Why**: Sin gating, todos los roles ven la UI completa (gap de seguridad replicado del módulo Promociones). Es P1 del audit pero se aborda ahora porque el módulo se construye desde cero.
**Output**:
- Hook `use-can-permissions.ts` o integración directa con `usePermissions()` en las pantallas lista/detalle/wizard
- Si `!can('store:marketing_anuncios:read')` en list → redirect a `dashboard`
- Si `!can('store:marketing_anuncios:delete')` → RowActionsMenu "Eliminar" oculto
- Si `!can('store:marketing_anuncios:create')` → "Nueva anuncio" button oculto
**Verification**: `npx tsc --noEmit` debe pasar. Manual: login con usuario no-admin (no owner) → list muestra mensaje "Sin permisos" o redirect; actions críticas ocultas.

### Step 12 — Ecommerce domain detection + "Abrir tienda" button via Linking.openURL

**Skills**: `mobile-dev`
**Resources**: `none`
**Business decision**: Cuando el usuario abre el preview modal, se llama `AnunciosService.getEcommerceDomain()` (GET `/ecommerce-domain`). Si retorna un dominio válido, se construye URL `https://${hostname}` y se habilita el botón "Abrir tienda" en el footer del modal. Click → `Linking.openURL(url)`.
**Why**: Botón P1 del audit. Sin ecommerce URL, el preview pierde valor porque el post_copy siempre menciona el hostname.
**Output**:
- En `anuncio-preview-modal.tsx`: agregar effect que carga `getEcommerceDomain()` on mount; muestra "Abrir tienda" primary button si URL disponible; onPress usa `Linking.openURL`
- Helper `extractHostName(url)` que limpia `https?://` y trailing `/`
- Manejo de error: si `getEcommerceDomain()` retorna null o falla, botón oculto silenciosamente
**Verification**: `npx tsc --noEmit` debe pasar. Smoke test con Expo client: si tienda tiene dominio ecommerce activo, "Abrir tienda" abre Safari/Chrome externo; si no, botón no se muestra.

### Step 13 — E2E verification + visual parity check vs web

**Skills**: `mobile-dev`, `how-to-test`
**Resources**: 
- `cd apps/mobile && npx tsc --noEmit` (typecheck)
- `cd apps/mobile && npx expo start` (Expo dev server para agent-browser)
- `agent-browser --headed --ignore-https-errors open https://vendix.com` (web reference para comparar)
- curl con token de seed owner (`owner@techsolutions.co` / `1125634q`) para validar endpoints backend compartidos

**Business decision**: Verificar paridad funcional y visual comparando contra el web reference. Agent-browser drives la vhost (`https://vendix.com` subdominio) para ver el web; Expo client corre la mobile app. Diff de screenshots y verificación de strings verbatim (toast, empty states, labels).
**Why**: Cierre del plan — verifica que el módulo mobile replica el web end-to-end antes de declarar done.
**Output**:
- All 12 backend endpoints validados con curl (happy + sad path)
- Smoke tests E2E en Expo client:
  1. Navegar a `/(store-admin)/marketing/anuncios` → ver stats cards en 0
  2. Tap "Nueva anuncio" → wizard abre con format = story, prompt vacío
  3. Llenar prompt → tap "Generar anuncio" → generation modal abre
  4. Esperar 5-30s → modal muestra image final + post_copy
  5. "Cerrar" → vuelve a lista con el nuevo anuncio
  6. Tap card → detalle abre
  7. "Compartir" → share sheet nativo abre
  8. "Eliminar" → confirm dialog → "Anuncio eliminado." toast
- Comparación visual: centered-card modals en ambos, labels uppercase + asterisk en inputs, footer outline+primary right-aligned
**Verification**: 
- `curl -H "Authorization: Bearer $TOKEN" https://api.vendix.com/store/marketing/ad-creatives` → 200 con `data[]`
- `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{...}' https://api.vendix.com/store/marketing/ad-creatives` → 201
- `curl -X GET -H "Authorization: Bearer $TOKEN" https://api.vendix.com/store/marketing/ad-creatives/1` → 200
- Smoke E2E con Expo client + agent-browser en paralelo contra el web

## End-to-End Verification

1. **Backend contract (curl)**: validar que los 12 endpoints del módulo Anuncios responden correctamente. Cada uno requiere un token de un seed owner (`owner@techsolutions.co` / `1125634q`):
   - `curl -sS -H "Authorization: Bearer $TOKEN" "$API/store/marketing/ad-creatives/summary"` → 200 con `{total, completed, processing, failed}`
   - `curl -sS -H "Authorization: Bearer $TOKEN" "$API/store/marketing/ad-creatives?status=completed&limit=5"` → 200 con `data[]`
   - `curl -sS -H "Authorization: Bearer $TOKEN" "$API/store/marketing/ad-creatives/ecommerce-domain"` → 200 con `{hostname, url}`
   - `curl -sS -H "Authorization: Bearer $TOKEN" "$API/store/marketing/ad-creatives/1"` → 200 con detalle
   - `curl -sS -H "Authorization: Bearer $TOKEN" "$API/store/marketing/ad-creatives/1/image?variant=thumb"` → binary image/png
   - `curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Test","format":"square","prompt":"test"}' "$API/store/marketing/ad-creatives"` → 201
   - `curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"intent":"highlight_store","format":"story"}' "$API/store/marketing/ad-creatives/suggest-prompt"` → 200 con `{suggested_prompt}`
   - `curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" "$API/store/marketing/ad-creatives/$ID"` → 204
   - Verificar `MKT_AD_RATE_LIMIT_001` cuando se excede cuota (4ta llamada en <48h)
   - Verificar `SYS_FORBIDDEN_001` cuando se llama sin token

2. **Mobile typecheck**: `cd apps/mobile && npx tsc --noEmit` debe pasar sin errores (cubre imports, tipos, signatures).

3. **Mobile build**: `cd apps/mobile && npx expo export` debe producir bundle sin errores.

4. **Visual E2E (agent-browser)**: navegar al web `https://vendix.com/<store-subdomain>/admin/marketing/anuncios` y comparar visualmente con Expo client. Verificar:
   - Modal centered-card anatomy (maxWidth 480/640/1024 según size)
   - Labels uppercase bold con `*` rojo para required (ninguno required en este módulo, todos opcionales)
   - Footer outline + primary pair right-aligned con `border-top` separator
   - Toast strings verbatim ("Anuncio eliminado.", "Imagen descargada.", etc.)
   - Empty state copy verbatim ("Aun no tienes anuncios" + "Crear anuncio" CTA)
   - Stats cards colorMap: `bg-sky-100/text-sky-600`, `bg-emerald-100/text-emerald-600`, `bg-amber-100/text-amber-600`, `bg-red-100/text-red-600`

5. **Mobile flow E2E (Expo client)**:
   - Drawer muestra "Anuncios" → tap navega a `/(store-admin)/marketing/anuncios`
   - Pantalla lista carga con 4 stats cards (probablemente en cero en seed fresh)
   - Tap "+ Nueva anuncio" en StickyHeader → navega a `create`
   - Wizard step 0: format select (square/story/landscape), prompt textarea, action dock
   - Tap "Sugerir" → llama suggest-prompt → prompt se llena
   - Tap "Generar anuncio" → POST crea registro → SSE abre → generation modal muestra progress
   - Wait para completion → modal muestra image final + post_copy
   - "Cerrar" → vuelve a lista → nuevo anuncio aparece en top
   - Tap card → detalle abre con cards secciones
   - Tap "Compartir" en preview modal → share sheet nativo abre (iOS o Android)
   - Tap "Eliminar" en card row actions → ConfirmDialog → "Eliminar" → "Anuncio eliminado." toast + invalida queries

6. **Permisos**: login con usuario seed viewer (no owner) → drawer "Anuncios" oculto si `panel_ui.marketing_anuncios === false`; visible pero UI gated si `true`.

7. **Cuota**: ejecutar 4 generaciones en <48h → la 4ta debe fallar con toast "Alcanzaste el limite diario de 3 anuncios generados..."

## Knowledge Gaps

- **`react-native-sse` en este monorepo**: no existe precedente de SSE en mobile. El paquete `react-native-sse` es el más maduro (API EventSource-compatible, mantenimiento activo). Si en iOS/Android aparecen issues de buffering o reconnection, considerar alternativas como `expo-server-sent-events` o implementar un polling fallback que respete el contrato `ai-chunk` events.
- **AI animations en React Native**: el web usa CSS animations complejas (`ai-orbit`, `ai-holo-grid`, `ai-sparkle`). RN no soporta CSS keyframes directamente. Para el MVP se usan `Animated.Value` con loops simples o `react-native-reanimated` (ya en `package.json`). Si se requiere pixel-perfect visual parity, se puede usar `lottie-react-native` con archivos `.lottie` exportados desde After Effects, pero esto excede el scope de paridad funcional.
- **`expo-file-system` API stability**: `File.downloadFileAsync` puede haber cambiado de signature entre versiones. Verificar contra la versión actual (`~19.0.23`) antes de implementar.
- **Cross-feature `image-source-modal` reuse**: el módulo `product-upsert-form.tsx` mobile ya usa este modal. Confirmar que el componente `apps/mobile/src/features/store/components/image-source-modal.tsx` emite `imagesAdded: string[]` (data URLs) compatible con la API del gallery picker.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.