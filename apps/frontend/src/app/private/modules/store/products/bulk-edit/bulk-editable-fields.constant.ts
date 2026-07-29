/**
 * Registro declarativo de la edición masiva de productos (QUI-567).
 *
 * ## Qué resuelve
 *
 * El catálogo de configuraciones editables SIGUE AL TIPO DE PRODUCTO elegido, y
 * además se filtra por las industrias activas de la tienda. Este archivo hace
 * EXPLÍCITA la matriz `product_type → grupos → campos` que hoy está implícita y
 * dispersa en el formulario individual
 * (`pages/product-create-page/product-create-page.component.{ts,html}`), y que
 * ese formulario expresa como una maraña de `@if (isService)`,
 * `@if (isRestaurant())`, `@if (!isIngredient())`, etc.
 *
 * ## Reglas de este archivo
 *
 * 1. **Contrato cerrado.** Las claves salen de `BulkEditableChanges`, espejo 1:1
 *    de `BulkEditableChangesDto`. El `ValidationPipe` global corre con
 *    `forbidNonWhitelisted: true` (`apps/backend/src/main.ts:57-65`), así que un
 *    campo de más devuelve 400. `_NoMissingBulkEditFields` /
 *    `_NoExtraBulkEditFields` (final del archivo) lo verifican EN COMPILACIÓN.
 * 2. **Etiquetas y agrupaciones copiadas del formulario individual.** Cada
 *    entrada cita la línea de `product-create-page.component.html` (o `.ts`) de
 *    donde sale su `label`, su `description` y su tipo de control. No inventar
 *    textos nuevos: el usuario debe reconocer el mismo campo en ambos sitios.
 * 3. **Módulo puro.** Sin `inject()`, sin señales, sin Angular. El estado vive
 *    en la vista (señales, `vendix-zoneless-signals`); aquí solo hay datos y
 *    funciones puras, de forma que la vista pueda envolver
 *    `getVisibleBulkEditGroups()` en un `computed()` sin efectos colaterales.
 * 4. **Industrias: una sola fuente.** No se reimplementa ninguna regla de
 *    industria. `industriesSupportIngredients()` e `INDUSTRY_METADATA` se
 *    importan de `shared/constants/industry-modules.constant.ts`, y la cascada
 *    de resolución se expone una única vez en
 *    `resolveEffectiveStoreIndustries()`.
 */

import {
  INDUSTRY_METADATA,
  industriesSupportIngredients,
  type StoreIndustry,
} from '../../../../../shared/constants/industry-modules.constant';
import {
  PricingType,
  ProductState,
  ServiceModality,
  ServicePricingType,
} from '../interfaces/product.interface';
import type {
  BulkEditFieldContext,
  BulkEditFieldGroup,
  BulkEditFieldOption,
  BulkEditGroupKey,
  BulkEditProductTypeValue,
  BulkEditVisibleGroup,
  BulkEditableField,
  BulkEditableFieldKey,
} from './bulk-edit.interface';

// ─────────────────────────────────────────────────────────────────────────────
// Cascada de industrias — reutilización, no cuarta variante
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Industrias EFECTIVAS de la tienda. Cascada IDÉNTICA a la ya establecida en el
 * repo (misma precedencia, mismo operador `||`, mismo default):
 *
 * - `core/services/menu-filter.service.ts:253-256` (capa 1 del filtro de menú)
 * - `pages/product-create-page/product-create-page.component.ts:502-511`
 * - `core/store/auth/auth.facade.ts:227-231` (variante con default `[]`, usada
 *   solo para resolver capacidades)
 *
 * Se expone aquí como función pura EXPORTADA para que la vista de edición masiva
 * no escriba una cuarta copia en línea. Los tres consumidores anteriores son
 * candidatos naturales a colapsar sobre esta función en un refactor posterior
 * (fuera del alcance de QUI-567: tocarlos requiere editar archivos de otro
 * agente).
 *
 * Precedencia:
 *   1. `store_settings.general.industries` — fuente de verdad, se actualiza al
 *      guardar en Ajustes → General (live, sin re-login).
 *   2. `user.store.industries` — snapshot de login; puede no traer el campo.
 *   3. `['retail']` — default canónico (default de la columna DB + de settings).
 */
