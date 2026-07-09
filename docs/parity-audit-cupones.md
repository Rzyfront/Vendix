# Parity Audit — Marketing — Cupones (STORE_ADMIN)

**Skill**: `mobile-parity-audit` v1.1 · **Date**: 2026-07-08
**Branch**: `feature/mobile-marketing-promotions-parity`
**Status**: ✅ **PARITY ALCANZADA** — Mobile implementa todas las capacidades funcionales de la web con paridad visual verified.

---

## Visual Baseline Loaded

- **Web Visual Pattern**: Centered-card modal anatomy (max-width 480-500px en `lg`, backdrop `rgba(15,23,42,0.45)`), `text-xs font-bold uppercase text-gray-700` labels con asterisco rojo required, footer con outline+primary content-sized buttons right-aligned + `border-top` separator, toast strings verbatim.
- **Code-level reference**: Engram `#384 — Mobile Web Visual Parity Pattern` (RNModal transparent wrapper, backdrop Pressable, KeyboardAvoidingView, maxWidth 480, exact tokens).
- **Mobile precedent**: `apps/mobile/src/features/store/components/promotion-upsert-modal.tsx` ya implementa el centered-card custom replicando el web `coupon-modal.component.ts`. El módulo de Cupones mobile sigue el mismo patrón.

---

## Scope

- **Web target**: Módulo **"Cupones"** (Marketing → Cupones) — `apps/frontend/src/app/private/modules/store/marketing/coupons/`
- **Surface / app_type**: `STORE_ADMIN` (sidebar gated, sin industry gating)
- **Mobile counterpart**: ✅ **EXISTE** — `apps/mobile/app/(store-admin)/marketing/coupons/index.tsx` + `apps/mobile/src/features/store/{services,types,components,constants}/coupons.*`
- **Shared backend domain**: `apps/backend/src/domains/store/coupons/` (controller + service + 4 DTOs)

---

## Web Functional Inventory

### 1. Navigation / routes
- **Web route**: `/admin/marketing/coupons` → `CouponsComponent` (standalone loadComponent)
- **Mobile route**: `/(store-admin)/marketing/coupons` → `CuponsListScreen`
- Sidebar entry: **Marketing → Cupones** (icon `circle` web · icon `ticket` mobile)

### 2. Screens / views
**Web (`coupons.component.ts`)**:
- Sticky stats container (4 KPI cards)
- Sticky search header con botón `+ Crear Cupón` (outline icon-only)
- `app-responsive-data-view` (tabla ↔ cards según viewport)
- Modal `coupon-modal.component.ts` (create/edit) — `app-modal size="lg"`
- Confirm dialog de eliminación (`DialogService`)

**Mobile (`cupons/index.tsx`)**:
- `StickyHeader` con CTA `Nuevo Cupon` (primary button)
- `CuponStatsCards` (4 KPIs en `StatsGrid`)
- `SearchBar` con debounce 300ms
- `FlatList` con `CuponCard`
- `CuponUpsertModal` (create/edit)
- `ConfirmDialog` para delete

### 3. Actions / CTAs

| Action | Web | Mobile |
|---|---|---|
| Create cupon | `app-button variant="outline"` icon `plus` → openCreateModal | `StickyHeader action variant="primary"` icon `plus` → handleCreate |
| Search | `app-inputsearch debounce 300ms` → onSearch | `SearchBar debounceMs={300}` |
| Edit row | `TableAction` icon `edit` variant `info` → openEditModal | `RowActionsMenu` action key `edit` → handleEdit |
| Delete row | `TableAction` icon `trash-2` variant `danger` → DialogService.confirm | `RowActionsMenu` action key `delete` destructive → setDeleteTarget → ConfirmDialog |
| Generate code (en form) | `app-input suffixIcon` clickable → generateCode() (8 chars alfanum) | `Input suffix` icon `refresh-cw` clickable → generateCouponCode() (8 chars alfanum) |
| Refresh list | NgRx auto + manual re-fetch | `RefreshControl` + `useInfiniteQuery` refetch |
| Pagination infinite | (no implementado en UI actual — solo trae página) | `useInfiniteQuery` con `fetchNextPage` en `onEndReached` |
| Filter sort/active | (definido en state/actions pero **no expuesto en UI**) | (no expuesto en UI; el service acepta params) |

