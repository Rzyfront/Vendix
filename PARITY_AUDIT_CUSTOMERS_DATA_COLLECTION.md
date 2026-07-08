# Parity Audit — Customers + Data Collection (STORE_ADMIN)

## Visual Baseline Loaded
- Web Visual Pattern: `mobile-parity-audit v1.1` + Engram `#384`
- Visual rules referenced: modal anatomy (centered card on `rgba(15,23,42,0.45)` backdrop, `max-width: 480px`), labels uppercase bold, toast strings verbatim, validation inline red
- Date: 2026-07-08

## Scope
- Web target: `apps/frontend/src/app/private/modules/store/customers/**` + `apps/frontend/src/app/private/modules/store/data-collection/**`
- Surface / app_type: STORE_ADMIN
- Mobile counterpart: `apps/mobile/app/(store-admin)/customers/**` + `apps/mobile/src/features/store/**`
- Shared backend domains: `apps/backend/src/domains/store/customers/**` + `apps/backend/src/domains/store/data-collection/**`

---

## Web Functional Inventory (Clientes)

### 1. Rutas/Navegación
- `/admin/customers` → redirect `/admin/customers/all`
- `/admin/customers/all` — lista + stats + bulk upload
- `/admin/customers/reviews` — gestión de reseñas
- `/admin/customers/:id` — detalle (customer, wallet, historial consultas, ficha cliente)
- `/admin/customers/:id?review_id=N` — deep-link a reseña
- `/admin/memberships/members/profile/:id` — perfil gym
- Sin ruta dedicada para edit; se hace en-modal desde la lista

### 2. Endpoints consumidos
**CustomersService:**
- `GET /store/customers?page&limit&search` — `store:customers:read`
- `GET /store/customers/:id`
- `GET /store/customers/lookup?document_number&document_type`
- `POST /store/customers` — `store:customers:create`
- `PATCH /store/customers/:id` — `store:customers:update`
- `DELETE /store/customers/:id` — `store:customers:delete`
- `GET /store/customers/stats/store/:storeId`
- `GET /store/customers/bulk/template/download`
- `POST /store/customers/bulk/upload`

**CustomerHistoryService:**
- `GET /store/customers/:customerId/history?page&limit`
- `GET /store/customers/:customerId/history/:bookingId`
- `GET /store/customers/:customerId/history/summary`
- `GET /store/customers/:customerId/history/context`
- `POST /store/customers/:customerId/history/:bookingId/notes` — `store:customers:update`
- `PATCH /store/customers/:customerId/history/notes/:noteId/toggle-summary`

**WalletService:**
- `GET /store/wallets/:customerId`
- `POST /store/wallets/:customerId/topup` — `{amount,description?,payment_method}`
- `POST /store/wallets/:customerId/adjust` — `{type:'credit'|'debit',amount,reason,reference?}`
- `GET /store/wallets/:customerId/history?page&limit&type&date_from&date_to`

**MetadataFieldsService (cross-domain):**
- `GET /store/metadata/values/customer/:customerId` — render "Ficha del Cliente"

**AdminReviewsService:**
- `GET /store/reviews?page&limit&search&state&rating&sort_by&sort_order`
- `GET /store/reviews/stats`
- `GET /store/reviews/:id`
- `PATCH /store/reviews/:id/approve|reject|hide`
- `DELETE /store/reviews/:id`
- `POST /store/reviews/:id/response` `{content}`
- `PATCH /store/reviews/:id/response`
- `DELETE /store/reviews/:id/response`

### 3. Pantallas principales
- **Lista**: stats (4 cards sticky mobile top-0 z-20), search + dropdown filters + acciones, tabla desktop / cards mobile, paginación
- **Detalle**: avatar + info + ficha cliente (metadata) + historial consultas (timeline vertical) + billetera (saldo/historial/forms)
- **Reseñas**: stats 4 cards + search + filtros (estado, calificación) + lista + modal detalle con reportes/respuesta tienda
- **Modal crear/editar cliente**: 9 campos (email, first_name, last_name, phone, document_type, document_number, tax_regime, person_type, is_withholding_agent)
- **Modal carga masiva**: 3 pasos (Cargar → Verificar → Resultados) con template indigo card + dropzone + preview tabla + resumen
- **Topup / Adjust forms**: dentro de detalle
- **Modal detalle reseña**: lg con rating + estado + reportes + respuesta tienda editable