export function resolveEffectiveStoreIndustries(
  fromSettings: readonly string[] | null | undefined,
  fromLogin: readonly string[] | null | undefined,
): readonly string[] {
  return (
    fromSettings ||
    (Array.isArray(fromLogin) ? fromLogin : null) ||
    (['retail'] as const)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Opciones estáticas — copiadas del formulario individual
// ─────────────────────────────────────────────────────────────────────────────

/** `product-create-page.component.ts:826-830` (`stateOptions`, en español). */
const STATE_OPTIONS: readonly BulkEditFieldOption[] = [
  { value: ProductState.ACTIVE, label: 'Activo' },
  { value: ProductState.INACTIVE, label: 'Inactivo' },
  { value: ProductState.ARCHIVED, label: 'Archivado' },
];

/** `product-create-page.component.ts:832-835` (`pricingTypeOptions`). */
const PRICING_TYPE_OPTIONS: readonly BulkEditFieldOption[] = [
  { value: PricingType.UNIT, label: 'Venta por unidad' },
  { value: PricingType.WEIGHT, label: 'Venta por peso (kg)' },
];

/** `product-create-page.component.ts:862-866` (`serviceModalityOptions`). */
const SERVICE_MODALITY_OPTIONS: readonly BulkEditFieldOption[] = [
  { value: ServiceModality.IN_PERSON, label: 'Presencial' },
  { value: ServiceModality.VIRTUAL, label: 'Virtual' },
  { value: ServiceModality.HYBRID, label: 'Híbrido' },
];

/** `product-create-page.component.ts:868-873` (`servicePricingTypeOptions`). */
const SERVICE_PRICING_TYPE_OPTIONS: readonly BulkEditFieldOption[] = [
  { value: ServicePricingType.PER_HOUR, label: 'Por hora' },
  { value: ServicePricingType.PER_SESSION, label: 'Por sesión' },
  { value: ServicePricingType.PACKAGE, label: 'Paquete' },
  { value: ServicePricingType.SUBSCRIPTION, label: 'Suscripción' },
];

/**
 * `product-create-page.component.html:1489-1492` (opciones en línea del
 * selector "Modo de reserva"). `BookingMode` no existe como enum en el
 * frontend, igual que en el formulario individual.
 */
const BOOKING_MODE_OPTIONS: readonly BulkEditFieldOption[] = [
  { value: 'provider_required', label: 'Requiere proveedor' },
  { value: 'free_booking', label: 'Reserva libre' },
];

/**
 * Etiqueta de cada `product_type`, copiada de `productTypeOptions()`
 * (`product-create-page.component.ts:843-859`). La visibilidad de cada opción
 * la resuelve `getBulkEditProductTypeOptions()`, no esta constante.
 */
export const BULK_EDIT_PRODUCT_TYPE_LABELS: Record<
  BulkEditProductTypeValue,
  string
> = {
  physical: 'Producto Físico',
  service: 'Servicio',
  prepared: 'Plato preparado',
};

/**
 * Atajos de legibilidad para la matriz `productTypes` de cada campo. Se usan
 * literales de string (no miembros de `ProductType`) porque el contrato que
 * viaja al backend son strings y `BulkEditProductTypeValue` es la unión de
 * literales; así no hay conversiones enum↔literal en cada entrada.
 */
const ALL_TYPES = [
  'physical',
  'service',
  'prepared',
] as const satisfies readonly BulkEditProductTypeValue[];

/** Tipos "de inventario": los que NO son servicio (`@if (!isService)`). */
const STOCKABLE_TYPES = [
  'physical',
  'prepared',
] as const satisfies readonly BulkEditProductTypeValue[];

const SERVICE_ONLY = [
  'service',
] as const satisfies readonly BulkEditProductTypeValue[];

const PREPARED_ONLY = [
  'prepared',
] as const satisfies readonly BulkEditProductTypeValue[];

// ─────────────────────────────────────────────────────────────────────────────
// Grupos de UI — una entrada por sección real del formulario individual
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orden de renderizado = orden de este array, que replica el orden vertical del
 * formulario individual. Los `icon` son claves ya registradas en
 * `shared/components/icon/icons.registry.ts` (verificado) y son las MISMAS que
 * usa cada sección del formulario individual.
 */
export const BULK_EDIT_FIELD_GROUPS: readonly BulkEditFieldGroup[] = [
  {
    // html:44-61 — sección "Tipo de Producto", icono `layers` (html:50).
    key: 'type',
    label: 'Tipo de Producto',
    icon: 'layers',
    hint: 'El tipo elegido decide qué configuraciones se pueden editar en lote.',
  },
  {
    // html:182-195 — sección "Precios y Rentabilidad", icono `dollar-sign`.
    key: 'pricing',
    label: 'Precios y Rentabilidad',
    icon: 'dollar-sign',
  },
  {
    // html:378-397 — sección "Precios Multi-Tarifa", icono `tags` (html:383).
    key: 'price_tiers',
    label: 'Precios Multi-Tarifa',
    icon: 'tags',
  },
  {
    // html:805-818 — sección "Disponibilidad y Estado", icono `check-circle`.
    key: 'availability',
    label: 'Disponibilidad y Estado',
    icon: 'check-circle',
  },
  {
    // html:855-889 — sub-bloque `@if (isRestaurant())` DENTRO de
    // "Disponibilidad y Estado". Se promueve a grupo propio porque su gating es
    // distinto (industria) y el usuario debe entender por qué aparece o no.
    key: 'restaurant',
    label: 'Suite Restaurante',
    icon: 'utensils',
    hint: 'Solo disponible en tiendas con la industria Restaurante activa.',
  },
  {
    // html:920-936 — sub-bloque "Unidad de medida del insumo", icono `package`
    // (html:925), gate `@if (isIngredient() && storeSupportsIngredients())`.
    key: 'uom',
    label: 'Unidad de medida del insumo',
    icon: 'package',
    hint: 'Aplica a productos usados como insumo de recetas.',
  },
  {
    // html:1358-1416 — sub-bloque "Dimensiones y Peso" dentro de "Información
    // General", icono `package` (html:1362), gate `@if (!isService)`.
    key: 'physical',
    label: 'Dimensiones y Peso',
    icon: 'package',
  },
  {
    // html:1420-1432 — sección "Detalles del Servicio", icono `briefcase`.
    key: 'service',
    label: 'Detalles del Servicio',
    icon: 'briefcase',
  },
  {
    // html:1497-1580 — sub-bloque de consulta médica/estética anidado tras
    // `@if (requires_booking)` → `@if (is_consultation)`. Grupo propio porque
    // es un flujo distinto (plantillas de consulta y preconsulta).
    key: 'consultation',
    label: 'Consulta médica/estética',
    icon: 'stethoscope',
  },
  {
    // html:2190-2208 — sub-bloque "Operaciones", icono `clock` (html:2193).
    key: 'operations',
    label: 'Operaciones',
    icon: 'clock',
  },
];

const GROUP_BY_KEY: Record<BulkEditGroupKey, BulkEditFieldGroup> =
  BULK_EDIT_FIELD_GROUPS.reduce(
    (acc, group) => {
      acc[group.key] = group;
      return acc;
    },
    {} as Record<BulkEditGroupKey, BulkEditFieldGroup>,
  );

// ─────────────────────────────────────────────────────────────────────────────
// Registro — 34 campos, exactamente los de `BulkEditableChangesDto`
// ─────────────────────────────────────────────────────────────────────────────

export const BULK_EDITABLE_FIELDS = [
  // ═══ type ═════════════════════════════════════════════════════════════════
  {
    // html:53-59 — `app-input-buttons` con `productTypeOptions()`.
    // Es el CONDUCTOR del catálogo: siempre visible, con opciones filtradas por
    // industria en `getBulkEditProductTypeOptions()`.
    key: 'product_type',
    label: 'Tipo de Producto',
    group: 'type',
    control: 'input-buttons',
    productTypes: ALL_TYPES,
  },

  // ═══ pricing ══════════════════════════════════════════════════════════════
  {
    // html:198-213. La etiqueta alterna a "Costo por kg" cuando
    // `pricing_type === 'weight'`; el registro fija la variante por unidad.
    key: 'cost_price',
    label: 'Precio de Costo',
    description:
      'Precio al que adquieres el producto. Se usa para calcular la rentabilidad.',
    group: 'pricing',
    control: 'currency',
    productTypes: ALL_TYPES,
    min: 0,
  },
  {
    // html:215-224.
    key: 'profit_margin',
    label: 'Margen (%)',
    description:
      'Porcentaje de ganancia deseado sobre el costo. Ajusta automáticamente el precio base.',
    group: 'pricing',
    control: 'number',
    productTypes: ALL_TYPES,
    suffix: '%',
    min: 0,
  },
  {
    // html:226-243. La etiqueta alterna a "Precio por kg (PVP)" con
    // `pricing_type === 'weight'`.
    key: 'base_price',
    label: 'Precio Base (PVP)',
    description:
      'Precio de venta antes de impuestos. Se calcula automáticamente si defines costo + margen.',
    group: 'pricing',
    control: 'currency',
    productTypes: ALL_TYPES,
    min: 0,
  },
  {
    // html:246-253. El formulario individual NO gatea este campo por tipo, así
    // que el registro tampoco lo hace.
    key: 'pricing_type',
    label: 'Tipo de Venta',
    description:
      'Define si el producto se vende por unidad o por peso (kg). Afecta cómo se interpretan los precios.',
    group: 'pricing',
    control: 'selector',
    productTypes: ALL_TYPES,
    options: PRICING_TYPE_OPTIONS,
  },
  {
    // html:336-343.
    key: 'is_on_sale',
    label: 'Activar precio de oferta',
    description: 'Se mostrará como precio promocional',
    group: 'pricing',
    control: 'toggle',
    productTypes: ALL_TYPES,
  },
  {
    // html:360-372, anidado tras `@if (is_on_sale)` en el form individual.
    key: 'sale_price',
    label: 'Precio de Oferta',
    group: 'pricing',
    control: 'currency',
    productTypes: ALL_TYPES,
    min: 0,
    dependsOn: 'is_on_sale',
  },

  // ═══ price_tiers ══════════════════════════════════════════════════════════
  {
    // html:391-396.
    key: 'has_multiple_price_tiers',
    label: 'Activar precios multi-tarifa',
    description:
      'Define precios distintos para tarifas como Mayorista, Distribuidor, VIP, etc. La tarifa por defecto usa el precio base.',
    group: 'price_tiers',
    control: 'toggle',
    productTypes: ALL_TYPES,
  },

  // ═══ availability ═════════════════════════════════════════════════════════
  {
    // html:822-830 — `app-input-buttons`. El form individual usa ahí
    // `productStateButtonOptions` (ts:3836-3840), cuyas etiquetas están en
    // INGLÉS ("Active"/"Inactive"/"Archived"); el registro usa las españolas de
    // `stateOptions` (ts:826-830), que es el mismo enum bien etiquetado.
    key: 'state',
    label: 'Estado',
    group: 'availability',
    control: 'input-buttons',
    productTypes: ALL_TYPES,
    options: STATE_OPTIONS,
  },
  {
    // html:833-838.
    key: 'available_for_ecommerce',
    label: 'Disponible en E-commerce',
    description: 'Visible en tu tienda online',
    group: 'availability',
    control: 'toggle',
    productTypes: ALL_TYPES,
  },
  {
    // html:840-845.
    key: 'is_featured',
    label: 'Producto destacado',
    description:
      'Aparece en la sección de destacados de la tienda online',
    group: 'availability',
    control: 'toggle',
    productTypes: ALL_TYPES,
  },
  {
    // html:847-852.
    key: 'allow_pos_price_override',
    label: 'Precio editable en POS',
    description:
      'Permite que usuarios autorizados vendan este producto con precio negociado',
    group: 'availability',
    control: 'toggle',
    productTypes: ALL_TYPES,
  },
  {
    // html:1032-1042. La `description` del form alterna según el valor; se toma
    // la rama "activado", que es la que describe el efecto del cambio.
    key: 'track_inventory',
    label: 'Controlar inventario',
    description: 'Se controla el stock de este producto',
    group: 'availability',
    control: 'toggle',
    productTypes: ALL_TYPES,
  },
  {
    // html:1044-1049.
    key: 'requires_serial_numbers',
    label: 'Requerir número de serie',
    description:
      'Cada unidad vendida deberá tener un número de serie único (garantía, postventa, trazabilidad).',
    group: 'availability',
    control: 'toggle',
    productTypes: ALL_TYPES,
  },

  // ═══ restaurant (requiere industria `restaurant`) ══════════════════════════
  // El form individual muestra los 4 flags bajo `@if (isRestaurant())` sin
  // gatearlos por tipo. El registro añade UNA restricción por tipo: excluye
  // `service`, porque un servicio no tiene BOM ni stock (`recipes` es 1:1 con
  // productos no-servicio, ver skill `vendix-restaurant-ops` §Domain Model).
  {
    // html:858-863.
    key: 'is_sellable',
    label: 'Vendible',
    description: 'Visible y vendible en carta, POS y ecommerce',
    group: 'restaurant',
    control: 'toggle',
    productTypes: STOCKABLE_TYPES,
    requiresIndustry: 'restaurant',
  },
  {
    // html:865-870.
    key: 'is_ingredient',
    label: 'Es insumo',
    description: 'Apto para usarse como componente de recetas (BOM)',
    group: 'restaurant',
    control: 'toggle',
    productTypes: STOCKABLE_TYPES,
    requiresIndustry: 'restaurant',
  },
  {
    // html:873-880. Restringido a `prepared`: un combo ES un
    // `product_type='prepared'` con `is_combo=true` (skill
    // `vendix-restaurant-ops` §Menu/Carta). El form lo anida además tras
    // `@if (!isIngredient())`, que es un gate por estado de flag, no por tipo.
    key: 'is_combo',
    label: 'Es combo / menú fijo',
    description: 'Plato que agrupa varios productos a precio fijo',
    group: 'restaurant',
    control: 'toggle',
    productTypes: PREPARED_ONLY,
    requiresIndustry: 'restaurant',
  },
  {
    // html:882-887.
    key: 'is_batch_produced',
    label: 'Producido en lote',
    description: 'Sub-receta que se produce y mantiene stock propio',
    group: 'restaurant',
    control: 'toggle',
    productTypes: STOCKABLE_TYPES,
    requiresIndustry: 'restaurant',
  },

  // ═══ uom (requiere la capacidad de insumo) ════════════════════════════════
  {
    // html:943-950.
    key: 'purchase_uom_id',
    label: 'Compra (presentación)',
    description: 'Como la recibes del proveedor.',
    group: 'uom',
    control: 'selector',
    productTypes: STOCKABLE_TYPES,
    requiresCapability: 'ingredients',
    optionsRef: 'uom-purchase',
    dependsOn: 'is_ingredient',
  },
  {
    // html:984-991. El factor compra→stock NO se envía: el backend lo deriva de
    // `factor_to_base` del catálogo (`bulk-edit-products.dto.ts:174-176`).
    key: 'stock_uom_id',
    label: 'Stock (unidad mínima)',
    description: 'En la que se descuenta el inventario.',
    group: 'uom',
    control: 'selector',
    productTypes: STOCKABLE_TYPES,
    requiresCapability: 'ingredients',
    optionsRef: 'uom-stock',
    dependsOn: 'is_ingredient',
  },

  // ═══ physical (`@if (!isService)`) ════════════════════════════════════════
  {
    // html:1371-1404 — `formGroupName="dimensions"` con 3 inputs numéricos
    // ("Largo (cm)", "Ancho (cm)", "Alto (cm)").
    key: 'dimensions',
    label: 'Dimensiones (cm)',
    description:
      'Largo, ancho y alto del producto empacado en centímetros. Se usa para cotizar envíos y ocupar espacio en almacén.',
    group: 'physical',
    control: 'dimensions',
    productTypes: STOCKABLE_TYPES,
    min: 0,
  },
  {
    // html:1405-1413.
    key: 'weight',
    label: 'Peso (kg)',
    description:
      'Peso del producto empacado en kilogramos. Afecta el cálculo de envío.',
    group: 'physical',
    control: 'number',
    productTypes: STOCKABLE_TYPES,
    suffix: 'kg',
    min: 0,
  },

  // ═══ service (`@if (isService)`) ══════════════════════════════════════════
  {
    // html:1439-1446. `@Min(1)` en el DTO (`bulk-edit-products.dto.ts:191`).
    key: 'service_duration_minutes',
    label: 'Duración (minutos)',
    description:
      'Duración estimada del servicio en minutos. Define la franja horaria que bloquea al proveedor.',
    group: 'service',
    control: 'number',
    productTypes: SERVICE_ONLY,
    suffix: 'min',
    min: 1,
  },
  {
    // html:1448-1456.
    key: 'service_modality',
    label: 'Modalidad',
    description: 'Dónde se presta el servicio: presencial, virtual o híbrido.',
    group: 'service',
    control: 'selector',
    productTypes: SERVICE_ONLY,
    options: SERVICE_MODALITY_OPTIONS,
  },
  {
    // html:1458-1466.
    key: 'service_pricing_type',
    label: 'Tipo de Cobro',
    description: 'Forma de cobrar: por hora, por sesión, paquete o suscripción.',
    group: 'service',
    control: 'selector',
    productTypes: SERVICE_ONLY,
    options: SERVICE_PRICING_TYPE_OPTIONS,
  },
  {
    // html:1468-1473.
    key: 'requires_booking',
    label: 'Requiere reserva previa',
    description: 'Los clientes deben agendar antes de adquirir',
    group: 'service',
    control: 'toggle',
    productTypes: SERVICE_ONLY,
  },
  {
    // html:1475-1480.
    key: 'is_recurring',
    label: 'Servicio recurrente',
    description: 'Se ofrece como suscripción o plan periódico',
    group: 'service',
    control: 'toggle',
    productTypes: SERVICE_ONLY,
  },
  {
    // html:1485-1497, anidado tras `@if (requires_booking)`.
    key: 'booking_mode',
    label: 'Modo de reserva',
    description:
      "'Requiere proveedor' asocia la cita a un profesional específico; 'Reserva libre' solo bloquea horario.",
    group: 'service',
    control: 'selector',
    productTypes: SERVICE_ONLY,
    options: BOOKING_MODE_OPTIONS,
    dependsOn: 'requires_booking',
  },
  {
    // html:1583-1589 — `app-textarea`.
    key: 'service_instructions',
    label: 'Instrucciones post-compra',
    description:
      'Instrucciones que recibirá el cliente después de comprar este servicio.',
    group: 'service',
    control: 'textarea',
    productTypes: SERVICE_ONLY,
  },

  // ═══ consultation (sub-bloque de servicio) ════════════════════════════════
  {
    // html:1499-1503.
    key: 'is_consultation',
    label: 'Es consulta médica/estética',
    description:
      'Este servicio requiere una plantilla de consulta y seguimiento del paciente',
    group: 'consultation',
    control: 'toggle',
    productTypes: SERVICE_ONLY,
    dependsOn: 'requires_booking',
  },
  {
    // html:1528-1537.
    key: 'consultation_template_id',
    label: 'Plantilla de Consulta',
    description:
      'Formulario que el profesional llenará durante la consulta',
    group: 'consultation',
    control: 'selector',
    productTypes: SERVICE_ONLY,
    optionsRef: 'document-templates',
    dependsOn: 'is_consultation',
  },
  {
    // html:1549-1553.
    key: 'send_preconsultation',
    label: 'Enviar preconsulta al cliente',
    description:
      'Al confirmar la reserva, se enviará automáticamente un formulario de preconsulta al paciente por email',
    group: 'consultation',
    control: 'toggle',
    productTypes: SERVICE_ONLY,
    dependsOn: 'is_consultation',
  },
  {
    // html:1559-1568.
    key: 'preconsultation_template_id',
    label: 'Plantilla de Preconsulta',
    description: 'Formulario que el paciente llenará antes de la cita',
    group: 'consultation',
    control: 'selector',
    productTypes: SERVICE_ONLY,
    optionsRef: 'document-templates',
    dependsOn: 'send_preconsultation',
  },

  // ═══ operations ═══════════════════════════════════════════════════════════
  {
    // html:2200-2208 (y su rama gemela html:2545-2553). `@Min(0) @Max(10080)`
    // en el DTO (`bulk-edit-products.dto.ts:221-224`).
    key: 'preparation_time_minutes',
    label: 'Tiempo de preparación (min)',
    description:
      'Minutos que tarda tu equipo en preparar este producto antes de entregarlo. Afecta la ETA del pedido.',
    group: 'operations',
    control: 'number',
    productTypes: ALL_TYPES,
    suffix: 'min',
    min: 0,
    max: 10080,
  },
] as const satisfies readonly BulkEditableField[];

// ─────────────────────────────────────────────────────────────────────────────
// Resolución: tipo objetivo + industrias → grupos y campos visibles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opciones del selector "Tipo de Producto", con el MISMO gating por industria
 * que `productTypeOptions()` del formulario individual
 * (`product-create-page.component.ts:843-859`):
 *
 * - `physical` — siempre.
 * - `service` — con la industria `service` activa, **o** si alguno de los
 *   productos seleccionados YA es `service`.
 * - `prepared` — con la industria `restaurant` activa, **o** si alguno de los
 *   productos seleccionados YA es `prepared`.
 *
 * Ese `|| current === '<tipo>'` es el escape hatch: un producto que ya es
 * `service`/`prepared` sigue siendo editable aunque su industria se haya
 * desactivado, para no perder el valor al guardar.
 */
export function getBulkEditProductTypeOptions(
  ctx: BulkEditFieldContext,
): readonly BulkEditFieldOption[] {
  const industries = ctx.industries;
  const current = ctx.currentTypes ?? [];
  const options: BulkEditFieldOption[] = [
    { value: 'physical', label: BULK_EDIT_PRODUCT_TYPE_LABELS['physical'] },
  ];

  if (industries.includes('service') || current.includes('service')) {
    options.push({
      value: 'service',
      label: BULK_EDIT_PRODUCT_TYPE_LABELS['service'],
    });
  }
  if (industries.includes('restaurant') || current.includes('prepared')) {
    options.push({
      value: 'prepared',
      label: BULK_EDIT_PRODUCT_TYPE_LABELS['prepared'],
    });
  }

  return options;
}

/**
 * `true` si la industria/capacidad requerida por el campo está satisfecha.
 *
 * - `requiresCapability: 'ingredients'` se resuelve con
 *   `industriesSupportIngredients()` (`industry-modules.constant.ts`), el
 *   resolver single-source que ya usa el formulario individual vía
 *   `authFacade.storeSupportsIngredients`. No se compara contra `'restaurant'`
 *   a mano: si mañana otra industria adquiere la capacidad, este gate la hereda.
 * - `requiresIndustry` se cruza con semántica OR: basta que UNA de las
 *   industrias de la tienda coincida (una tienda mixta ve la unión).
 * - El escape hatch se aplica a nivel de campo: si el tipo objetivo es el que
 *   ya tienen los productos seleccionados, el campo sigue disponible aunque la
 *   industria se haya desactivado. Mismo criterio que
 *   `product-create-page.component.ts:850-856`.
 */
export function isBulkEditFieldIndustryAllowed(
  field: BulkEditableField,
  ctx: BulkEditFieldContext,
): boolean {
  const isLegacyType = (ctx.currentTypes ?? []).includes(ctx.targetType);

  if (
    field.requiresCapability === 'ingredients' &&
    !industriesSupportIngredients(ctx.industries as string[]) &&
    !isLegacyType
  ) {
    return false;
  }
  if (
    field.requiresIndustry &&
    !ctx.industries.includes(field.requiresIndustry) &&
    !isLegacyType
  ) {
    return false;
  }
  return true;
}

/** `true` si el campo aplica al tipo objetivo elegido. */
export function isBulkEditFieldTypeAllowed(
  field: BulkEditableField,
  ctx: BulkEditFieldContext,
): boolean {
  return (field.productTypes as readonly string[]).includes(ctx.targetType);
}

/**
 * Campos visibles para el tipo objetivo + industrias activas, en orden de
 * declaración. Función pura: envolverla en un `computed()` en la vista.
 */
export function getVisibleBulkEditFields(
  ctx: BulkEditFieldContext,
): readonly BulkEditableField[] {
  return (BULK_EDITABLE_FIELDS as readonly BulkEditableField[]).filter(
    (field) =>
      isBulkEditFieldTypeAllowed(field, ctx) &&
      isBulkEditFieldIndustryAllowed(field, ctx),
  );
}

/**
 * Grupos visibles con sus campos, en el orden de `BULK_EDIT_FIELD_GROUPS` (que
 * replica el orden vertical del formulario individual). Un grupo que se queda
 * sin campos NO se devuelve — así una tienda `retail` no ve la cabecera "Suite
 * Restaurante" vacía.
 *
 * Efecto esperado:
 * - `retail` → sin tipo `prepared`, sin los 4 flags de restaurante, sin bloque
 *   UoM.
 * - `restaurant` → aparecen los tres.
 */
export function getVisibleBulkEditGroups(
  ctx: BulkEditFieldContext,
): readonly BulkEditVisibleGroup[] {
  const visible = getVisibleBulkEditFields(ctx);
  const byGroup = new Map<BulkEditGroupKey, BulkEditableField[]>();

  for (const field of visible) {
    const bucket = byGroup.get(field.group);
    if (bucket) {
      bucket.push(field);
    } else {
      byGroup.set(field.group, [field]);
    }
  }

  return BULK_EDIT_FIELD_GROUPS.filter((group) => byGroup.has(group.key)).map(
    (group) => ({ ...group, fields: byGroup.get(group.key) ?? [] }),
  );
}

/** Busca un campo del registro por su clave de contrato. */
export function findBulkEditableField(
  key: BulkEditableFieldKey,
): BulkEditableField | undefined {
  return (BULK_EDITABLE_FIELDS as readonly BulkEditableField[]).find(
    (field) => field.key === key,
  );
}

/** Cabecera de un grupo por su clave. */
export function getBulkEditFieldGroup(
  key: BulkEditGroupKey,
): BulkEditFieldGroup {
  return GROUP_BY_KEY[key];
}

/**
 * Etiqueta humana de la industria/capacidad que exige un campo, para el badge
 * de motivo ("Requiere: Restaurante"). Reutiliza `INDUSTRY_METADATA`
 * (`industry-modules.constant.ts`) para no duplicar nombres de industria.
 * Devuelve `null` cuando el campo no exige ninguna.
 */
export function describeBulkEditIndustryRequirement(
  field: BulkEditableField,
): string | null {
  if (field.requiresCapability === 'ingredients') {
    return INDUSTRY_METADATA['restaurant'].label;
  }
  if (!field.requiresIndustry) {
    return null;
  }
  return (
    INDUSTRY_METADATA[field.requiresIndustry as StoreIndustry]?.label ??
    field.requiresIndustry
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardas de compilación — el registro NO puede desviarse del contrato backend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Falla la compilación si `T` no es `never`. Se usa abajo para verificar que el
 * registro cubre EXACTAMENTE las 34 claves de `BulkEditableChangesDto`: un
 * campo de menos deja el wizard incompleto, y uno de más provoca un 400 del
 * `ValidationPipe` (`forbidNonWhitelisted: true`).
 */
type AssertNever<T extends never> = T;

/** Claves cubiertas por el registro, derivadas del literal `as const`. */
type CoveredBulkEditFieldKeys = (typeof BULK_EDITABLE_FIELDS)[number]['key'];

/** Debe ser `never`: no falta ninguna clave del contrato. */
export type _NoMissingBulkEditFields = AssertNever<
  Exclude<BulkEditableFieldKey, CoveredBulkEditFieldKeys>
>;

/** Debe ser `never`: no hay ninguna clave fuera del contrato. */
export type _NoExtraBulkEditFields = AssertNever<
  Exclude<CoveredBulkEditFieldKeys, BulkEditableFieldKey>
>;
