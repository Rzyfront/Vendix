import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO for upserting a product (or variant) override for a specific price tier.
 * When `variant_id` is omitted the override applies to the base product;
 * otherwise it applies to that specific variant.
 *
 * An override row may carry a price-only, a quantity-only, or both:
 * - `override_price` is the price of the WHOLE PACKAGE (wins over the tier rule).
 * - `override_units_per_package` overrides the tier packaging quantity.
 * Both are optional, so an empty override is meaningless but harmless.
 */
export class UpsertProductPriceTierOverrideDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variant_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  override_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  override_units_per_package?: number;

  /**
   * Margen de la presentación, en porcentaje. Markup sobre el costo del PAQUETE
   * (`cost_price * packSize`), igual que `profit_margin` en el producto base.
   *
   * Cost-anchor: si llega junto con `override_price`, el precio gana y este
   * valor se ignora — el servidor lo recalcula a partir del precio.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  override_profit_margin?: number;

  /**
   * Marca esta presentación como la que rige por defecto en toda superficie de
   * venta. Es por PRODUCTO + PRESENTACIÓN (no por variante): marcarla desmarca
   * la anterior del mismo producto en la misma transacción, y solo una tarifa
   * de tipo `sale_unit` puede serlo.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  is_default?: boolean;

  /**
   * Código de barras de esta presentación. Identifica el par (producto,
   * presentación): la caja y la unidad suelta nunca comparten código, y es
   * único dentro de la tienda en el mismo espacio de nombres que el del
   * producto y el de la variante. Cadena vacía = borrar el código.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;
}