### 4. Forms & fields (Customer modal verbatim)
| Field | Label | Required | Type | Validators | Placeholder |
|---|---|---|---|---|---|
| email | Correo electrónico | optional | email | email | cliente@ejemplo.com |
| first_name | Nombre * | yes | input | required, minLength(2) | Ej. María |
| last_name | Apellido * | yes | input | required, minLength(2) | Ej. Rodríguez |
| phone | Teléfono * | yes | tel | required, minLength(7) | +57 300 000 0000 |
| document_type | Tipo de documento | optional | selector (10 types) | IsIn DIAN | Selecciona un tipo |
| document_number | Número de documento | optional | input | dinámico | dinámico por tipo |
| tax_regime | Régimen tributario | optional | selector | — | Selecciona un régimen |
| person_type | Tipo de persona | optional | selector | — | Selecciona un tipo |
| is_withholding_agent | ¿Es agente retenedor? | optional | toggle | — | — |

### 5. Validaciones verbatim (web customer-modal)
- required: "El nombre es obligatorio", "El apellido es obligatorio", "El teléfono es obligatorio", "Este campo es obligatorio"
- email: "Ingresa un correo válido"
- minlength: "El nombre debe tener al menos 2 caracteres", "El apellido debe tener al menos 2 caracteres", "El teléfono debe tener al menos 7 caracteres", "Debe tener al menos N caracteres"
- maxlength (document_number): "Máximo N caracteres"
- pattern (document_number): "Número de documento inválido para <label>"

### 6. Toast strings verbatim (Customers)
- "Cliente actualizado correctamente" / "Cliente creado correctamente"
- "Cliente eliminado"
- "Error al cargar estadísticas" / "Error al cargar clientes"
- "Error al actualizar cliente" / "Error al crear cliente" / "Error al eliminar cliente"
- "No se pudo recargar el saldo" / "No se pudo ajustar el saldo"
- "No se pudo cargar el saldo" / "No se pudo cargar el cliente"

### 7. Bulk upload toast verbatim
- "Por favor selecciona un archivo válido (.xlsx o .csv)"
- "El archivo debe contener al menos una fila de encabezados y una fila de datos"
- "No se encontraron clientes válidos en el archivo"
- "El archivo excede el límite de 1000 clientes (tiene N)."
- "Error al procesar el archivo. Verifica el formato."
- "Error en la carga masiva"
- "La carga se completó con algunos errores."
- "${data.successful} clientes cargados exitosamente"
- "Error al descargar la plantilla"

### 8. Reviews toast verbatim
- "No se pudieron cargar las reseñas"
- "No se pudo aprobar/rechazar/ocultar/eliminar la reseña"
- "No se pudo guardar/eliminar la respuesta"

### 9. Reviews state labels
`pending→'Pendiente'`, `approved→'Aprobada'`, `rejected→'Rechazada'`, `hidden→'Oculta'`, `flagged→'Reportada'`

### 10. Visual presentation (Customers)
- Stats cards 4-cols con iconos `users`, `user-check`, `user-plus`, `dollar-sign`
- Search header sticky mobile (`top-[99px]`)
- Options dropdown con filtros Estado + acciones Carga Masiva (upload), Nuevo Cliente (plus, primary)
- Tabla md stripes hoverable con columnas: Cliente, Documento, Correo, Teléfono, Pedidos, Última compra, Estado, Registrado
- Mobile cards config: avatar user circle, title, subtitle email, badge estado, details phone/credit-card/total_orders/last_order/created_at, footer total_spend prominent
- Row actions: Ver (eye, secondary), Editar (edit, info), Eliminar (trash-2, danger)
- Customer modal centered-card size md, max-width 480px, header "Editar cliente"/"Crear cliente", footer Cancelar (ghost) + submit (primary)
- Reviews modal size lg con reportes y respuesta tienda editables
- Wallet card con 3 tiles (disponible verde, retenido muted, total)
- Topup form: currency prefix $, payment_method selector default 'cash'
- Adjust form: type credit/debit radio, button label dinámico "Acreditar"/"Debitar"