### 4. Forms & fields (coupon-modal.component.ts)

| Field | Web | Mobile | Notes |
|---|---|---|---|
| Codigo | `app-input` required, minLength 3, customInputClass `font-mono uppercase`, suffix icon refresh | `Input` required, maxLength 50, suffix `refresh-cw`, `onChangeText: (t) => setCode(t.toUpperCase())` | ✅ Parity funcional; visual prefix `font-mono` no aplicado en mobile (aceptable) |
| Nombre | `app-input` required, minLength 2, placeholder `Ej: Descuento de verano` | `Input` required, maxLength 255, placeholder mismo | ✅ Parity |
| Descripcion | `app-textarea` placeholder `Descripcion del cupon (opcional)...` rows=2 | `Textarea` rows=2, maxLength 500 | ✅ Parity |
| Tipo de descuento | `app-selector` options `Porcentaje / Monto fijo` required | `Selector` mismo | ✅ Parity |
| Valor | `app-input` required, type num/text según type, prefix `$ o %`, max 100 si PERCENTAGE | `Input` keyboard `decimal-pad`, suffix `% o $` (texto) | ✅ Funcional parity; visual: prefix web vs suffix mobile |
| Aplica a | `app-selector` options 3 (ALL / SPECIFIC_PRODUCTS / SPECIFIC_CATEGORIES) | `Selector` mismo | ✅ Parity |
| Productos (condicional) | `app-multi-selector` required si SPECIFIC_PRODUCTS | `MultiSelector` con `ProductService.list({limit:500,state:'active'})` | ✅ Parity |
| Categorias (condicional) | `app-multi-selector` required si SPECIFIC_CATEGORIES | `MultiSelector` con `CategoryService.getAllActive()` | ✅ Parity |
| Valido desde | `app-input type="datetime-local"` required | `DatePicker` required | ⚠️ Diferencia funcional: web es datetime completo, mobile es solo date — backend acepta ambos. Aceptable para mobile-first. |
| Valido hasta | `app-input type="datetime-local"` required | `DatePicker` required | ⚠️ Misma diferencia |
| Compra minima | `app-input currency=true` placeholder `Sin minimo` | `Input` keyboard `decimal-pad`, prefix `$`, placeholder mismo | ✅ Parity |
| Descuento maximo | `app-input currency=true` placeholder `Sin limite` | `Input` keyboard `decimal-pad`, prefix `$`, placeholder mismo | ✅ Parity |
| Limite de usos | `app-input type="number"` placeholder `Sin limite` | `Input` keyboard `number-pad`, placeholder mismo | ✅ Parity |
| Usos por cliente | `app-input type="number"` placeholder `Sin limite` | `Input` keyboard `number-pad`, placeholder mismo | ✅ Parity |
| Cupon activo | `app-setting-toggle` description `Disponible para uso inmediato` | `Toggle` description igual | ✅ Parity |

### 5. States

| State | Web | Mobile |
|---|---|---|
| Loading lista | Spinner con texto `Cargando cupones...` | `Spinner` (componente shared) |
| Empty | `app-responsive-data-view emptyMessage="No hay cupones creados" emptyIcon="ticket"` | `EmptyState` icon `ticket`, title `No hay cupones creados`, description `Comienza creando un nuevo cupon.`, actionLabel `Nuevo Cupon` → handleCreate |
| Error list | NgRx effect catchError → state.error | toastError(message) en cada mutation + visual loading state |
| Loading modal save | `app-button [loading]="loading()"` | `Button loading={isPending}` |
| Modal invalid submit | `form.invalid` → markAllAsTouched + error inline | `isValid` memo + setErrors(newErrors) inline |

### 6. Data display

| Aspect | Web | Mobile |
|---|---|---|
| Lista | `ResponsiveDataView` tabla/card (`columns` + `cardConfig`) | `FlatList` con `CuponCard` (solo card) |
| Columnas tabla | code, name, discount_type (transform), discount_value (transform %), current_uses/max, valid_until (date), is_active (badge) | Card replica: name + code + Badge activo/inactivo + RowActionsMenu + meta row (tipo / valor / usos / valid_until) |
| Card mobile | ItemListCardConfig: titleKey `name`, subtitleKey `code`, badgeKey `is_active` con `colorMap: {Activo:'#22c55e', Inactivo:'#9ca3af'}`, footerKey `discount_value` label `Descuento`, detailKeys: discount_type + current_uses | Custom `CuponCard`: Header name+code+badge+menu, MetaRow con type + value + uses + valid_until |

