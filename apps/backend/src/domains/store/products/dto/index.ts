import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsUrl,
  MaxLength,
  MinLength,
  IsInt,
  IsBoolean,
  IsObject,
  IsIn,
  IsDecimal,
  IsArray,
  IsJSON,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Los 6 enums espejo del catálogo se declaran en `./product-enums` (módulo hoja).
// Se importan aquí para que las clases de este archivo los usen en `@IsEnum(...)`,
// y se re-exportan para no romper a los consumidores que ya hacen
// `import { ProductType } from '../dto'`. El módulo hoja existe porque `export *`
// de un DTO hermano se iza al inicio del módulo compilado (swc): si el hermano
// importara los enums desde este index, recibiría `undefined`.
import {
  BookingMode,
  PricingType,
  ProductState,
  ProductType,
  ServiceModality,
  ServicePricingType,
} from './product-enums';

export * from './product-enums';

/**
 * Forma sintáctica de una subcuenta PUC colombiana (`products.account_code`,
 * `product_variants.account_code`).
 *
 * Solo dígitos: el PUC del Decreto 2650/1993 es estrictamente numérico y así lo
 * siembra `colombia-puc.data.ts` — ni puntos, ni guiones, ni espacios. Aceptar
 * "4135.50" o "4135 " haría que el código NUNCA case contra
 * `chart_of_accounts.code` y el producto caería en silencio al ingreso por
 * defecto: un fallo mudo, que es peor que un 400.
 *
 * Mínimo 4 dígitos porque la jerarquía es Clase(1) → Grupo(2) → Cuenta(4) →
 * Subcuenta(6+): apuntar un producto a una Clase ('4') o a un Grupo ('41') no
 * significa nada contablemente. Máximo 20 = el ancho real de la columna
 * (`VarChar(20)`, mismo que el precedente `withholding_concepts.account_code`).
 *
 * OJO — esto valida la FORMA, no la EXISTENCIA. Que el código exista en el
 * `chart_of_accounts` de la organización, que esté activo y que acepte
 * movimientos (`accepts_entries = true`) es una validación contra la base que no
 * cabe en un DTO: vive en `AutoEntryService.validateProductAccountCodes()`.
 *
 * Esa validación SÍ está cableada (no siempre lo estuvo): la invocan
 * `ProductsService.create()` / `.update()` para el producto y todas sus
 * variantes en una sola consulta, y `ProductVariantService.createVariant()` /
 * `.updateVariant()` para el endpoint suelto de variante. Falla con
 * `PROD_ACCOUNT_CODE_NOT_FOUND_001`, `PROD_ACCOUNT_CODE_INACTIVE_001` o
 * `PROD_ACCOUNT_CODE_NOT_POSTABLE_001`.
 */
export const PUC_ACCOUNT_CODE_REGEX = /^[0-9]{4,20}$/;

export const PUC_ACCOUNT_CODE_MESSAGE =
  'La cuenta contable debe ser un código PUC numérico de 4 a 20 dígitos (por ejemplo 413550). No admite puntos, guiones ni espacios.';

