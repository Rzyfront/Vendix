/**
 * Contrato de edición masiva de productos (QUI-567) — espejo EXACTO del backend.
 *
 * Fuente de verdad:
 * `apps/backend/src/domains/store/products/dto/bulk-edit-products.dto.ts`
 *
 * El `ValidationPipe` global corre con `whitelist: true` y
 * `forbidNonWhitelisted: true` (`apps/backend/src/main.ts:57-65`), así que
 * `BulkEditableChanges` es un contrato CERRADO: cualquier propiedad que no
 * exista en `BulkEditableChangesDto` devuelve 400. No añadir campos aquí sin
 * añadirlos primero en el DTO.
 *
 * Los valores se tipan como uniones de literales (vía `` `${Enum}` ``) en vez de
 * como los enums directamente, por dos motivos:
 *  1. Un miembro de string-enum ES asignable a su literal, así que el consumidor
 *     puede pasar `ProductType.SERVICE` o `'service'` indistintamente.
 *  2. Los valores llegan del backend como strings crudos al deserializar JSON.
 */

import {
  PricingType,
  ProductState,
  ProductType,
  ServiceModality,
  ServicePricingType,
} from '../interfaces/product.interface';

/**
 * Tope duro de productos por lote. Espejo de `MAX_BULK_EDIT_IDS`
 * (`bulk-edit-products.dto.ts:31`), aplicado en backend por `@ArrayMaxSize`.
 * El endpoint de ids-por-filtro reutiliza el mismo tope para marcar `capped`
 * en vez de truncar la selección en silencio.
 */
export const MAX_BULK_EDIT_IDS = 100;

/** Espejo de `BulkEditItemStatus` (`bulk-edit-products.dto.ts:34`). */
export type BulkEditItemStatus = 'ok' | 'warning' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// Uniones de valores (espejo de `dto/product-enums.ts`)
// ─────────────────────────────────────────────────────────────────────────────

export type BulkEditProductTypeValue = `${ProductType}`;
export type BulkEditProductStateValue = `${ProductState}`;
export type BulkEditPricingTypeValue = `${PricingType}`;
export type BulkEditServiceModalityValue = `${ServiceModality}`;
export type BulkEditServicePricingTypeValue = `${ServicePricingType}`;
/**
 * `BookingMode` NO existe como enum en el frontend (`product.interface.ts` solo
 * lo declara como unión de literales en `Product.booking_mode:71`). Se replica
 * aquí igual, con los valores de `dto/product-enums.ts:44-47`.
 */
export type BulkEditBookingModeValue = 'provider_required' | 'free_booking';

/** Espejo del objeto `dimensions` (`bulk-edit-products.dto.ts:168-172`). */
export interface BulkEditDimensions {
  length: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cuerpo de la petición
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subconjunto ESCALAR de `UpdateProductDto` habilitado para edición masiva.
 * Espejo 1:1 de `BulkEditableChangesDto` — 34 campos, ni uno más.
 *
 * EXCLUIDOS DELIBERADAMENTE por el backend (no añadir sin leer el motivo en
 * `bulk-edit-products.dto.ts:47-60`): `sku`/`slug`/`barcode` (unique por
 * tienda), `stock_quantity` y familia (disparan `inventory_movements`),
 * `image_urls`/`images` (borran objetos de S3), `variants`, `name`/`description`,
 * y los relacionales `category_ids`/`tax_category_ids`/`brand_id`/
 * `enabled_price_tier_ids`.
 */
export interface BulkEditableChanges {
  // ===== Tipo y estado =====
  product_type?: BulkEditProductTypeValue;
  state?: BulkEditProductStateValue;
  pricing_type?: BulkEditPricingTypeValue;

  // ===== Flags de la suite restaurante =====
  is_sellable?: boolean;
  is_ingredient?: boolean;
  is_combo?: boolean;
  is_batch_produced?: boolean;

  // ===== Inventario (solo flags: las cantidades quedan fuera) =====
  track_inventory?: boolean;
  requires_serial_numbers?: boolean;

  // ===== Precios =====
  base_price?: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  allow_pos_price_override?: boolean;
  has_multiple_price_tiers?: boolean;

  // ===== Ecommerce =====
  available_for_ecommerce?: boolean;
  is_featured?: boolean;

  // ===== Físico =====
  weight?: number;
  dimensions?: BulkEditDimensions;

  // ===== UoM (FKs al catálogo global units_of_measure) =====
  stock_uom_id?: number;
  purchase_uom_id?: number;

  // ===== Servicio =====
  service_duration_minutes?: number;
  service_modality?: BulkEditServiceModalityValue;
  service_pricing_type?: BulkEditServicePricingTypeValue;
  requires_booking?: boolean;
  booking_mode?: BulkEditBookingModeValue;
  is_recurring?: boolean;
  service_instructions?: string;
  preparation_time_minutes?: number;