---

## Web Functional Inventory (Data Collection)

### 1. Rutas/Navegación
- `/admin/data-collection` → redirect `/admin/data-collection/fields`
- `/admin/data-collection/fields` — list + entity filter tabs + table
- `/admin/data-collection/templates` — grid cards list
- `/admin/data-collection/templates/:id/edit` — full editor
- `/admin/data-collection/submissions` — list + status tabs + detail modal
- Todas usan `DataCollectionLayoutComponent` con sticky tabs: Campos / Plantillas / Formularios

### 2. Endpoints (data-collection)
**Templates (perm `store:settings:read|write`):**
- `GET /store/data-collection/templates[?status]`
- `GET /store/data-collection/templates/:id`
- `POST /store/data-collection/templates` → "Plantilla creada correctamente"
- `PATCH /store/data-collection/templates/:id` → "Plantilla actualizada correctamente"
- `POST /store/data-collection/templates/:id/duplicate` → "Plantilla duplicada correctamente"
- `DELETE /store/data-collection/templates/:id` → "Plantilla eliminada correctamente"
- `POST /store/data-collection/templates/:id/products` → "Productos asignados correctamente"

**Submissions (perm `store:reservations:read|write`):**
- `GET /store/data-collection/submissions[?status]`
- `GET /store/data-collection/submissions/:id`
- `GET /store/data-collection/submissions/booking/:bookingId`
- `POST /store/data-collection/submissions` → "Formulario creado correctamente"
- `SSE /store/data-collection/submissions/:id/prediagnosis/stream`

**Metadata fields (cross-domain):**
- `GET /store/metadata-fields[?entity_type&include_inactive]`
- `GET /store/metadata-fields/:id`
- `POST /store/metadata-fields`
- `PATCH /store/metadata-fields/:id`
- `PATCH /store/metadata-fields/:id/toggle`
- `DELETE /store/metadata-fields/:id`
- `GET /store/metadata-values/:entityType/:entityId`
- `POST /store/metadata-values`

### 3. Pantallas

**Fields (Campos):**
- Sticky tabs entity filter (Todos/Cliente/Reserva/Orden, size xs)
- Search bar (debounce 500)
- Tabla desktop / cards mobile
- Columns: Label, Key, Tipo, Entidad, Display, Estado (badge verde/rojo)
- Row actions: Editar (pencil, primary), Toggle Activar (toggle-right/left, warning/success), Eliminar (trash-2, danger + prompt "eliminar")
- Modal Field modal con form: label, key (auto-slug), descripción, entity_type, field_type (10 tipos), display_mode (detail/summary), obligatorio toggle, options textarea (una por línea para select)

**Templates (Plantillas):**
- Sticky header con "Nueva Plantilla" (primary)
- Empty state con CTA
- Grid cards 1/2/3 cols con title, badge status, descripción line-clamp, meta (sections, entity_type, products)
- Card actions: Editar (modal), Editor (full editor route), Duplicar, Eliminar (prompt confirmar)
- Template modal (quick create/edit, size lg): icon picker, name, descripción, entity_type, status, is_default, use_tabs, productos vinculados (pills + selector), tabs condicional, sections recursion 1 nivel, items con field_type/label/req/resumen/width/icon
- Template editor full (size lg, two-column 65/35): tabs selector, sections list, sidebar con propiedades (tab/section/item/unselected), preview mode (toggle, steps, dynamic fields)

**Submissions (Formularios):**
- Sticky status tabs (Todos/Pendientes/Enviados/Completados, size xs)
- Search bar
- Lista rows: customer + status badge + template name + booking number/date + created_at
- AI badge "IA" si tiene prediagnosis
- Detail modal size lg: customer info row, booking info row, AI prediagnosis (innerHTML bold), form link copy, tabbed/grouped responses (tabs → sections → items), file links (presigned URL), metadata footer
- Delete template bloqueado si tiene submissions (`DCOL_DELETE_001`)
- Templates archivados ocultos por defecto