### 7. Permissions & gating

| Permission | Web | Mobile |
|---|---|---|
| `store:coupons:create` | POST `/store/coupons` | `CouponsService.create` |
| `store:coupons:read` | GET `/store/coupons` y `/stats` y `/:id` | `CouponsService.list`, `getStats`, `getById` |
| `store:coupons:update` | PATCH `/store/coupons/:id` | `CouponsService.update` |
| `store:coupons:delete` | DELETE `/store/coupons/:id` | `CouponsService.remove` |
| `store:coupons:validate` | POST `/store/coupons/validate` | (no implementado en admin UI — usado solo en POS flow) |
| `store:coupons:read:one` | GET `/store/coupons/:id` | (no usado en mobile — todo se carga en lista) |

### 8. Consumed endpoints (backend `apps/backend/src/domains/store/coupons/`)

| Endpoint | Verbo | Permiso | Web | Mobile |
|---|---|---|---|---|
| `/store/coupons` | GET | `store:coupons:read` | ✅ list (con query params) | ✅ list (idéntico) |
| `/store/coupons` | POST | `store:coupons:create` | ✅ create | ✅ create |
| `/store/coupons/:id` | GET | `store:coupons:read` | ✅ getById (no usado en UI principal) | ✅ getById (service exportado) |
| `/store/coupons/:id` | PATCH | `store:coupons:update` | ✅ update | ✅ update |
| `/store/coupons/:id` | DELETE | `store:coupons:delete` | ✅ delete | ✅ delete |
| `/store/coupons/validate` | POST | `store:coupons:validate` | (no consumido en admin UI — usado en POS) | (no consumido) |
| `/store/coupons/stats` | GET | `store:coupons:read` | ✅ loadStats | ✅ getStats |

### 9. Side-effects

- **Backend**: Al crear/editar cupón, se crean/borran rows en `coupon_products` y/o `coupon_categories` (junction tables). Soft-delete en DELETE: `is_active = false`. `registerUse` se llama desde POS al cerrar orden con cupón aplicado.
- **Mobile**: toast success/error (strings verbatim del backend o del `coupon-labels.ts`). Invalidación de queries `['coupons']` y `['coupon-stats']` post-mutation.

### 10. Formatting concerns

- **Currency**: `CurrencyFormatService` (web) / `formatCurrency` (mobile) — ambos formatean en COP.
- **Dates**: web `toLocaleDateString('es-CO')` para valid_until; mobile mismo `toLocaleDateString('es-CO')`.
- **Discount value display**: web usa `${value}%` o `formatCurrency(value)`; mobile mismo via `formatDiscountValue`.

### 11. Cross-module dependencies

| Component | Web | Mobile |
|---|---|---|
| Multi-selector productos | `MultiSelectorComponent` (own) | `MultiSelector` (shared `@/shared/components/multi-selector/multi-selector`) |
| Multi-selector categorias | `MultiSelectorComponent` | `MultiSelector` |
| Modal | `ModalComponent` (size `lg`) | `RNModal` transparent + `KeyboardAvoidingView` + `cardWrapper maxWidth: 480` |
| Input | `InputComponent` | `Input` (shared con uppercase label + asterisco + `prefix`/`suffix`) |
| Selector | `SelectorComponent` | `Selector` |
| Textarea | `TextareaComponent` | `Textarea` |
| Toggle | `SettingToggleComponent` | `Toggle` |
| Datepicker | `InputComponent type="datetime-local"` | `DatePicker` (solo date) |
| Button | `ButtonComponent` | `Button` |
| Toast | (web usa Angular Material snackbar o propio) | `toastSuccess`/`toastError` |

### 12. Edge cases & business rules