  // ===== Consulta =====
  is_consultation?: boolean;
  send_preconsultation?: boolean;
  consultation_template_id?: number;
  preconsultation_template_id?: number;
}

/** Cuerpo de `POST /store/products/bulk-edit` y de su `/preview`. */
export interface BulkEditProductsRequest {
  ids: number[];
  changes: BulkEditableChanges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Respuestas
// ─────────────────────────────────────────────────────────────────────────────

/** Espejo de `BulkEditFieldDiffDto`. */
export interface BulkEditFieldDiff {
  field: string;
  current: unknown;
  next: unknown;
}

/**
 * Espejo de `BulkEditPreviewItemDto`. `status: 'warning'` significa que el
 * cambio SÍ se aplicará, pero con una neutralización silenciosa (p. ej. un flag
 * que la industria de la tienda no soporta, o precios que el sanitizer de insumo
 * puro anulará).
 */
export interface BulkEditPreviewItem {
  id: number;
  name: string;
  sku: string | null;
  status: BulkEditItemStatus;
  changes: BulkEditFieldDiff[];
  code?: string;
  message?: string;
}

/** Espejo de `BulkEditPreviewResultDto`. */
export interface BulkEditPreviewResult {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  items: BulkEditPreviewItem[];
}

/** Espejo de `BulkEditResultItemDto` — tras aplicar no hay `warning`. */
export interface BulkEditResultItem {
  id: number;
  name: string;
  status: Exclude<BulkEditItemStatus, 'warning'>;
  code?: string;
  message?: string;
}

/** Espejo de `BulkEditResultDto`. */
export interface BulkEditResult {
  total: number;
  successful: number;
  failed: number;
  results: BulkEditResultItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Archivado masivo (soft-delete) — QUI-567 paso 13
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuerpo de `POST /store/products/bulk-edit/archive` y de su `/preview`.
 * Espejo de `BulkArchiveProductsDto` (`bulk-edit-products.dto.ts:333-340`).
 *
 * Solo ids: no hay campos que elegir. Archivar es una ACCIÓN, no un cambio de
 * configuración, y por eso lleva su propia superficie con permiso
 * (`store:products:admin_delete`), preview y confirmación propios.
 */
export interface BulkArchiveProductsRequest {
  ids: number[];
  /**
   * CP-PURCHASE-TRANSPARENCY D.6/D.9 — la confirmación del castigo de
   * inventario.
   *
   * Ausente ⇒ el backend la trata como `false` y `remove()` rechaza CADA
   * producto con existencias con el mismo 409 que por la ruta individual. Sin
   * este campo el archivado masivo quedaría roto al 100 % en cuanto un producto
   * del lote tuviera stock. La confirmación se declara, nunca se asume.
   */
  confirm_stock_write_off?: boolean;
}

/**
 * Espejo de `BulkArchivePreviewItemDto` (`bulk-edit-products.dto.ts:361-368`).
 *
 * NO lleva array de diffs, a diferencia de `BulkEditPreviewItem`: no hay campos
 * `actual → nuevo` porque no hay campos. Lo que el usuario necesita ver es el
 * MOTIVO, así que la fila lleva `code` + `message`.
 *
 * Semántica del `status` (fijada por el backend en
 * `products-bulk-edit.service.ts:506-560`):
 * - `error`: el archivado se BLOQUEA. Reservas de stock activas
 *   (`INV_STOCK_001`), producto en pedidos abiertos —borradores incluidos—
 *   (`PROD_VALIDATE_001`), o producto inexistente / ya archivado
 *   (`PROD_FIND_001`).
 * - `warning`: el archivado SÍ ocurre, con una consecuencia que el usuario debe
 *   conocer: el producto es insumo de una receta activa, o está en una promoción
 *   vigente. Los warnings NO llevan `code` (el backend no inventa códigos
 *   nuevos para reutilizarlos con otra semántica), solo `message`.
 * - `ok`: sin observaciones.
 */
export interface BulkArchivePreviewItem {
  id: number;
  name: string;
  sku: string | null;
  status: BulkEditItemStatus;
  code?: string;
  message?: string;
  /**
   * CP-PURCHASE-TRANSPARENCY D.6/D.9 — lo que ESTA fila va a perder.
   *
   * Aditivos y siempre presentes (0 cuando no hay existencias), incluso en las
   * filas `error`: así la interfaz no tiene que distinguir formas. Opcionales en
   * el espejo porque un lote degradado por un fallo de red los fabrica sin
   * ellos (`archivePreviewFallback`), y ahí el 0 sería una cifra inventada.
   */
  on_hand_units?: number;
  value_to_write_off?: number;
  /**
   * Unidades sin costo conocido. NO significa «gratis»: significa que su costo
   * es desconocido y que su baja no produce asiento contable. No entran en
   * `value_to_write_off`.
   */
  zero_cost_units?: number;
  /**
   * Unidades en ubicaciones fuera del alcance de esta tienda. BLOQUEAN el
   * archivado de esta fila: el backend la devuelve como `error`.
   */
  out_of_scope_units?: number;
}

/** Espejo de `BulkArchivePreviewResultDto`. */
export interface BulkArchivePreviewResult {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  items: BulkArchivePreviewItem[];
  /** D.6 — la cifra agregada que el operador está a punto de aprobar. */
  total_units_to_write_off?: number;
  total_value_to_write_off?: number;
  /** `true` si alguna fila tiene existencias: sin confirmar, el lote no castiga. */
  requires_confirmation?: boolean;
}

/** Espejo de `BulkArchiveResultItemDto` — tras archivar no hay `warning`. */
export interface BulkArchiveResultItem {
  id: number;
  name: string;
  status: Exclude<BulkEditItemStatus, 'warning'>;
  code?: string;
  message?: string;
  /** D.6 — lo que esta fila destruyó DE VERDAD. 0 en las filas fallidas. */
  written_off_units?: number;
  written_off_value?: number;
  zero_cost_units?: number;
  /** Identificadores de los ajustes de baja, para auditar sin salir de aquí. */
  adjustment_ids?: number[];
}

/** Espejo de `BulkArchiveResultDto`. */
export interface BulkArchiveResult {
  total: number;
  successful: number;
  failed: number;
  results: BulkArchiveResultItem[];
  /** D.6 — el desglose agregado de lo que el lote destruyó. */
  written_off_units?: number;
  written_off_value?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro declarativo de campos editables
// ─────────────────────────────────────────────────────────────────────────────

/** Clave de un campo editable. Derivada del contrato: no puede desviarse. */
export type BulkEditableFieldKey = keyof BulkEditableChanges;

/**
 * Tipo de control con el que se pinta el campo. Cada valor mapea a un
 * componente compartido REAL usado hoy por el formulario individual
 * (`pages/product-create-page/product-create-page.component.html`):
 *
 * | valor          | componente                        | ejemplo en el form individual |
 * | -------------- | --------------------------------- | ----------------------------- |
 * | `toggle`       | `app-setting-toggle`              | `is_on_sale` (html:339)       |
 * | `selector`     | `app-selector`                    | `pricing_type` (html:250)     |
 * | `input-buttons`| `app-input-buttons`               | `state` (html:825)            |
 * | `number`       | `app-input type="number"`         | `profit_margin` (html:222)    |
 * | `currency`     | `app-input [currency]="true"`     | `base_price` (html:237)       |
 * | `text`         | `app-input`                       | (sin uso en este contrato)    |
 * | `textarea`     | `app-textarea`                    | `service_instructions` (1588) |
 * | `dimensions`   | 3 × `app-input type="number"`     | `dimensions` (html:1371-1404) |
 *
 * `dimensions` es el único control compuesto: `@IsObject()` en el DTO
 * (`bulk-edit-products.dto.ts:166-172`), tres inputs numéricos en la UI.
 */
export type BulkEditControlType =
  | 'toggle'
  | 'selector'
  | 'input-buttons'
  | 'number'
  | 'currency'
  | 'text'
  | 'textarea'
  | 'dimensions';

/**
 * Bloque de UI al que pertenece un campo. Cada clave replica una sección real
 * del formulario individual — ver `BULK_EDIT_FIELD_GROUPS` en
 * `bulk-editable-fields.constant.ts` para la cita `html:línea` de cada una.
 */
export type BulkEditGroupKey =
  | 'type'
  | 'pricing'
  | 'price_tiers'
  | 'availability'
  | 'restaurant'
  | 'uom'
  | 'physical'
  | 'service'
  | 'consultation'
  | 'operations';

/** Opción de un control enumerado. Estructuralmente compatible con `SelectorOption`. */
export interface BulkEditFieldOption {
  value: string | number;
  label: string;
  description?: string;
  icon?: string;
}

/**
 * Origen de las opciones de un `selector` cuyo catálogo NO es estático y por
 * tanto no puede vivir en una constante. El registro declara la REFERENCIA; la
 * vista resuelve cada una contra su propia fuente de datos:
 *
 * - `uom-purchase` / `uom-stock` → `UomService.getCatalog()`, mismo par de
 *   selectores que el form individual (html:943 y html:984).
 * - `document-templates` → catálogo de plantillas de consulta/preconsulta
 *   (`templateSelectorOptions` del form individual, html:1530 y html:1562).
 */
export type BulkEditOptionsRef =
  | 'uom-purchase'
  | 'uom-stock'
  | 'document-templates';

/**
 * Capacidad de tienda requerida por un campo, resuelta con el helper
 * single-source correspondiente de
 * `shared/constants/industry-modules.constant.ts` en vez de comparando contra
 * un nombre de industria a mano.
 *
 * - `ingredients` → `industriesSupportIngredients()`
 *   (`INDUSTRIES_SUPPORTING_INGREDIENTS`, hoy `['restaurant']`). Es el mismo
 *   resolver que el formulario individual consume vía
 *   `authFacade.storeSupportsIngredients` y que gatea el bloque UoM
 *   (`product-create-page.component.html:921`).
 */
export type BulkEditFieldCapability = 'ingredients';

/** Metadatos declarativos de un campo editable en masa. */
export interface BulkEditableField {
  /** Clave del contrato. Es la que viaja en `changes`. */
  key: BulkEditableFieldKey;
  /** Etiqueta en español, copiada literal del formulario individual. */
  label: string;
  /** Texto de apoyo (description/tooltip del formulario individual). */
  description?: string;
  /** Bloque de UI al que pertenece. */
  group: BulkEditGroupKey;
  /** Control con el que se pinta. */
  control: BulkEditControlType;
  /**
   * `product_type` objetivos a los que aplica el campo. Si el tipo elegido en
   * el wizard no está en la lista, el campo no se ofrece.
   */
  productTypes: readonly BulkEditProductTypeValue[];
  /**
   * Industria requerida para que el campo exista. `undefined` = disponible en
   * cualquier industria. Cuando está presente se cruza con las industrias
   * efectivas de la tienda (semántica OR: basta que UNA la tenga).
   */
  requiresIndustry?: string;
  /**
   * Capacidad de tienda requerida. Se resuelve con el helper single-source
   * correspondiente y NO con una comparación literal contra una industria, así
   * que hereda automáticamente cualquier industria que adquiera la capacidad.
   */
  requiresCapability?: BulkEditFieldCapability;
  /** Opciones estáticas cuando el control es enumerado. */
  options?: readonly BulkEditFieldOption[];
  /** Referencia a un catálogo dinámico cuando el control es enumerado. */
  optionsRef?: BulkEditOptionsRef;
  /** Sufijo del input (`%`, `min`, `kg`…). */
  suffix?: string;
  /** Mínimo aceptado por el DTO. Espejo del `@Min(...)` del backend. */
  min?: number;
  /** Máximo aceptado por el DTO. Espejo del `@Max(...)` del backend. */
  max?: number;
  /**
   * Campo del que depende para tener sentido, igual que el formulario individual
   * anida secciones tras un flag (`sale_price` tras `is_on_sale`, la caja de
   * consulta tras `requires_booking`/`is_consultation`). Es una pista de UI
   * progresiva: el backend no la valida, así que NO es una restricción dura.
   */
  dependsOn?: BulkEditableFieldKey;
}

/** Cabecera de un bloque de UI. */
export interface BulkEditFieldGroup {
  key: BulkEditGroupKey;
  /** Título del bloque, copiado literal del formulario individual. */
  label: string;
  /** Icono Lucide ya registrado en `shared/components/icon/icons.registry.ts`. */
  icon: string;
  /** Nota corta para el usuario cuando el bloque necesita contexto. */
  hint?: string;
}

/** Grupo ya resuelto para el tipo objetivo + industrias activas. */
export interface BulkEditVisibleGroup extends BulkEditFieldGroup {
  fields: readonly BulkEditableField[];
}

/**
 * Contexto de resolución del catálogo. Todo lo que el registro necesita saber
 * para decidir qué se ve; sin dependencias de Angular, para que el registro siga
 * siendo un módulo puro y testeable.
 */
export interface BulkEditFieldContext {
  /** Tipo objetivo elegido en el wizard (el que conduce todo el catálogo). */
  targetType: BulkEditProductTypeValue;
  /**
   * Industrias EFECTIVAS de la tienda. Resolver con
   * `resolveEffectiveStoreIndustries()` para no reimplementar la cascada.
   */
  industries: readonly string[];
  /**
   * Tipos que YA tienen los productos seleccionados. Escape hatch del
   * formulario individual (`product-create-page.component.ts:843-859`): un
   * producto que ya es `service` o `prepared` sigue siendo editable aunque la
   * industria que habilitaba ese tipo se haya desactivado.
   */
  currentTypes?: readonly BulkEditProductTypeValue[];
}
