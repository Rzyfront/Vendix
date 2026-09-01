import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsOptional,
  IsDateString,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsBoolean,
  MaxLength,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { IsIn } from 'class-validator';
import { Type, Transform, TransformFnParams } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  purchase_order_status_enum,
  purchase_order_type_enum,
  tax_type_enum,
} from '@prisma/client';

/** Allowed fiscal tax classifications for a purchase line (F1 IVA lifecycle). */
const TAX_TYPE_VALUES = Object.values(tax_type_enum) as string[];

/**
 * Cota de tamaño de los arreglos de línea. El mismo límite que el resto de las
 * operaciones masivas del repo (`BatchCreateAdjustmentsDto`): sin tope, una
 * orden de 5.000 líneas abre 5.000 escrituras dentro de una sola transacción y
 * deja el pool de Prisma en el suelo.
 */
export const PURCHASE_ORDER_ITEMS_MAX = 100;

/**
 * Modos de imputación del flete de la factura de compra.
 *
 * - `prorate`: el flete se reparte entre las líneas y se CAPITALIZA al costo.
 * - `expense`: el flete no toca el costo del inventario; va a gasto.
 *
 * Vive acá y no en el DTO de la vista previa porque los dos contratos deben
 * ofrecer exactamente el mismo juego de valores: si divergen, el operador
 * aprueba una simulación que la orden no puede reproducir.
 */
export const SHIPPING_COST_ALLOCATIONS = ['prorate', 'expense'] as const;
export type ShippingCostAllocation = (typeof SHIPPING_COST_ALLOCATIONS)[number];

/**
 * Devuelve el valor CRUDO del payload, no el que ya tocó el pipe.
 *
 * El `ValidationPipe` global corre con `enableImplicitConversion: true`
 * (`main.ts`), y class-transformer aplica esa conversión ANTES de los
 * `@Transform` del DTO. Para una propiedad declarada `boolean` eso significa
 * `Boolean('false') === true`: el string llega ya invertido y ningún
 * `@Transform` que mire `value` puede recuperarlo. Para una declarada `number`,
 * `Number('') === 0`: un campo vacío se vuelve un cero silencioso en vez de
 * quedar ausente. `obj[key]` conserva el valor tal como vino en el cuerpo de la
 * petición, que es el único desde el que se puede decidir bien.
 */
const rawInput = ({ value, obj, key }: TransformFnParams): unknown =>
  obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)
    ? (obj as Record<string, unknown>)[key]
    : value;

/**
 * Coerción numérica para campos monetarios OPCIONALES (patrón
 * `toOptionalNumber` de `create-dispatch-note.dto.ts`, endurecido con la
 * lectura del crudo).
 *
 * Nunca devuelve `NaN`: un valor no vacío que no parsea se devuelve intacto
 * para que `@IsNumber` lo rechace con un mensaje legible en vez del opaco
 * "must be a number" que produce un `NaN` silencioso. Un valor ausente o vacío
 * se devuelve como `undefined` para que `@IsOptional()` haga su trabajo y el
 * campo NO se persista como 0.
 */
export const toOptionalNumber = (params: TransformFnParams): unknown => {
  const raw = rawInput(params);
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw === 'number') return Number.isNaN(raw) ? params.value : raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw.trim());
    return Number.isNaN(parsed) ? raw : parsed;
  }
  return raw;
};

/**
 * Coerción booleana para banderas OPCIONALES.
 *
 * Devolver `undefined` cuando el campo no viene es OBLIGATORIO y no un detalle:
 * `deriveLineTax` resuelve el modo de la línea con
 * `item.prices_include_tax ?? header.prices_include_tax ?? false`. Un
 * `@Transform` que convierta la ausencia en `false` le pone a TODAS las líneas
 * un override explícito y el modo de cabecera deja de aplicarse.
 */
export const toOptionalBoolean = (params: TransformFnParams): unknown => {
  const raw = rawInput(params);
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === 'false' || raw === 0 || raw === '0') return false;
  // Cualquier otra cosa se entrega intacta para que `@IsBoolean` la rechace.
  return raw;
};

