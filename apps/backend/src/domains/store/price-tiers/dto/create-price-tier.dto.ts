import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO to create a store-scoped price tier (multi-tarifa).
 *
 * - `discount_percentage` is the percent (0-100) applied over base_price when
 *   the product does not have an explicit `product_price_tier_overrides` row.
 * - `units_per_package` is the packaging quantity owned by the tier (e.g. 6
 *   for "Caja x6"). Optional; minimum 2 when present. The service derives
 *   `is_package_unit = (units_per_package ?? 0) >= 2` so the flag stays
 *   consistent. A product can override this quantity per tier via
 *   `product_price_tier_overrides.override_units_per_package`.
 */
export class CreatePriceTierDto {
  @ApiProperty({
    description:
      'Nombre con el que la persona ve la tarifa: "Bulto x50", "Rollo 20 m", "Mayorista".',
  })
  @IsString()
  @MaxLength(255)
  name!: string;

  /**
   * Eje al que pertenece la tarifa: `customer_tier` (a quién le vendo) o
   * `sale_unit` (en qué presentación vendo). Por defecto `customer_tier`, que
   * es lo que la tabla significaba antes de existir este campo.
   */
  @ApiProperty({
    required: false,
    description:
      'Eje de la tarifa. `sale_unit` = EN QUÉ PRESENTACIÓN se vende (bulto, caja, rollo): ' +
      'es la que se habilita por producto y la que elige el vendedor línea por línea. ' +
      '`customer_tier` = A QUIÉN se le vende (mayorista, distribuidor), un nivel de precio ' +
      'por tipo de cliente. Por defecto `customer_tier`.',
  })
  @IsOptional()
  @IsIn(['customer_tier', 'sale_unit'])
  kind?: 'customer_tier' | 'sale_unit';

  @ApiProperty({
    required: false,
    description: 'Código corto interno de la tarifa. Opcional.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiProperty({
    required: false,
    description: 'Explicación de para qué sirve esta tarifa.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    required: false,
    description:
      'Descuento en porcentaje (0-100) sobre el precio base del producto. Es la REGLA ' +
      'GENERAL de la tarifa y solo aplica a los productos que no tengan un precio propio ' +
      'definido para ella. Si el producto tiene precio propio, ese gana.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discount_percentage?: number;

  @ApiProperty({
    required: false,
    description: 'Si está activa. Una tarifa inactiva no se puede usar para vender.',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Marca la tarifa como la preseleccionada de la tienda. OJO: la presentación que rige ' +
      'para un PRODUCTO concreto no se marca aquí, sino en el override de ese producto.',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_default?: boolean;

  @ApiProperty({
    required: false,
    description:
      'No hace falta mandarlo: el servidor lo deriva de units_per_package (verdadero cuando ' +
      'es 2 o más), para que la bandera y la cantidad nunca se contradigan.',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_package_unit?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Cuántas unidades de inventario trae un paquete de esta presentación: 50 para ' +
      '"Bulto x50", 20 para "Rollo 20 m". Vender 2 paquetes descuenta 100 unidades de stock, ' +
      'no 2. Un producto puede tener su propio empaque en esta tarifa con ' +
      'override_units_per_package.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  units_per_package?: number;

  @ApiProperty({
    required: false,
    description: 'Orden en que aparece la tarifa en las listas. Menor primero.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;
}