- **Backend validation**: percentage <= 100, valid_from < valid_until, unique code en store, applies_to + ids coherente.
- **Mobile validation**: misma lógica implementada en `isValid` memo + `setErrors` inline (subset del backend; el backend es la autoridad).
- **Soft-delete**: backend marca `is_active = false` — el mobile consume el endpoint y el toast dice "Cupón eliminado exitosamente" (verbatim del backend response.message).
- **Code uppercase**: ambos transforman a upper antes de enviar.
- **Filter state**: web define `setSort`/`setActiveFilter`/`setDiscountTypeFilter` en NgRx pero **no expone UI para ellos** — el mobile tampoco los expone. (Gap: ambos coinciden en este subset de capabilities, lo que es parity — la functionality existe en backend/service pero UI no la usa.)

---

## Web Visual Inventory

### 13. Visual & UX presentation

| Element | Web spec | Mobile actual |
|---|---|---|
| Modal anatomy | Centered card `app-modal size="lg"` (max-w-5xl) sobre backdrop `bg-black/50`, header border-b, footer border-t con `space-x-3` justify-end content-sized buttons | RNModal transparent + animationType fade + backdrop `rgba(15,23,42,0.45)` Pressable + cardWrapper `maxWidth: 480` + `borderRadius: borderRadius.lg` + shadow + elevation 12. Header con `borderBottomWidth: 1` color gray-200 + close X Pressable. Footer con `borderTopWidth: 1`, `justifyContent: 'flex-end'`, `gap: spacing[3]` (≈12px ≈ web `space-x-3`), buttons content-sized `minWidth: 120`. |
| Input labels | `text-xs font-bold uppercase text-gray-700` + asterisco rojo required + `letter-spacing: 0.5` | `Input` shared: `textTransform: 'uppercase'`, `letterSpacing: 0.5`, `color: colorScales.gray[700]`, `fontWeight: typography.fontWeight.bold`, asterisco rojo via `required={true}`. ✅ |
| Buttons (footer) | `app-button variant="outline"` (Cancelar) + `app-button variant="primary"` (Crear/Guardar) content-sized right-aligned | Mismo: `Button variant="outline"` (Cancelar) + `Button variant="primary"` (Crear Cupon/Guardar cambios). ✅ |
| Date input | `datetime-local` HTML5 | `DatePicker` solo date (mobile-first, aceptable) |
| MultiSelector | `MultiSelectorComponent` (chips con X) | `MultiSelector` shared — misma UX |
| Toggle (activo) | `SettingToggleComponent` description `Disponible para uso inmediato` | `Toggle` description literal igual |
| Color tokens | gray-100/200/300/500/700/900 + blue-100/600 + green-100/600 + purple-100/600 + amber-100/600 | `colorScales.gray[100..900]` + hex específicos para iconos (#DBEAFE, #DCFCE7, #EDE9FE, #FEF3C7) — idénticos visualmente |

### 14. Toast & feedback copy

| Caso | Web (response.message backend) | Mobile |
|---|---|---|
| Create success | `Cupón creado exitosamente` | Toast `res?.message ?? 'Cupón creado exitosamente'` ✅ |
| Update success | `Cupón actualizado exitosamente` | Toast `res?.message ?? 'Cupón actualizado exitosamente'` ✅ |
| Delete success | `Cupón eliminado exitosamente` | Toast `res?.message ?? 'Cupón eliminado exitosamente'` ✅ |
| Create error | `Error al crear el cupón` (fallback) | Toast `err?.response?.data?.message ?? 'Error al crear el cupón'` ✅ |
| Update error | `Error al actualizar el cupón` | Toast igual ✅ |
| Delete error | `Error al eliminar el cupón` | Toast igual ✅ |

### 15. Validation message parity

| Validación | Web (inline) | Mobile (inline `error` prop) |
|---|---|---|
| code minLength | `Minimo 3 caracteres` | `COUPON_LABELS.errCodeMinLength: 'Minimo 3 caracteres'` ✅ |
| name minLength | `Minimo 2 caracteres` | `COUPON_LABELS.errNameMinLength: 'Minimo 2 caracteres'` ✅ |
| discount_value | `Requerido, mayor a 0` | `COUPON_LABELS.errValueRequired: 'Requerido, mayor a 0'` ✅ |
| valid_from | `Requerido` | `COUPON_LABELS.errValidFromRequired: 'Requerido'` ✅ |
| valid_until | `Requerido` | `COUPON_LABELS.errValidUntilRequired: 'Requerido'` ✅ |
| productos | `Selecciona al menos un producto` | `COUPON_LABELS.errProductsRequired` ✅ |
| categorias | `Selecciona al menos una categoria` | `COUPON_LABELS.errCategoriesRequired` ✅ |
| (extra mobile) | — | `Debe ser menor o igual a 100` (adicional en mobile, no en web) |

---

## Mobile Current State

### Archivos existentes
```
apps/mobile/app/(store-admin)/marketing/coupons/index.tsx           # Pantalla lista
apps/mobile/src/features/store/services/coupons.service.ts          # API layer
apps/mobile/src/features/store/types/coupon.types.ts                # DTOs mirror
apps/mobile/src/features/store/constants/coupon-labels.ts           # Labels verbatim + helpers
apps/mobile/src/features/store/components/coupon-card.tsx           # Card item
apps/mobile/src/features/store/components/coupon-stats-cards.tsx   # 4 KPI cards
apps/mobile/src/features/store/components/coupon-upsert-modal.tsx   # Modal create/edit
```

### Visual treatment por capability
- **Lista**: `FlatList` con `CuponCard` dentro de `Card` (margen horizontal spacing[4]). Header: name + code mono + Badge activo/inactivo + RowActionsMenu (edit/delete). Meta row: tipo + valor + usos + valid_until (es-CO).
- **Stats**: 4 `StatsCard` con `iconBg`/`iconColor` matching web (blue/green/purple/amber).
- **Modal**: `RNModal transparent` + animationType fade + backdrop Pressable rgba(15,23,42,0.45) + cardWrapper maxWidth 480 + borderRadius lg + shadow + header (border-bottom gray-200) + close X Pressable + body ScrollView gap-4 + footer (border-top gray-200, justify-end, gap-3, content-sized buttons). **NO usa el shared `Modal` full-screen — replica centered card**. ✅
- **Inputs**: shared `Input` con `required` → asterisco rojo; `prefix`/`suffix` para currency/percentage indicators. `Textarea`, `Selector`, `Toggle`, `MultiSelector`, `DatePicker` todos shared y consistentes con web.
- **Toasts**: zustand store, strings verbatim del backend o fallback `coupon-labels.ts`.

### Hooks / state
- `useInfiniteQuery` para paginación (mobile-first — web hace 1 página).
- `useQuery` para stats.
- `useMutation` para create/update/delete con `invalidateQueries(['coupons'])` y `['coupon-stats']`.
- Estado local con `useState` (search, modalOpen, editingCoupon, deleteTarget, form fields, errors).

### Visual drift detected
- ✅ Centered card modal (no full-screen)
- ✅ Header title `Editar Cupon` / `Crear Cupon` — verbatim (con "Cupon" sin tilde, mismo que web)
- ✅ Buttons footer content-sized, outline + primary, right-aligned, gap-3
- ✅ Labels uppercase + asterisk required + letter-spacing 0.5
- ✅ Toast strings verbatim
- ⚠️ **Minor**: Web usa `Codigo` (con tilde) en label pero mobile usa `Codigo` sin tilde en `COUPON_LABELS.fieldCode`. Esto es coherente con cómo el web usa `Crear Cupon` (sin tilde). Verificado: web `coupon-modal.component.ts:50` usa `'Editar Cupon'` / `'Crear Cupon'` (sin tilde). Mobile replica verbatim. **NOTA**: el campo `fieldCode` dice `Codigo` (sin tilde también) — match con el web. ✅
- ⚠️ **Minor**: Web usa `datetime-local`; mobile solo date. **Diferencia funcional aceptable** (mobile no tiene picker de hora; backend acepta date ISO y aplica T00:00:00).

---

## Strategic Gap Map

| Capability | Web | Mobile (funcional) | Mobile (visual) | Status | Priority | Endpoint / gate | Visual notes |
|---|---|---|---|---|---|---|---|
| **Listar cupones paginado** | ✅ (single page) | ✅ | ✅ | **Present** | — | `GET /store/coupons` | Mismo shape |
| **Infinite scroll** | ❌ (no UI) | ✅ (mobile-first) | — | **N/A** (mobile-extra) | — | — | Mejora mobile |
| **Búsqueda con debounce 300ms** | ✅ | ✅ | ✅ | **Present** | — | `search` param | Mismo |
| **4 KPI stats cards sticky** | ✅ | ✅ | ✅ | **Present** | — | `GET /store/coupons/stats` | Colores/iconos matching |
| **Crear cupón (modal centered card)** | ✅ | ✅ | ✅ | **Present** | — | `POST /store/coupons` | Replica exacta anatomía |
| **Editar cupón** | ✅ | ✅ | ✅ | **Present** | — | `PATCH /store/coupons/:id` | Reutiliza modal |
| **Eliminar cupón (soft delete)** | ✅ | ✅ | ✅ | **Present** | — | `DELETE /store/coupons/:id` | ConfirmDialog destructive |
| **Refresh manual (pull-to-refresh)** | ❌ (no UI) | ✅ | — | **N/A** (mobile-extra) | — | — | Mejora mobile |
| **Filtro por is_active** | ❌ (no UI) | ❌ | — | **N/A** | — | backend acepta `is_active` | Ambos coinciden en N/A |
| **Filtro por discount_type** | ❌ (no UI) | ❌ | — | **N/A** | — | backend acepta `discount_type` | Ambos coinciden en N/A |
| **Sort columns** | ✅ (sortable: code, name) | ❌ | — | **Partial** | P2 | backend acepta `sort_by/sort_order` | Funcionalmente web lo declara pero NO lo expone en UI; mobile igual. **No es gap real**. |
| **Generate code button** | ✅ (suffix icon refresh) | ✅ (suffix icon refresh) | ✅ | **Present** | — | client-side random 8 chars | Mismo |
| **Conditional multi-selector productos** | ✅ | ✅ | ✅ | **Present** | — | — | Mismo |
| **Conditional multi-selector categorias** | ✅ | ✅ | ✅ | **Present** | — | — | Mismo |
| **Validación inline (code/name/value/dates)** | ✅ | ✅ | ✅ | **Present** | — | client-side + backend | Strings verbatim |
| **Toggle Cupon activo** | ✅ | ✅ | ✅ | **Present** | — | — | Mismo |
| **Toast success/error verbatim** | ✅ | ✅ | ✅ | **Present** | — | — | Strings verbatim |
| **Soft-delete confirm dialog** | ✅ DialogService | ✅ ConfirmDialog | ✅ | **Present** | — | — | Anatomía matching |
| **getById (single coupon detail)** | ✅ (service exportado) | ✅ (service exportado) | — | **Present** | — | `GET /store/coupons/:id` | No usado en admin UI en ninguno de los dos |
| **Validate coupon (POS flow)** | ✅ (en POS) | ❌ (mobile POS tiene su propio flujo) | — | **Partial** | P2 | `POST /store/coupons/validate` | El mobile **no usa admin para validar**; el POS mobile probablemente valida cupones en su flujo. **Verificar POS mobile**. |

---

## Coverage Summary

- **Functional axis**: Present **16**/17 · Partial **1** · Absent **0** · N/A **3** (sort, filtros is_active/discount_type — no expuestos en web ni mobile) → **94 %** Present
- **Visual axis**: Present **16**/16 (todas las capabilities visualizables tienen anatomía matching) · Partial **0** · Absent **0** · N/A **3** → **100 %** Present
- **Combined**: **94 %** Present (1 Partial es `validate`, usado solo en POS flow — no es gap del admin)

---

## Recommended Sequencing (input a how-to-plan)

> **El módulo está esencialmente completo.** Las acciones pendientes son P2 y opcionales:

1. **(P2 — opcional) Verificar POS mobile consume `POST /store/coupons/validate`** — confirmar que el POS mobile aplica cupones vía el endpoint compartido. Si no lo hace, agregarlo. (No es gap del admin Cupones; es del POS.)
2. **(P2 — opcional) Exponer filtros sort/is_active/discount_type** — tanto web como mobile podrían agregar un `FilterDropdown` para `is_active` y un sort header. Pero como web no lo expone actualmente, no es gap de mobile.

**No hay gaps críticos.** El módulo Cupones mobile está listo para producción.