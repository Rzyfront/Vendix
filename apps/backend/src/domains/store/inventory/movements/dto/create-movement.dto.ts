import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { movement_type_enum } from '@prisma/client';

export class CreateMovementDto {
  @ApiProperty({ description: 'Product ID' })
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @ApiProperty({ description: 'Product variant ID (optional)' })
  @IsNumber()
  @IsOptional()
  product_variant_id?: number;

  /**
   * Las dos patas de ubicación son opcionales A NIVEL DE DTO porque cuál se
   * exige depende del tipo, y `class-validator` no puede expresarlo sin
   * validación cruzada. La exigencia real la aplica el servicio y devuelve
   * `INV_MOVEMENT_LOCATION_001` nombrando la pata que falta.
   *
   * `from_location_id` estaba marcado `@IsNotEmpty()`: eso hacía IMPOSIBLE
   * registrar una entrada (`stock_in`) o una devolución (`return`), porque una
   * entrada no tiene origen —el stock viene de fuera del sistema—. Todo POST de
   * entrada moría en 400 exigiendo un dato que no existe. Relajarlo es
   * aditivo: quien ya lo manda sigue pasando igual.
   *
   * Qué exige cada tipo:
   *   · `stock_in`, `return`                            → `to_location_id`
   *   · `stock_out`, `damage`, `expiration`, `adjustment` → `from_location_id`
   *   · `transfer`                                      → las dos
   */
  @ApiProperty({
    description:
      'Source location ID. Required for stock_out, damage, expiration, adjustment and transfer.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  from_location_id?: number;

  @ApiProperty({
    description:
      'Destination location ID. Required for stock_in, return and transfer.',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  to_location_id?: number;

  @ApiProperty({ description: 'Movement type', enum: movement_type_enum })
  @IsEnum(movement_type_enum)
  @IsNotEmpty()
  movement_type: movement_type_enum;

  @ApiProperty({ description: 'Quantity moved' })
  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit cost (optional)' })
  @IsNumber()
  @IsOptional()
  unit_cost?: number;

  @ApiProperty({ description: 'Reason for movement' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({ description: 'Notes (optional)' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Expiration date (optional)' })
  @IsDateString()
  @IsOptional()
  expiration_date?: string;
}