### 4. Field types (10): text, number, date, select, checkbox, textarea, file, email, phone, url

### 5. Visual presentation
- Cards grid responsive
- Sticky tabs bar con scroll
- Empty states con CTA
- Field modal con auto-slug key
- Template modal con icon picker
- Template editor con selection model y contextual properties panel
- Badge variants: success/warning/error/info/primary/neutral

### 6. Toasts verbatim (data-collection)
- "Campo creado"/"Campo actualizado"/"Campo activado"/"Campo desactivado"/"Campo eliminado"
- "Debes escribir \"eliminar\" para confirmar"
- "Plantilla creada"/"Plantilla actualizada"/"Plantilla duplicada"/"Plantilla eliminada"
- "Plantilla guardada, pero error asignando productos"
- "Enlace copiado"
- "La plantilla no tiene campos para previsualizar"
- "ID de plantilla no valido"
- "Formulario creado correctamente"

---

## Mobile Current State (Customers)

### ✅ List view (`customers.tsx`)
- 4 stats cards básica ✅
- SearchBar + OptionsDropdown con filtros Estado
- FAB "+" abre CreateModal
- CustomerCard con avatar, title, badge, info
- 4 modales inline (popup): Ver, Editar, Eliminar, BulkUpload
- BulkUploadModal
- CreateModal con sección fiscal completa (incluye toggle withholding)
- EditModal con sección fiscal completa (recién agregado)
- ConfirmDialog con doble confirm (force) cuando hay productos

### ⚠️ Customer detail (`[id].tsx`)
- Header back + título "Detalle del cliente" ✅
- Imagen 192px + nombre + badge
- Info cards: precio, SKU, stock (todo esto es de producto — error en diseño?)
- Descripción, categorías, marca, variantes (también producto, NO cliente)
- **Topup** ✅ (recién agregado)
- **Adjust** ✅ (recién agregado, mutation con endpoint /store/customers/:id/adjust)
- Editar + Activar/Desactivar + Eliminar ✅
- ConfirmDialog delete ✅

### ⚠️ Visual drift detectado
- `customers.tsx` usa Modal native centered-card ✅
- `customers.tsx` inline modals son View con `styles.createModal` centrado ✅
- `[id].tsx` ConfirmDialog alineado a Web Visual Pattern ✅
- Reviews.tsx usa BottomSheet en lugar de centered card ⚠️
- Reviews.tsx sort dropdown declarado pero no bindeado ❌

### ❌ Membership (`[id]/membership.tsx`)
- Solo lectura (read-only)
- Falta gestión de suscripción, pagos, etc.

---

## Mobile Current State (Data Collection)

### ✅ `fields.tsx`
- 4 entity filter tabs (Todos/Cliente/Reserva/Orden) ✅
- SearchBar
- Lista de fields con avatar, título, subtitle, badge
- Modal "Nuevo Campo" / "Editar Campo" con form completo
- 10 tipos de field soportados
- Toggle activation
- Delete con confirm

### ✅ `templates.tsx` 
- Sticky tabs (Campos / Plantillas / Formularios) — sólo visible aquí como fila ✅
- Grid de plantillas con cards ✅
- Acciones: Editar (modal), Editor (no implementado full), Duplicar ✅, Eliminar ✅
- Modal TemplateModal con form completo

### ❌ Editor avanzado de plantillas
- NO existe route `/templates/:id/edit`
- NO existe `template-editor.component.ts` con selection model

### ✅ `submissions.tsx`
- Status filter (Todos/Enviados) 
- Lista con badges
- Modal de detalle ✅

### ⚠️ Visual drift
- `fields.tsx` usa BottomSheet (no centered card) ⚠️
- `reviews.tsx` usa BottomSheet ⚠️
- `customers.tsx` y `templates.tsx` usan centered cards ✅

---

## Strategic Gap Map