// DTO para especificar stock por ubicación
export class StockByLocationDto {
  @IsInt()
  @Min(1)
  location_id: number;

  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class CreateVariantWithStockDto {
  /**
   * Subcuenta PUC de ingreso propia de la variante. Gana sobre la del producto
   * padre. Ausente ⇒ hereda del padre; si el padre tampoco la define, cae al
   * ingreso por defecto. Ver `PUC_ACCOUNT_CODE_REGEX`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PUC_ACCOUNT_CODE_REGEX, { message: PUC_ACCOUNT_CODE_MESSAGE })
  account_code?: string | null;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  id?: number;

  @IsString()
  @MaxLength(100)
  sku: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price_override?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  /**
   * Cantidad OBJETIVO de la variante. Sin inicializador a propósito.
   *
   * Este DTO también viaja dentro de `UpdateProductDto.variants`, y quien lo
   * consume trata el valor como cantidad absoluta: escribe un ajuste por la
   * diferencia contra lo que hay. Con `= 0`, class-transformer rellenaba el
   * campo cuando el cliente NO lo mandaba, así que "no toques el inventario"
   * llegaba al servicio como "déjalo en cero" y guardar un cambio de precio
   * emitía una baja de stock. `@IsOptional()` no protegía: el inicializador
   * corre antes que la validación y el campo ya no está ausente.
   *
   * Quien crea una variante aplica su propio `|| 0`, así que la ausencia sigue
   * significando cero donde cero es lo correcto.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsInt()
  image_id?: number;

  @IsOptional()
  @IsString()
  variant_image_url?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory_override?: boolean | null;
}

export class ProductImageDto {
  @IsString()
  image_url: string;

  @IsOptional()
  @IsBoolean()
  is_main?: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  alt_text?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  sort_order?: number;
}

export class CreateProductDto {
  /**
   * Subcuenta PUC de ingreso propia del producto. `null`/ausente ⇒ el asiento
   * de la venta usa el mapping por defecto (`invoice.validated.revenue`), que
   * es el comportamiento histórico. Ver `PUC_ACCOUNT_CODE_REGEX`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PUC_ACCOUNT_CODE_REGEX, { message: PUC_ACCOUNT_CODE_MESSAGE })
  account_code?: string;

  @IsOptional()
  @IsInt()
  store_id?: number;

  @IsOptional()
  @IsInt()
  brand_id?: number;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Precio de venta de UNA unidad de inventario, sin impuestos. Es el precio del que parten las tarifas: un descuento por tipo de cliente y el precio de una presentación se calculan sobre este número.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio base no puede ser negativo' })
  base_price: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Código de barras del producto suelto. El de cada presentación se fija aparte, en el override de esa tarifa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiPropertyOptional({
    description:
      'Existencias totales. Solo para la creación inicial; después el stock se mueve por entradas, ventas y ajustes, no editando este campo.',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number = 0;

  @ApiPropertyOptional({
    description:
      'Alias histórico de base_price. Si mandas los dos, manda el mismo valor; para editar el precio usa base_price.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @ApiPropertyOptional({
    description:
      'Costo unitario del producto. No se toca al vender: lo recalcula el sistema cuando entra mercancía por una orden de compra.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @ApiPropertyOptional({
    description:
      'Margen de ganancia del producto en porcentaje sobre el costo. Si mandas base_price y profit_margin a la vez, gana el precio y el margen se recalcula solo.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @ApiPropertyOptional({
    description:
      'Enciende el precio promocional (sale_price). Apagado, el producto se vende a base_price.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @ApiPropertyOptional({
    description:
      'Si aparece publicado en la tienda en línea.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @ApiPropertyOptional({
    description:
      'Si el cajero puede cambiarle el precio a mano en el Punto de Venta.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  allow_pos_price_override?: boolean;

  @ApiPropertyOptional({
    description:
      'Enciende multi-tarifa en el producto: habilita venderlo en varias presentaciones o con varios niveles de precio. Sin esto encendido, enabled_price_tier_ids no tiene efecto.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  has_multiple_price_tiers?: boolean;

  @ApiPropertyOptional({
    description:
      'Si la tienda en línea ofrece TAMBIÉN la unidad suelta del producto, además de sus presentaciones (bulto, caja, six-pack). Encendido por defecto. Apágalo cuando el producto solo se venda por presentación: la vitrina deja de mostrar el chip de la unidad y la presentación por defecto pasa a regir el precio publicado.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  offer_loose_unit?: boolean;

  @ApiPropertyOptional({
    description:
      'Si se le puede vender directamente a un cliente. Un insumo de cocina normalmente va apagado.',
  })
  // ===== Restaurant Suite toggles (Fase A additive, exposed in Fase B) =====
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_sellable?: boolean;

  @ApiPropertyOptional({
    description:
      'Si se usa como insumo en la receta de otro producto.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_ingredient?: boolean;

  @ApiPropertyOptional({
    description:
      'Si es un combo armado con otros productos.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_combo?: boolean;

  @ApiPropertyOptional({
    description:
      'Si se produce por lotes en vez de prepararse por pedido.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_batch_produced?: boolean;

  /**
   * Appointment redesign phase 2 — whether this product/service is
   * eligible for the customer's home (when
   * `bookings.service_location_type = 'home'`). When false, the ecommerce
   * booking flow forces `shop` and hides the "A domicilio" selector
   * for this product only. Default false (legacy: "En el local del
   * técnico" only). The frontend hides the toggle when
   * `service_modality !== 'in_person'` (no tiene sentido para virtual).
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_eligible_for_home_service?: boolean;

  @ApiPropertyOptional({
    description:
      'Unidad en la que se lleva el inventario y en la que está expresado base_price (gramo, mililitro, unidad).',
  })
  // ===== Control exacto de UoM (Fase UoM) =====
  // FKs al catálogo global units_of_measure. El factor de conversión
  // purchase→stock NO se confía del cliente: el backend lo deriva de
  // factor_to_base del catálogo (ver products.service.ts).
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stock_uom_id?: number;

  @ApiPropertyOptional({
    description:
      'Unidad en la que se le compra al proveedor (bulto, caja, kilo), cuando es distinta de la de inventario.',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  purchase_uom_id?: number;

  @ApiPropertyOptional({
    description:
      'Cuántas unidades de inventario entran por cada unidad comprada. Una bolsa de 1000 g que se inventaría en gramos lleva 1000: comprar 5 bolsas suma 5000 al stock.',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  purchase_to_stock_factor?: number;

  @ApiPropertyOptional({
    description:
      'Sobre cuántas unidades de inventario está expresado el precio mostrado. Sirve para productos que se cotizan por 100 g o por metro.',
  })
  /**
   * A cuántas unidades de stock corresponde `base_price` (price unit de SAP).
   * Un cable medido en milímetros guarda `base_price = 5000` y
   * `price_unit_quantity = 1000`: "$5.000 por metro". El total de una línea es
   * `unit_price * quantity / price_unit_quantity`; con el default `1` la
   * aritmética queda idéntica a la histórica.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'El precio debe cubrir al menos una unidad de stock' })
  price_unit_quantity?: number;

  @ApiPropertyOptional({
    description:
      'Manda \'convert\' para que el stock existente se recalcule al cambiar la unidad de inventario. Sin esto, cambiar la unidad deja las cantidades como estaban.',
  })
  /**
   * Autorización explícita para convertir existencias, reservas, capas de
   * costo, lotes y recetas al cambiar `stock_uom_id` en un producto que ya
   * opera. Sin este flag el cambio se rechaza: convertir en silencio
   * multiplicaría el inventario sin que nadie lo pidiera.
   */
  @IsOptional()
  @IsIn(['convert'])
  stock_uom_conversion?: 'convert';

  @ApiPropertyOptional({
    description:
      'Las tarifas habilitadas para ESTE producto, por id. Es un allowlist duro: vender con una tarifa que no esté en la lista se rechaza. La lista reemplaza a la anterior, no se suma — para agregar una presentación manda todas las que quieres dejar. El precio y el empaque de cada una se fijan aparte, en el override del producto para esa tarifa. Un producto tiene presentaciones O variantes, nunca ambas.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  enabled_price_tier_ids?: number[];

  @ApiPropertyOptional({
    description:
      'Precio promocional mientras is_on_sale esté activo. Deja base_price intacto como precio normal.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0, { message: 'El peso no puede ser negativo' })
  weight?: number;

  @IsOptional()
  @IsObject()
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };

  @ApiPropertyOptional({
    description:
      'Si el producto descuenta stock al venderse. Apagado, se puede vender sin existencias.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El stock mínimo no puede ser negativo' })
  min_stock_level?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El stock máximo no puede ser negativo' })
  max_stock_level?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El punto de reorden no puede ser negativo' })
  reorder_point?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad de reorden no puede ser negativa' })
  reorder_quantity?: number;

  @ApiPropertyOptional({
    description:
      'Si cada unidad se identifica con un serial al entrar y al salir.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_serial_numbers?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_batch_tracking?: boolean;

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState = ProductState.ACTIVE;

  @ApiPropertyOptional({
    description:
      'Cómo se mide lo que se vende: por unidad, por peso o por volumen.',
  })
  @IsOptional()
  @IsEnum(PricingType)
  pricing_type?: PricingType = PricingType.UNIT;

  @ApiPropertyOptional({
    description:
      'Qué clase de producto es: físico, servicio, digital o preparado en cocina.',
  })
  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType = ProductType.PHYSICAL;

  // Service-specific fields
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'La duración del servicio debe ser al menos 1 minuto' })
  service_duration_minutes?: number;

  @IsOptional()
  @IsEnum(ServiceModality)
  service_modality?: ServiceModality;

  @IsOptional()
  @IsEnum(ServicePricingType)
  service_pricing_type?: ServicePricingType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  @ApiPropertyOptional({
    description:
      'Minutos que tarda la cocina en prepararlo. Manda la urgencia de la ficha en la pantalla de cocina.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  @Type(() => Number)
  preparation_time_minutes?: number;

  /**
   * QUI-651 — estacion de preparacion del plato. Solo significativo para
   * `product_type = 'prepared'`.
   *
   * NULL significa "cae en el KDS por defecto de la tienda", que es lo que hace
   * funcionar el caso de una sola estacion sin configurar nada. Se acepta null
   * explicito para poder LIMPIAR la estacion en una edicion: sin eso, un plato
   * asignado a barra no podria volver a "la que sea".
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  kds_id?: number | null;

  // Consultation-specific fields
  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  consultation_template_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  preconsultation_template_id?: number;

  @ApiPropertyOptional({
    description:
      'Categorías a las que pertenece. La lista reemplaza a la anterior.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  category_ids?: number[];

  @ApiPropertyOptional({
    description:
      'Impuestos que se le aplican al venderlo. La lista reemplaza a la anterior.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tax_category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  image_urls?: string[];

  @ApiPropertyOptional({
    description:
      'Existencias iniciales repartidas por bodega o tienda.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantWithStockDto)
  variants?: CreateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}

export class UpdateProductDto {
  /**
   * Subcuenta PUC de ingreso propia del producto. Enviar `null` la limpia y
   * devuelve el producto al ingreso por defecto. Cambiarla NO reescribe
   * asientos ya posteados: esos quedaron congelados en el snapshot
   * `invoice_items.account_code`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PUC_ACCOUNT_CODE_REGEX, { message: PUC_ACCOUNT_CODE_MESSAGE })
  account_code?: string | null;

  @IsOptional()
  @IsInt()
  brand_id?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Precio de venta de UNA unidad de inventario, sin impuestos. Es el precio del que parten las tarifas: un descuento por tipo de cliente y el precio de una presentación se calculan sobre este número.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio base no puede ser negativo' })
  base_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Código de barras del producto suelto. El de cada presentación se fija aparte, en el override de esa tarifa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiPropertyOptional({
    description:
      'Existencias totales. Solo para la creación inicial; después el stock se mueve por entradas, ventas y ajustes, no editando este campo.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @ApiPropertyOptional({
    description:
      'Si el producto descuenta stock al venderse. Apagado, se puede vender sin existencias.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @ApiPropertyOptional({
    description:
      'Si cada unidad se identifica con un serial al entrar y al salir.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_serial_numbers?: boolean;

  @ApiPropertyOptional({
    description:
      'Alias histórico de base_price. Si mandas los dos, manda el mismo valor; para editar el precio usa base_price.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @ApiPropertyOptional({
    description:
      'Costo unitario del producto. No se toca al vender: lo recalcula el sistema cuando entra mercancía por una orden de compra.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @ApiPropertyOptional({
    description:
      'Margen de ganancia del producto en porcentaje sobre el costo. Si mandas base_price y profit_margin a la vez, gana el precio y el margen se recalcula solo.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @ApiPropertyOptional({
    description:
      'Enciende el precio promocional (sale_price). Apagado, el producto se vende a base_price.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @ApiPropertyOptional({
    description:
      'Si aparece publicado en la tienda en línea.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @ApiPropertyOptional({
    description:
      'Si el cajero puede cambiarle el precio a mano en el Punto de Venta.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  allow_pos_price_override?: boolean;

  @ApiPropertyOptional({
    description:
      'Enciende multi-tarifa en el producto: habilita venderlo en varias presentaciones o con varios niveles de precio. Sin esto encendido, enabled_price_tier_ids no tiene efecto.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  has_multiple_price_tiers?: boolean;

  @ApiPropertyOptional({
    description:
      'Si la tienda en línea ofrece TAMBIÉN la unidad suelta del producto, además de sus presentaciones (bulto, caja, six-pack). Encendido por defecto. Apágalo cuando el producto solo se venda por presentación: la vitrina deja de mostrar el chip de la unidad y la presentación por defecto pasa a regir el precio publicado.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  offer_loose_unit?: boolean;

  @ApiPropertyOptional({
    description:
      'Si se le puede vender directamente a un cliente. Un insumo de cocina normalmente va apagado.',
  })
  // ===== Restaurant Suite toggles (Fase A additive, exposed in Fase B) =====
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_sellable?: boolean;

  @ApiPropertyOptional({
    description:
      'Si se usa como insumo en la receta de otro producto.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_ingredient?: boolean;

  @ApiPropertyOptional({
    description:
      'Si es un combo armado con otros productos.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_combo?: boolean;

  @ApiPropertyOptional({
    description:
      'Si se produce por lotes en vez de prepararse por pedido.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_batch_produced?: boolean;

  /**
   * Appointment redesign phase 2 — whether this product/service is
   * eligible for the customer's home (when
   * `bookings.service_location_type = 'home'`). When false, the ecommerce
   * booking flow forces `shop` and hides the "A domicilio" selector
   * for this product only. Default false (legacy: "En el local del
   * técnico" only). The frontend hides the toggle when
   * `service_modality !== 'in_person'` (no tiene sentido para virtual).
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_eligible_for_home_service?: boolean;

  @ApiPropertyOptional({
    description:
      'Unidad en la que se lleva el inventario y en la que está expresado base_price (gramo, mililitro, unidad).',
  })
  // ===== Control exacto de UoM (Fase UoM) =====
  // FKs al catálogo global units_of_measure. El factor de conversión
  // purchase→stock NO se confía del cliente: el backend lo deriva de
  // factor_to_base del catálogo (ver products.service.ts).
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stock_uom_id?: number;

  @ApiPropertyOptional({
    description:
      'Unidad en la que se le compra al proveedor (bulto, caja, kilo), cuando es distinta de la de inventario.',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  purchase_uom_id?: number;

  @ApiPropertyOptional({
    description:
      'Cuántas unidades de inventario entran por cada unidad comprada. Una bolsa de 1000 g que se inventaría en gramos lleva 1000: comprar 5 bolsas suma 5000 al stock.',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  purchase_to_stock_factor?: number;

  @ApiPropertyOptional({
    description:
      'Sobre cuántas unidades de inventario está expresado el precio mostrado. Sirve para productos que se cotizan por 100 g o por metro.',
  })
  /**
   * A cuántas unidades de stock corresponde `base_price` (price unit de SAP).
   * Un cable medido en milímetros guarda `base_price = 5000` y
   * `price_unit_quantity = 1000`: "$5.000 por metro". El total de una línea es
   * `unit_price * quantity / price_unit_quantity`; con el default `1` la
   * aritmética queda idéntica a la histórica.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'El precio debe cubrir al menos una unidad de stock' })
  price_unit_quantity?: number;

  @ApiPropertyOptional({
    description:
      'Manda \'convert\' para que el stock existente se recalcule al cambiar la unidad de inventario. Sin esto, cambiar la unidad deja las cantidades como estaban.',
  })
  /**
   * Autorización explícita para convertir existencias, reservas, capas de
   * costo, lotes y recetas al cambiar `stock_uom_id` en un producto que ya
   * opera. Sin este flag el cambio se rechaza: convertir en silencio
   * multiplicaría el inventario sin que nadie lo pidiera.
   */
  @IsOptional()
  @IsIn(['convert'])
  stock_uom_conversion?: 'convert';

  @ApiPropertyOptional({
    description:
      'Las tarifas habilitadas para ESTE producto, por id. Es un allowlist duro: vender con una tarifa que no esté en la lista se rechaza. La lista reemplaza a la anterior, no se suma — para agregar una presentación manda todas las que quieres dejar. El precio y el empaque de cada una se fijan aparte, en el override del producto para esa tarifa. Un producto tiene presentaciones O variantes, nunca ambas.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  enabled_price_tier_ids?: number[];

  @ApiPropertyOptional({
    description:
      'Precio promocional mientras is_on_sale esté activo. Deja base_price intacto como precio normal.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0, { message: 'El peso no puede ser negativo' })
  weight?: number;

  @IsOptional()
  @IsObject()
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState;

  @ApiPropertyOptional({
    description:
      'Cómo se mide lo que se vende: por unidad, por peso o por volumen.',
  })
  @IsOptional()
  @IsEnum(PricingType)
  pricing_type?: PricingType;

  @ApiPropertyOptional({
    description:
      'Qué clase de producto es: físico, servicio, digital o preparado en cocina.',
  })
  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  // Service-specific fields
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'La duración del servicio debe ser al menos 1 minuto' })
  service_duration_minutes?: number;

  @IsOptional()
  @IsEnum(ServiceModality)
  service_modality?: ServiceModality;

  @IsOptional()
  @IsEnum(ServicePricingType)
  service_pricing_type?: ServicePricingType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  @ApiPropertyOptional({
    description:
      'Minutos que tarda la cocina en prepararlo. Manda la urgencia de la ficha en la pantalla de cocina.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  @Type(() => Number)
  preparation_time_minutes?: number;

  /**
   * QUI-651 — estacion de preparacion del plato. Solo significativo para
   * `product_type = 'prepared'`.
   *
   * NULL significa "cae en el KDS por defecto de la tienda", que es lo que hace
   * funcionar el caso de una sola estacion sin configurar nada. Se acepta null
   * explicito para poder LIMPIAR la estacion en una edicion: sin eso, un plato
   * asignado a barra no podria volver a "la que sea".
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  kds_id?: number | null;

  // Consultation-specific fields
  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  consultation_template_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  preconsultation_template_id?: number;

  @ApiPropertyOptional({
    description:
      'Categorías a las que pertenece. La lista reemplaza a la anterior.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  category_ids?: number[];

  @ApiPropertyOptional({
    description:
      'Impuestos que se le aplican al venderlo. La lista reemplaza a la anterior.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tax_category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  image_urls?: string[];

  @ApiPropertyOptional({
    description:
      'Existencias iniciales repartidas por bodega o tienda.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @ApiPropertyOptional({
    description:
      'Qué hacer con el stock existente cuando cambia la estructura del producto: \'first\' lo deja todo en la primera ubicación, \'distribute\' lo reparte, \'reset\' lo pone en cero.',
  })
  @IsOptional()
  @IsString()
  @IsIn(['first', 'distribute', 'reset'])
  stock_transfer_mode?: 'first' | 'distribute' | 'reset';

  @ApiPropertyOptional({
    description:
      'Qué hacer con el stock de una variante que se elimina: \'first\' pasa al producto base, \'distribute\' se reparte entre las que quedan, \'reset\' se descarta.',
  })
  @IsOptional()
  @IsString()
  @IsIn(['first', 'distribute', 'reset'])
  variant_removal_stock_mode?: 'first' | 'distribute' | 'reset';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantWithStockDto)
  variants?: CreateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}

export class ProductQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  category_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brand_id?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  include_inactive?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  pos_optimized?: boolean = false;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  include_stock?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  include_variants?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  /**
   * Restaurant Suite (Fase H) — when supplied, the listing is filtered to
   * products whose `is_sellable` flag matches this value. The POS always
   * sends `is_sellable=true` to hide pure ingredients (Phase A). Defaults
   * to undefined to keep retail catalog reads byte-identical to today
   * (existing products all have `is_sellable=true` by default anyway).
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_sellable?: boolean;

  /**
   * Restaurant Suite — filtra el listado a productos producibles por lote
   * (insumos con stock propio). El form de Producción envía `is_batch_produced=true`.
   * Por defecto undefined para no alterar las lecturas del catálogo.
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_batch_produced?: boolean;

  /**
   * Restaurant Suite — filtra el listado por la bandera `is_ingredient`
   * (insumos de receta). El CLIENTE manda el default explícito (ADR-6):
   *   - `is_ingredient=false` → solo productos (el default del listado admin)
   *   - `is_ingredient=true`  → solo insumos
   *   - ausente               → productos E insumos (tercer estado "Todos")
   *
   * ADR-6 — el `@Transform` lee `obj[key]`, NO `value`. El ValidationPipe
   * global usa `enableImplicitConversion: true` (`main.ts`), así que un
   * `@Transform(({ value }) => value === 'true')` recibe el booleano YA
   * coaccionado — `Boolean('false') === true` — y `?is_ingredient=false`
   * devolvería insumos: es exactamente el bug que este step cierra.
   * `obj[key]` conserva la cadena cruda del query param.
   *
   * No admite default server-side: lo que "todos" significa se decide en el
   * cliente (omitir el parámetro), no al silenciar un valor por defecto.
   */
  @IsOptional()
  @Transform(({ obj, key }) => {
    const raw = obj?.[key];
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    // Cualquier otra cosa se entrega intacta para que `@IsBoolean` la rechace.
    return raw;
  })
  @IsBoolean()
  is_ingredient?: boolean;

  // Hidrata una selección concreta de productos (los que el usuario marcó en el
  // stack de edición masiva), aceptando `?ids=1&ids=2` o `?ids=1,2`.
  @IsOptional()
  @Transform(({ obj }) =>
    obj?.ids === undefined || obj?.ids === null
      ? undefined
      : (Array.isArray(obj.ids) ? obj.ids : String(obj.ids).split(','))
          .map((raw: unknown) => String(raw).trim())
          .filter((raw: string) => raw !== '')
          .map((raw: string) => Number(raw)),
  )
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  ids?: number[];
}

// Product Variants DTOs
export class CreateProductVariantDto {
  /**
   * Subcuenta PUC de ingreso propia de la variante. Gana sobre la del producto
   * padre. Ver `PUC_ACCOUNT_CODE_REGEX`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PUC_ACCOUNT_CODE_REGEX, { message: PUC_ACCOUNT_CODE_MESSAGE })
  account_code?: string | null;

  @IsString()
  @MaxLength(100)
  sku: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price_override?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number = 0;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsInt()
  image_id?: number;
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory_override?: boolean | null;
  @ApiPropertyOptional({
    description: 'Override of service duration in minutes',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  service_duration_minutes?: number;

  @ApiPropertyOptional({ enum: ['per_session', 'package', 'subscription'] })
  @IsOptional()
  @IsIn(['per_session', 'package', 'subscription'])
  service_pricing_type?: 'per_session' | 'package' | 'subscription';

  @ApiPropertyOptional({
    description: 'Override of buffer minutes between bookings',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  buffer_minutes?: number;

  @ApiPropertyOptional({
    description: 'Override of preparation time before service',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  preparation_time_minutes?: number;
}

export class UpdateProductVariantDto {
  /**
   * Subcuenta PUC de ingreso propia de la variante. `null` la limpia y devuelve
   * la variante a heredar del producto padre. Ver `PUC_ACCOUNT_CODE_REGEX`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PUC_ACCOUNT_CODE_REGEX, { message: PUC_ACCOUNT_CODE_MESSAGE })
  account_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price_override?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsInt()
  image_id?: number;
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory_override?: boolean | null;
  @ApiPropertyOptional({
    description: 'Override of service duration in minutes',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  service_duration_minutes?: number;

  @ApiPropertyOptional({ enum: ['per_session', 'package', 'subscription'] })
  @IsOptional()
  @IsIn(['per_session', 'package', 'subscription'])
  service_pricing_type?: 'per_session' | 'package' | 'subscription';

  @ApiPropertyOptional({
    description: 'Override of buffer minutes between bookings',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  buffer_minutes?: number;

  @ApiPropertyOptional({
    description: 'Override of preparation time before service',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  preparation_time_minutes?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['first', 'distribute', 'reset'])
  variant_removal_stock_mode?: 'first' | 'distribute' | 'reset';
}

export class UpdateProductWithVariantsDto {
  /**
   * Subcuenta PUC de ingreso propia del producto. `null` la limpia. Ver
   * `PUC_ACCOUNT_CODE_REGEX`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PUC_ACCOUNT_CODE_REGEX, { message: PUC_ACCOUNT_CODE_MESSAGE })
  account_code?: string | null;

  @IsOptional()
  @IsInt()
  brand_id?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio base no puede ser negativo' })
  base_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0, { message: 'El peso no puede ser negativo' })
  weight?: number;

  @IsOptional()
  @IsObject()
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El stock mínimo no puede ser negativo' })
  min_stock_level?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El stock máximo no puede ser negativo' })
  max_stock_level?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El punto de reorden no puede ser negativo' })
  reorder_point?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad de reorden no puede ser negativa' })
  reorder_quantity?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_serial_numbers?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_batch_tracking?: boolean;

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState;

  @IsOptional()
  @IsEnum(PricingType)
  pricing_type?: PricingType;

  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  // Service-specific fields
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'La duración del servicio debe ser al menos 1 minuto' })
  service_duration_minutes?: number;

  @IsOptional()
  @IsEnum(ServiceModality)
  service_modality?: ServiceModality;

  @IsOptional()
  @IsEnum(ServicePricingType)
  service_pricing_type?: ServicePricingType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  // Consultation-specific fields
  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  consultation_template_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  preconsultation_template_id?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tax_category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  image_urls?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateVariantWithStockDto)
  variants_to_update?: UpdateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantWithStockDto)
  variants_to_add?: CreateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  variant_ids_to_remove?: number[];
}

export class UpdateVariantWithStockDto {
  /**
   * Subcuenta PUC de ingreso propia de la variante. `null` la limpia y vuelve a
   * heredar del producto padre. Ver `PUC_ACCOUNT_CODE_REGEX`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PUC_ACCOUNT_CODE_REGEX, { message: PUC_ACCOUNT_CODE_MESSAGE })
  account_code?: string | null;

  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price_override?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsInt()
  image_id?: number | null;

  @IsOptional()
  @IsString()
  variant_image_url?: string | null;
}

// Bulk Upload DTOs
export class BulkProductItemDto {
  @IsNotEmpty({ message: 'Product name is required' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Base price is required' })
  @IsNumber({}, { message: 'Base price must be a number' })
  @Min(0, { message: 'Base price must be positive' })
  base_price: number;

  @IsNotEmpty({ message: 'SKU is required' })
  @IsString()
  sku: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  brand_id?: number | string;

  @IsOptional()
  category_ids?: (number | string)[] | string;

  @IsOptional()
  tax_category_ids?: (number | string)[] | string;

  @IsOptional()
  @IsNumber({}, { message: 'Stock quantity must be a number' })
  @Min(0, { message: 'Stock quantity must be positive' })
  stock_quantity?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Cost price must be a number' })
  @Min(0, { message: 'Cost price must be positive' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Weight must be a number' })
  @Min(0, { message: 'Weight must be positive' })
  weight?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Profit margin must be a number' })
  @Min(0, { message: 'Profit margin must be positive' })
  profit_margin?: number;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsBoolean()
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @IsOptional()
  @IsBoolean()
  allow_pos_price_override?: boolean;

  @IsOptional()
  @IsBoolean()
  has_multiple_price_tiers?: boolean;

  @IsOptional()
  @IsBoolean()
  offer_loose_unit?: boolean;

  // ===== Restaurant Suite toggles (Fase A additive, exposed in Fase B) =====
  @IsOptional()
  @IsBoolean()
  is_sellable?: boolean;

  @IsOptional()
  @IsBoolean()
  is_ingredient?: boolean;

  @IsOptional()
  @IsBoolean()
  is_combo?: boolean;

  @IsOptional()
  @IsBoolean()
  is_batch_produced?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants?: CreateProductVariantDto[];

  @IsOptional()
  @IsString()
  warehouse_code?: string;

  @IsOptional()
  @IsString()
  warehouse_name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsString()
  product_type?: string;

  @IsOptional()
  @IsBoolean()
  track_inventory?: boolean;

  @IsOptional()
  @IsNumber()
  service_duration_minutes?: number;

  @IsOptional()
  @IsString()
  service_modality?: string;

  @IsOptional()
  @IsString()
  service_pricing_type?: string;

  @IsOptional()
  @IsBoolean()
  requires_booking?: boolean;

  @IsOptional()
  @IsString()
  booking_mode?: string;

  @IsOptional()
  @IsNumber()
  buffer_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsNumber()
  consultation_template_id?: number;

  @IsOptional()
  @IsNumber()
  preconsultation_template_id?: number;

  @IsOptional()
  @IsNumber()
  preparation_time_minutes?: number;

  @IsOptional()
  @IsNumber()
  min_stock_level?: number;

  @IsOptional()
  @IsNumber()
  max_stock_level?: number;

  @IsOptional()
  @IsNumber()
  reorder_point?: number;

  @IsOptional()
  @IsNumber()
  reorder_quantity?: number;

  @IsOptional()
  @IsBoolean()
  requires_serial_numbers?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_batch_tracking?: boolean;

  @IsOptional()
  @IsString()
  pricing_type?: string;
}

export class BulkProductUploadDto {
  @IsNotEmpty({ message: 'Products array is required' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkProductItemDto)
  products: BulkProductItemDto[];
}

export class BulkUploadItemResultDto {
  row_number?: number;
  product_name?: string;
  sku?: string;
  action?: 'create' | 'update';
  product: any;
  status: 'success' | 'error' | 'skipped';
  message: string;
  error?: string;
  error_code?: string;
}

export class BulkUploadResultDto {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: BulkUploadItemResultDto[];
}

export class BulkValidationResultDto {
  isValid: boolean;
  errors: string[];
  validProducts: BulkProductItemDto[];
}

export class BulkUploadTemplateDto {
  headers: string[];
  sample_data: any[];
  instructions: string;
}

export class GenerateProductDescriptionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  base_price?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsObject()
  extra_context?: Record<string, any>;
}

export class GenerateProductImageEnhancementDto {
  @IsString()
  @IsNotEmpty()
  image_url: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1200)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  product_name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['physical', 'service'])
  product_type?: 'physical' | 'service';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  extra_context?: Record<string, any>;
}

export * from './bulk-image-upload.dto';
export * from './bulk-image-analysis.dto';
export * from './update-product-promotions.dto';
export * from './bulk-product-analysis.dto';
export * from './bulk-edit-products.dto';