export class PurchaseOrderItemDto {
  @ApiProperty({ description: 'Product ID' })
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @ApiProperty({ description: 'Product variant ID (optional)' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  product_variant_id?: number;

  // Entero a propósito: `purchase_order_items.quantity_ordered` es `Int` en
  // Prisma. La VISTA PREVIA sí admite fracción (ver `CostPreviewItemDto`)
  // porque simula el efecto de la cantidad ANTES de convertirla a unidades de
  // stock; la creación exige el entero que la columna puede guardar.
  @ApiProperty({ description: 'Quantity ordered' })
  @IsInt()
  @Min(1)
  quantity: number;

  /**
   * CP-PURCHASE-TRANSPARENCY R2 — piso 0, no 0.01.
   *
   * Este precio multiplica la cantidad y funda `subtotal_amount` y
   * `total_amount` de la orden, la capa de costo FIFO/CPP de la recepción y el
   * saldo de la CxP. Un negativo invierte el signo de todos ellos: el total de
   * la orden baja, el costo unitario del inventario se corrompe y la deuda con
   * el proveedor se convierte en un cobro. Lo rechazaba nadie.
   *
   * El piso es `0` y no `0.01` a propósito: una línea de BONIFICACIÓN
   * (mercancía que el proveedor regala) entra con precio 0 y es un caso de
   * negocio real en distribución.
   */
  @ApiProperty({ description: 'Unit price' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  unit_price: number;

  /**
   * Fase 2: UoM FKs consumed by the receiving engine to derive the
   * `purchase_to_stock_factor`. Required when the parent PO has
   * `order_type='ingredient'`; optional otherwise (retail = factor 1).
   */
  @ApiProperty({
    description:
      'Fase 2: Purchase UoM FK for ingredient orders. Required when order_type=ingredient.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  purchase_uom_id?: number;

  @ApiProperty({
    description:
      'Fase 2: Stock UoM FK for ingredient orders. Required when order_type=ingredient.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  stock_uom_id?: number;

  /**
   * "Contenido por envase" — manual cross-dimension conversion factor. When
   * the purchase unit is a discrete package (dimension `count`, e.g. una
   * bolsita) and the stock unit is a continuous magnitude (`mass`/`volume`,
   * e.g. g/ml), the factor CANNOT be derived from the catalog `factor_to_base`
   * (different dimensions). The operator supplies it manually here: how many
   * stock units each purchase unit contains (e.g. 250 g por bolsita). In that
   * cross-dimension case this value IS the factor and the backend skips the
   * same-dimension validation. Ignored (catalog derivation used instead) for
   * same-dimension conversions.
   */
  @ApiProperty({
    description:
      'Contenido por envase: manual purchase→stock factor for cross-dimension (count → mass/volume) ingredient lines.',
    required: false,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  purchase_to_stock_factor?: number;

  /**
   * Ingredient flags. Apply ONLY to NEW products created from this order line
   * (when the item has no `product_id`). Existing products keep their own
   * flags untouched. Effective only if the store's industries support the
   * `is_ingredient` capacity; otherwise the backend forces them off.
   */
  @ApiProperty({
    description:
      'Mark NEW product as an ingredient (insumo). Applies only to products created from this order line.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  is_ingredient?: boolean;

  @ApiProperty({
    description:
      'Mark NEW product as sellable. Applies only to products created from this order line. Forced to false for pure ingredients.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  is_sellable?: boolean;

  /**
   * QUI-661 — commercial discount granted by the supplier on THIS line.
   *
   * The user may type either the percentage or the money amount and the UI
   * derives the other. When both arrive, `discount_amount` wins: it is the
   * figure that gets persisted, that lowers the taxable base, and that the
   * costing engine capitalizes. The percentage travels only as provenance.
   */
  @ApiProperty({ description: 'Line discount percentage (optional)' })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  discount_percentage?: number;


  @ApiProperty({
    description:
      'QUI-661: line discount as a money amount. Wins over discount_percentage.',
    required: false,
  })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount_amount?: number;

  @ApiProperty({ description: 'Tax rate (optional)' })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  tax_rate?: number;

  /**
   * F1 IVA lifecycle — fiscal classification of the line tax. Defaults to
   * `iva` when omitted (see PurchaseOrdersService.deriveLineTax). Validated
   * against `tax_type_enum`.
   */
  @ApiProperty({
    description: 'F1: line tax type (iva | inc | ica | ...). Defaults to iva.',
    enum: tax_type_enum,
    required: false,
  })
  @IsIn(TAX_TYPE_VALUES)
  @IsOptional()
  tax_type?: string;

  /**
   * F1 IVA lifecycle — per-line override of the header `prices_include_tax`.
   * When present it INVERTS the header mode for this line only (mixed
   * invoices). When absent the line inherits the header value.
   */
  @ApiProperty({
    description:
      'F1: per-line override of header prices_include_tax (mixed invoices).',
    required: false,
  })
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

  @ApiProperty({ description: 'Expected delivery date (optional)' })
  @IsDateString()
  @IsOptional()
  expected_delivery_date?: string;

  @ApiProperty({ description: 'Notes for this item (optional)' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Batch number for lot tracking (optional)' })
  @IsString()
  @IsOptional()
  batch_number?: string;

  @ApiProperty({
    description: 'Manufacturing date for lot tracking (optional)',
  })
  @IsDateString()
  @IsOptional()
  manufacturing_date?: string;

  @ApiProperty({ description: 'Expiration date for lot tracking (optional)' })
  @IsDateString()
  @IsOptional()
  expiration_date?: string;

  // New fields for ad-hoc/new products
  @ApiProperty({ description: 'Product Name (for new products)' })
  @IsString()
  @IsOptional()
  product_name?: string;

  @ApiProperty({ description: 'Product SKU/Code (for new products)' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ description: 'Product Barcode (for new products)' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  barcode?: string;

  @ApiProperty({ description: 'Product Description (for new products)' })
  @IsString()
  @IsOptional()
  product_description?: string;

  @ApiProperty({ description: 'Product type (for new products)' })
  @IsString()
  @IsOptional()
  product_type?: string;

  @ApiProperty({ description: 'Track inventory flag (for new products)' })
  @IsOptional()
  track_inventory?: any;

  @ApiProperty({ description: 'Pricing type (for new products)' })
  @IsString()
  @IsOptional()
  pricing_type?: string;

  @ApiProperty({ description: 'Tax category IDs (for new products)' })
  @IsArray()
  @IsOptional()
  tax_category_ids?: number[];

  @ApiProperty({ description: 'Product State (for new products)' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ description: 'Product Weight (for new products)' })
  @IsNumber()
  @IsOptional()
  // Magnitud física: no existe el peso negativo.
  @Min(0)
  weight?: number;

  @ApiProperty({ description: 'Available for Ecommerce (for new products)' })
  @IsOptional()
  available_for_ecommerce?: any;

  @ApiProperty({ description: 'Featured flag (for new products)' })
  @IsOptional()
  is_featured?: any;

  @ApiProperty({ description: 'Allow POS price override (for new products)' })
  @IsOptional()
  allow_pos_price_override?: any;

  @ApiProperty({ description: 'Use price tiers flag (for new products)' })
  @IsOptional()
  has_multiple_price_tiers?: any;

  // ===== Unidad de venta (QUI-648) ================================================
  // Configurar la presentación en la que se venderá el producto, sin salir del
  // flujo de compra: compro bultos de 50 kg y acá defino que se vende por bulto
  // y por kilo. Espeja el patrón del bloque de insumo (purchase_uom_id /
  // stock_uom_id / purchase_to_stock_factor), que ya configura el producto desde
  // la orden de compra.
  //
  // El servicio persiste las TRES filas de forma coordinada o ninguna:
  // `price_tiers` (kind='sale_unit'), `product_price_tier_assignments` (allowlist
  // que consulta la venta) y `product_price_tier_overrides` (factor + precio).

  @ApiProperty({
    description:
      'Nombre libre de la presentación de venta (Bulto 50 kg, Kilo, Rollo, Metro).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sale_unit_name?: string;

  @ApiProperty({
    description:
      'Unidades de stock que consume una unidad de esa presentación (50 para un bulto de 50 kg). Entero >= 2.',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  sale_unit_units_per_package?: number;

  @ApiProperty({
    description: 'Precio de la presentación completa. Gana sobre el margen.',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sale_unit_price?: number;

  @ApiProperty({
    description:
      'Margen de la presentación (markup sobre el costo del paquete). Se ignora si llega precio explícito.',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sale_unit_profit_margin?: number;

  @ApiProperty({
    description:
      'Marca la presentación como la que rige por defecto en toda superficie de venta.',
    required: false,
  })
  @IsOptional()
  sale_unit_is_default?: any;

  /**
   * CP-PURCHASE-TRANSPARENCY R2 — precio y margen del producto que NACE con
   * esta orden. Se escriben directo en `products`, así que un negativo aquí
   * publica en el catálogo un artículo que resta al cobrarlo.
   *
   * `@Min(0)` y no `@Min(0.01)` por paridad con los hermanos que ya estaban
   * acotados en este mismo DTO —`sale_unit_price` y `sale_unit_profit_margin`,
   * ambos `@Min(0)`—: un precio 0 es un obsequio declarado, no un error.
   */
  @ApiProperty({ description: 'Base Price (for new products)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  base_price?: number;

  @ApiProperty({ description: 'Profit Margin (for new products)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  profit_margin?: number;

  @ApiProperty({ description: 'Is on sale (for new products)' })
  @IsOptional()
  is_on_sale?: any;

  @ApiProperty({ description: 'Sale price (for new products)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  sale_price?: number;

  @ApiProperty({ description: 'Brand name (for new products)' })
  @IsString()
  @IsOptional()
  brand_name?: string;

  @ApiProperty({
    description: 'Category names comma separated (for new products)',
  })
  @IsString()
  @IsOptional()
  category_names?: string;
}


/**
 * QUI-647 — una cuota del calendario de pago acordado con el proveedor.
 *
 * Vive contra la ORDEN, no contra la CxP: la CxP nace con la recepción, así que
 * al crear la orden todavía no hay a qué colgarla. Se materializa en
 * `ap_payment_schedules` cuando la CxP existe.
 *
 * El monto tiene piso monetario 0.01 y máx. 2 decimales (consistente con
 * `ScheduleApPaymentDto` y layaway): una cuota de $0 no programa nada y una de
 * 3 decimales no puede persistirse en una columna Decimal(12,2).
 */
export class PurchaseOrderInstallmentDto {
  @ApiProperty({ description: 'Fecha programada de la cuota (YYYY-MM-DD)' })
  @IsDateString()
  scheduled_date: string;

  @ApiProperty({ description: 'Monto de la cuota' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

/**
 * QUI-647 — validador CROSS-FIELD del plan de pago (patrón quantity-tier).
 *
 * `payment_plan` es el campo que gobierna al resto: cada modo exige (o prohíbe)
 * campos hermanos. El total de la orden se deriva server-side, así que la
 * comparación de montos contra el total NO vive aquí sino en el service.
 *
 *   - immediate: no admite abono ni cuotas (el pago completo viaja por el flujo
 *     post-creación, no como anticipo).
 *   - partial:  requiere `down_payment_amount` > 0; puede llevar
 *     `payment_due_date` OPCIONAL que materializa el saldo con fecha (cuota
 *     planeada del saldo). Sin fecha, el saldo queda sin fecha (CxP).
 *   - deferred: requiere `payment_due_date`.
 *   - installments: requiere al menos una cuota en `payment_installments`.
 */
@ValidatorConstraint({ name: 'IsValidPaymentPlan', async: false })
export class IsValidPaymentPlanConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const object = args.object as CreatePurchaseOrderDto;
    const plan = object.payment_plan;
    const down = object.down_payment_amount;
    const dueDate = object.payment_due_date;
    const installments = object.payment_installments;

    switch (plan) {
      case 'immediate':
        return down == null && (!installments || installments.length === 0);
      case 'partial':
        // El abono es obligatorio; `payment_due_date` del saldo es opcional
        // (si viene, @IsDateString garantiza el formato; la comparación contra
        // hoy la hace el service, misma regla que deferred).
        return down != null && down > 0 && (dueDate == null || dueDate !== '');
      case 'deferred':
        return dueDate != null && dueDate !== '';
      case 'installments':
        return Array.isArray(installments) && installments.length >= 1;
      default:
        // Plan ausente o valor inválido: el formato lo gobierna @IsIn, y un
        // plan ausente es una orden legacy sin configuración de pago.
        return true;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const plan = (args.object as CreatePurchaseOrderDto).payment_plan;
    switch (plan) {
      case 'immediate':
        return 'El pago inmediato no admite abono ni cuotas programadas';
      case 'partial':
        return 'Un abono parcial requiere un monto abonado mayor que cero';
      case 'deferred':
        return 'Un pago diferido requiere una fecha de pago';
      case 'installments':
        return 'Un pago en cuotas requiere al menos una cuota programada';
      default:
        return 'El plan de pago es inválido';
    }
  }
}

export function IsValidPaymentPlan(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsValidPaymentPlan',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsValidPaymentPlanConstraint,
    });
  };
}

/**
 * Forma mínima que el validador cruzado necesita de la cabecera. Se describe
 * estructuralmente (y no con los dos DTO concretos) porque la MISMA regla rige
 * la creación y la vista previa: si el validador conociera solo a uno, el otro
 * volvería a divergir, que es justo el defecto que este contrato cierra.
 */
interface FreightAndTaxHeader {
  shipping_cost?: number;
  shipping_cost_allocation?: string;
  prices_include_tax?: boolean;
  items?: Array<{ tax_rate?: number } | null | undefined>;
}

/**
 * Validador CROSS-FIELD del flete y del modo de impuesto de la cabecera
 * (patrón `IsValidPaymentPlanConstraint`).
 *
 *   1. `shipping_cost > 0` exige `shipping_cost_allocation`: un flete sin modo
 *      de imputación no se puede costear — nadie sabe si entra al inventario o
 *      al gasto, y el número queda esperando a que alguien lo adivine.
 *   2. `shipping_cost_allocation = 'prorate'` exige `shipping_cost > 0`: el
 *      prorrateo reparte el flete entre las líneas y sin monto divide por cero.
 *   3. `prices_include_tax = true` exige que ALGUNA línea traiga `tax_rate > 0`:
 *      declarar que los precios traen impuesto incluido y no declarar ninguna
 *      tasa deja el IVA descontable en cero y el costo inflado. Se mira el
 *      conjunto de líneas, no cada una, para no romper la factura mixta con
 *      renglones exentos legítimos.
 */
/**
 * CP-PURCHASE-TRANSPARENCY C.7 — la regla vive en una función PURA y exportada,
 * no dentro del `ValidatorConstraint`, porque hay una puerta que NUNCA pasa por
 * el `ValidationPipe`: `OrgPurchaseOrdersService.create()` arma el DTO de tienda
 * campo por campo y llama al servicio directamente. Un decorador solo protege la
 * puerta HTTP de tienda; esta función la puede invocar también el servicio, que
 * es el único punto por el que pasan las DOS puertas.
 *
 * Devuelve el mensaje del primer incumplimiento, o `null` si la cabecera es
 * válida.
 */
export function validateFreightAndTaxHeader(
  header: FreightAndTaxHeader,
): string | null {
  const shipping = Number(header.shipping_cost ?? 0);
  const allocation = header.shipping_cost_allocation;
  const allocationMissing =
    allocation === null || allocation === undefined || allocation === '';

  if (shipping > 0 && allocationMissing) {
    return 'Falta indicar cómo se imputa el flete: «prorate» lo reparte entre las líneas y lo capitaliza al costo, «expense» lo lleva a gasto.';
  }
  if (allocation === 'prorate' && !(shipping > 0)) {
    return 'El prorrateo del flete exige un costo de flete mayor que cero.';
  }
  if (header.prices_include_tax === true) {
    const items = Array.isArray(header.items) ? header.items : [];
    const anyTaxed = items.some((i) => Number(i?.tax_rate ?? 0) > 0);
    if (!anyTaxed) {
      return 'La factura declara precios con impuesto incluido pero ninguna línea trae tasa de impuesto: falta el «tax_rate» de las líneas gravadas.';
    }
  }
  return null;
}

@ValidatorConstraint({ name: 'IsValidFreightAndTax', async: false })
export class IsValidFreightAndTaxConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    return (
      validateFreightAndTaxHeader(args.object as FreightAndTaxHeader) === null
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      validateFreightAndTaxHeader(args.object as FreightAndTaxHeader) ??
      'La configuración de flete e impuesto de la cabecera es inválida.'
    );
  }
}

/**
 * Se cuelga de `location_id` (obligatorio en los dos DTO) y NO de
 * `shipping_cost`: `@IsOptional()` desactiva TODOS los validadores de su
 * propiedad cuando el valor es `undefined`, que es exactamente el caso que la
 * regla 2 tiene que atrapar (`allocation='prorate'` sin flete). Colgado de un
 * campo siempre presente, el validador siempre corre.
 */
export function IsValidFreightAndTax(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsValidFreightAndTax',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsValidFreightAndTaxConstraint,
    });
  };
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: 'Organization ID' })
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  @ApiProperty({ description: 'Supplier ID' })
  @IsNumber()
  @IsNotEmpty()
  supplier_id: number;

  @ApiProperty({ description: 'Location ID where items will be received' })
  @IsNumber()
  @IsNotEmpty()
  @IsValidFreightAndTax()
  location_id: number;

  /**
   * A.10 — DECLARADO PERO IGNORADO. `create()` fija `draft` de oficio y jamás
   * lee este campo: una orden nace en borrador y la aprobación es un acto con
   * permiso propio (`approve()`), no una clave del cuerpo. Antes el spread lo
   * derramaba a Prisma y un cliente podía hacer nacer una orden `approved`
   * saltándose ese permiso.
   *
   * Sigue declarado —y no borrado— porque el POP web lo envía en CADA creación
   * (`pop-order.interface.ts:251`) y con `forbidNonWhitelisted` quitarlo ahora
   * devolvería 400 a la pantalla principal de compras. Se elimina del contrato
   * cuando el frontend deje de enviarlo (oleada 3).
   */
  @ApiProperty({
    description:
      'IGNORADO por el servidor: la orden nace siempre en `draft`. Se conserva por compatibilidad con el POP web.',
    enum: purchase_order_status_enum,
    deprecated: true,
  })
  @IsEnum(purchase_order_status_enum)
  @IsOptional()
  status?: purchase_order_status_enum = purchase_order_status_enum.draft;
  /**
   * Fase 2: primary order type. Defaults to `retail`. Set to `ingredient`
   * for purchase orders that stock insumos via the Modelo B (UoM catalog)
   * and a non-trivial `purchase_to_stock_factor`. Mixed-line orders are
   * out of scope for V1.
   */
  @ApiProperty({
    description:
      'Fase 2: primary order type (retail | ingredient). Defaults to retail for legacy orders.',
    enum: purchase_order_type_enum,
    required: false,
  })
  @IsEnum(purchase_order_type_enum)
  @IsOptional()
  order_type?: purchase_order_type_enum = purchase_order_type_enum.retail;

  /**
   * F1 IVA lifecycle — dominant tax mode for the whole invoice. When true,
   * line `unit_price` is tax-INCLUSIVE (gross); when false the tax is ADDED
   * on top. Individual lines may override via `prices_include_tax` on the item.
   */
  @ApiProperty({
    description:
      'F1: dominant invoice tax mode. true = line prices already include tax.',
    required: false,
  })
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

  @ApiProperty({ description: 'Order date' })
  @IsDateString()
  @IsOptional()
  order_date?: string;

  @ApiProperty({ description: 'Expected delivery date' })
  @IsDateString()
  @IsOptional()
  expected_date?: string;

  @ApiProperty({ description: 'Payment terms' })
  @IsString()
  @IsOptional()
  payment_terms?: string;

  @ApiProperty({ description: 'Shipping method' })
  @IsString()
  @IsOptional()
  shipping_method?: string;

  /**
   * Flete de la factura. Dos decimales OBLIGATORIOS: la columna es
   * `Decimal(12,2)` y PostgreSQL y JavaScript no redondean igual el tercero, así
   * que un valor de 3 decimales muestra una cifra en pantalla y guarda otra.
   */
  @ApiProperty({ description: 'Shipping cost' })
  @Transform(toOptionalNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  shipping_cost?: number;

  /**
   * Cómo se imputa el flete: `prorate` lo reparte entre las líneas y lo
   * capitaliza al costo; `expense` lo deja fuera del inventario. Obligatorio
   * cuando `shipping_cost > 0` (ver `IsValidFreightAndTaxConstraint`).
   */
  @ApiProperty({
    description: 'Shipping cost allocation mode (prorate | expense)',
    enum: SHIPPING_COST_ALLOCATIONS,
    required: false,
  })
  @IsIn(SHIPPING_COST_ALLOCATIONS as unknown as string[])
  @IsOptional()
  shipping_cost_allocation?: ShippingCostAllocation;

  /**
   * CP-PURCHASE-TRANSPARENCY R2 — los tres totales de cabecera que el cliente
   * puede enviar. `create()` los RECALCULA a partir de las líneas (igual que
   * ignora el `status` del cliente, ver A.10 en el spec), así que acotarlos no
   * cambia ningún camino feliz; lo que cierra es la puerta a que un cliente
   * declare una cabecera imposible y la respuesta se la dé por buena. Un total
   * negativo no es una compra: es una nota crédito, y esa tiene su propio
   * flujo (`return_order_type_enum.purchase_return`).
   */
  @ApiProperty({ description: 'Subtotal amount' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  subtotal_amount?: number;

  @ApiProperty({ description: 'Tax amount' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  tax_amount?: number;

  @ApiProperty({ description: 'Total amount' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  total_amount?: number;

  @ApiProperty({ description: 'Discount amount' })
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount_amount?: number;

  // ===== QUI-647: configuración de pago al crear la orden =====

  /**
   * Modo de pago acordado con el proveedor.
   *
   * - `immediate`: se paga completa en el acto (el `ackPay` binario de antes).
   * - `partial`: se abona `down_payment_amount` y el resto queda como saldo.
   * - `deferred`: no se paga ahora; una sola fecha en `payment_due_date`.
   * - `installments`: no se paga ahora; calendario en `payment_installments`.
   */
  @ApiProperty({
    description: 'QUI-647: immediate | partial | deferred | installments',
    required: false,
  })
  @IsIn(['immediate', 'partial', 'deferred', 'installments'])
  @IsValidPaymentPlan()
  @IsOptional()
  payment_plan?: 'immediate' | 'partial' | 'deferred' | 'installments';

  /**
   * QUI-647: monto abonado en el acto (payment_plan=partial, o abono dentro de
   * un plan de cuotas). Piso $0 y máx. 2 decimales; el tope contra el total lo
   * valida el service porque el total se deriva server-side.
   */
  @ApiProperty({
    description: 'QUI-647: monto abonado en el acto (payment_plan=partial)',
    required: false,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  down_payment_amount?: number;

  @ApiProperty({
    description:
      'QUI-647: fecha única de pago (deferred) o fecha del saldo en abono parcial (partial, opcional).',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  payment_due_date?: string;

  /**
   * Calendario de cuotas. La suma DEBE igualar el saldo de la orden; el
   * servicio lo valida y rechaza el desbalance en vez de programar un
   * calendario que nunca podría cerrar la deuda.
   */
  @ApiProperty({
    description: 'QUI-647: cuotas planeadas (payment_plan=installments)',
    required: false,
    type: [PurchaseOrderInstallmentDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderInstallmentDto)
  @IsOptional()
  payment_installments?: PurchaseOrderInstallmentDto[];

  @ApiProperty({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Internal notes (not visible to supplier)' })
  @IsString()
  @IsOptional()
  internal_notes?: string;

  @ApiProperty({ description: 'Created by user ID' })
  @IsNumber()
  @IsOptional()
  created_by_user_id?: number;

  // A.10 — `approved_by_user_id` NO vive en el contrato de creación: se
  // escribe únicamente en `approve()`, detrás del permiso de aprobación. Estaba
  // declarado acá y el servicio lo derramaba a Prisma con el resto de la
  // cabecera, así que un cliente podía nombrar al aprobador de una orden que
  // nadie aprobó. Con `forbidNonWhitelisted` el campo ahora devuelve 400.

  @ApiProperty({
    description: 'Purchase order items',
    type: [PurchaseOrderItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