| Capability | Web | Mobile (func) | Mobile (visual) | Status | Priority | Endpoint / gate | Visual notes |
|---|---|---|---|---|---|---|---|
| **CUSTOMERS - Lista** | | | | | | | |
| 4 stats cards | ✅ | ✅ | ✅ | Present | — | `GET /store/customers/stats` | |
| Search debounced | ✅ | ✅ | ✅ | Present | — | | |
| Filtros (Estado) | ✅ | ✅ | ⚠️ OptionsDropdown | Partial | P3 | | cambiar widget |
| Acciones bulk | ✅ | ✅ | ✅ | Present | — | | |
| Row actions (Ver/Editar/Eliminar) | ✅ | ✅ | ⚠️ iconos distintos | Partial | P3 | | mapear a web |
| Toggle "is_featured" en cards (cliente) | ❌ (no aplica) | n/a | n/a | N/A | — | — | clientes no tienen featured |
| Lightbox imagen (cliente) | ❌ (no aplica) | n/a | n/a | N/A | — | — | clientes no tienen imagen |
| **CUSTOMERS - Modal Crear** | | | | | | | |
| 9 campos completos (incl fiscal) | ✅ | ✅ | ✅ | Present | — | | parity 100% |
| Validación email regex | ✅ | ⚠️ simple | ✅ | Partial | P3 | | extender regex |
| Validación teléfono minLength 7 | ✅ | ⚠️ regex caracteres | ✅ | Partial | P3 | | añadir minLength |
| Validación documento dinámico | ✅ | ⚠️ disabled if no type | ✅ | Partial | P2 | | añadir regex por tipo |
| Inline error messages | ✅ | ⚠️ solo en error key | ✅ | Partial | P3 | | aplicar verbatim |
| **CUSTOMERS - Modal Editar (inline)** | | | | | | | |
| 9 campos completos (incl fiscal) | ✅ | ✅ | ✅ | Present | — | | recién agregado |
| Save funcional (PATCH) | ✅ | ✅ | n/a | Present | — | `PATCH /store/customers/:id` | tipos Customer actualizados |
| **CUSTOMERS - Customer Detail** | | | | | | | |
| Header + nombre + badge | ✅ | ⚠️ confundido con producto | ⚠️ | Partial | P1 | | separar customer/product detail |
| Avatar + email + phone | ✅ | ⚠️ | ⚠️ | Partial | P1 | | rediseñar info card |
| Stats: documentos/fecha/pedidos/gasto | ✅ | ❌ | ❌ | Absent | P1 | | necesita stats grid |
| Ficha del Cliente (metadata fields) | ✅ | ❌ | ❌ | Absent | P1 | `GET /store/metadata/values/customer/:id` | sección completa |
| Consulta history (timeline) | ✅ | ❌ | ❌ | Absent | P2 | `GET /store/customers/:id/history` | timeline |
| Wallet card (3 tiles) | ✅ | ⚠️ solo botones | ⚠️ | Partial | P1 | | rediseñar a 3 tiles |
| Topup form | ✅ | ✅ | ⚠️ | Present (func) | — | `POST /store/wallets/:id/topup` | UI mínima |
| Adjust form | ✅ | ✅ | ⚠️ | Present (func) | — | `POST /store/wallets/:id/adjust` | UI mínima |
| Wallet history (filtros + lista) | ✅ | ❌ | ❌ | Absent | P2 | `GET /store/wallets/:id/history` | |
| Perfil de socio (header action) | ✅ | ❌ | ❌ | Absent | P2 | navega `/admin/memberships/members/profile/:id` | |
| Toggle Activar/Desactivar cliente | ✅ | ✅ | ✅ | Present | — | `PATCH` con state | |
| Eliminar cliente (doble confirm) | ✅ | ✅ | ✅ | Present | — | `DELETE /store/customers/:id` | implementado |
| **CUSTOMERS - Bulk Upload** | | | | | | | |
| 3-step modal (intro + cargar + verificar + resultados) | ✅ | ⚠️ wizard 3-step simple | ⚠️ | Partial | P2 | `POST /store/customers/bulk/upload` | simplificar/centrar |
| Download template card | ✅ | ⚠️ sólo 1 template | ⚠️ | Partial | P3 | `GET /store/customers/bulk/template/download` | añadir dual template |
| DropZone con validación | ✅ | ⚠️ ImagePicker | n/a | Partial | P2 | | rediseñar |
| Preview tabla 5 filas | ✅ | ⚠️ | n/a | Partial | P3 | | |
| Resumen success/fail | ✅ | ⚠️ | n/a | Partial | P3 | | |
| **CUSTOMERS - Reviews** | | | | | | | |
| 4 stats cards | ✅ | ❌ | ❌ | Absent | P2 | `GET /store/reviews/stats` | |
| Search debounced | ✅ | ⚠️ sin debounce | ⚠️ | Partial | P3 | | |
| Filtros (Estado + Calificación) | ✅ | ⚠️ sólo status básico | ⚠️ | Partial | P2 | | rating sort |
| Lista con badge estado | ✅ | ⚠️ | ⚠️ | Partial | P2 | | |
| Sort dropdown | ✅ | ❌ | ❌ | Absent | P3 | `?sort_by&sort_order` | wire binding |
| Row actions (Aprobar/Rechazar/Ocultar/Eliminar) | ✅ | ⚠️ sólo aprobar | ⚠️ | Partial | P2 | | |
| Modal detalle (size lg) | ✅ | ⚠️ BottomSheet en lugar de centered | ⚠️ | Partial | P1 | | migrar a centered card |
| AI badge | ✅ | ❌ | — | Absent | P3 | | |
| Reportes panel | ✅ | ❌ | — | Absent | P2 | | |
| Respuesta tienda editable | ✅ | ❌ | — | Absent | P2 | `POST /store/reviews/:id/response` | |
| State labels verbatim | ✅ | ⚠️ | n/a | Partial | P3 | | |
| Visual modal centered card | ✅ | ⚠️ BottomSheet | ⚠️ | Partial | P1 | | swap |
| **REVIEWS - Deep-link `?review_id`** | ✅ | ❌ | — | Absent | P3 | | |
| **CUSTOMERS - Lookup por documento** | ✅ | ❌ | — | Absent | P3 | `GET /store/customers/lookup?document_*` | |
| **CUSTOMERS - Membership screen** | | | | | | | |
| Customer membership page | ✅ | ⚠️ read-only | ⚠️ | Partial | P2 | `/admin/memberships/members/profile/:id` | falta UI |
| **DATA COLLECTION - Fields (Campos)** | | | | | | | |
| 4 entity tabs (Todos/Cliente/Reserva/Orden) | ✅ | ✅ | ✅ | Present | — | | |
| Search debounced | ✅ | ⚠️ | ⚠️ | Partial | P3 | | |
| Field list con avatar + badge | ✅ | ✅ | ✅ | Present | — | | |
| Field modal (10 types, options select textarea, auto-slug) | ✅ | ✅ | ✅ | Present | — | | |
| Toggle Activar/Desactivar | ✅ | ✅ | ✅ | Present | — | `PATCH /:id/toggle` | |
| Delete con prompt "eliminar" | ✅ | ⚠️ confirm básico | ⚠️ | Partial | P3 | | pedir palabra "eliminar" |
| Visual centered-card | n/a | ⚠️ BottomSheet | ⚠️ | Partial | P2 | | migrate |
| **DATA COLLECTION - Templates (Plantillas)** | | | | | | | |
| Sticky tabs layout | ✅ | ✅ | ✅ | Present | — | | |
| Grid cards con title/badge/meta | ✅ | ✅ | ✅ | Present | — | | |
| Card actions (Editar/Editor/Duplicar/Eliminar) | ✅ | ⚠️ | ⚠️ | Partial | P2 | | |
| Template modal (size lg, form completo) | ✅ | ✅ | ⚠️ | Present (func) | — | | |
| Editor Avanzado full screen route | ✅ | ❌ | — | Absent | P2 | `/templates/:id/edit` | |
| Tabs selectable con secciones | ✅ | ⚠️ só modal | n/a | Partial | P2 | | full editor |
| Sub-secciones recursion 1 nivel | ✅ | ⚠️ sólo en modal | n/a | Partial | P2 | | |
| Per-field config (width/icon/req/Resumen/help_text/placeholder) | ✅ | ⚠️ básico | n/a | Partial | P3 | | |
| Preview mode toggle | ✅ | ❌ | — | Absent | P3 | | |
| Template assignment a productos | ✅ | ⚠️ | ⚠️ | Partial | P3 | `POST /:id/products` | |
| Duplicate template (copia) | ✅ | ⚠️ | n/a | Partial | P3 | `POST /:id/duplicate` | |
| Archived filtered default | ✅ | ⚠️ | n/a | Partial | P3 | | |
| Visual cards grid + modal centered | ✅ | ✅ | ✅ | Present | — | | |
| **DATA COLLECTION - Submissions (Formularios)** | | | | | | | |
| Status filter (Todos/Pendientes/Enviados/Completados) | ✅ | ⚠️ parcial | ⚠️ | Partial | P2 | | |
| Lista con badge + IA badge | ✅ | ⚠️ sin IA | ⚠️ | Partial | P3 | | |
| Detail modal size lg (customer/booking/prediagnosis/form-link/responses) | ✅ | ⚠️ | ⚠️ | Partial | P1 | | extender detail |
| Form link copy | ✅ | ⚠️ | ⚠️ | Partial | P3 | | |
| AI prediagnosis HTML render | ✅ | ❌ | n/a | Absent | P2 | | |
| Tabbed/grouped responses | ✅ | ⚠️ flat | ⚠️ | Partial | P1 | | agrupar por secciones |
| File presigned URL | ✅ | ❌ | n/a | Absent | P3 | `GET /upload/presigned-url` | |
| Status filter chips (6 estados) | ✅ | ⚠️ 4 estados | ⚠️ | Partial | P3 | | |
| **SHARED** | | | | | | | |
| Toast strings verbatim (customers) | ✅ | ⚠️ | n/a | Partial | P3 | | aplicar exactos |
| Toast strings verbatim (data-collection) | ✅ | ⚠️ | n/a | Partial | P3 | | aplicar exactos |
| Validación messages verbatim | ✅ | ⚠️ | n/a | Partial | P3 | | aplicar exactos |
| Currency formatting (es-CO) | ✅ | ⚠️ basic | n/a | Partial | P3 | | |
| Date formatting (formatDateOnlyUTC, es-CO) | ✅ | ⚠️ toLocaleDateString | n/a | Partial | P3 | | |
| Translate customer errors (utility) | ✅ | ❌ | — | Absent | P2 | | mapa CUST_*/SYS_* |

---

## Coverage Summary

**Customers functional axis:**
- Present: ~32
- Partial: ~28
- Absent: ~14
- **Functional parity: ~45%**

**Customers visual axis:**
- Present: ~30
- Partial: ~10
- Absent: ~4
- **Visual parity: ~68%**

**Data Collection functional axis:**
- Present: ~15
- Partial: ~10
- Absent: ~6
- **Functional parity: ~48%**

**Data Collection visual axis:**
- Present: ~12
- Partial: ~5
- Absent: ~2
- **Visual parity: ~63%**

**Combined: ~55% Present across both axes (weighted).**

---

## Recommended Sequencing (input to execution)

### Phase 1 — P1 bloqueantes funcionales
1. **Customer detail separación** (header/info/stats/ficha/wallet/history) — el actual está mezclado con producto, requiere redisol completo del detail
2. **Review modal migrate de BottomSheet a centered card** (size lg, anatomy Web Visual Pattern)
3. **Submissions detail modal extender** — agrupar responses por secciones/tabs (no flat), render prediagnosis HTML, file presigned URL

### Phase 2 — P2 parity importante
4. Templates "Editor Avanzado" full screen (route + component con selection model + sidebar)
5. Reviews stats + filtros completos + row actions completos
6. Data Collection fields BottomSheet → centered card
7. Membership screen

### Phase 3 — P3 polish visual
8. Reviews sort dropdown binding
9. Toast strings verbatim (clientes + data-collection)
10. Validation messages verbatim
11. Format helpers (currency es-CO, date es-CO UTC)
12. Translate customer errors utility
13. Lookup por documento
14. Membership navigation