import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Restrictions shown in the rates calendar: nights from `from` to `to` (both included). */
export class RestrictionQueryDto {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-12-31' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to!: string;
}

/**
 * Sets the restrictions of every night from `from_date` to `to_date` (H2.3)
 * for every room type (`unit_type_id` null) or one type. It replaces what
 * those nights had for that scope; all empty clears them.
 */
export class SetRestrictionsDto {
  @ApiProperty({ example: '2026-12-07', description: 'Primera noche.' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from_date!: string;

  @ApiProperty({ required: false, example: '2026-12-07', description: 'Última noche (incluida). Vacío = solo la primera.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to_date?: string;

  @ApiProperty({ required: false, nullable: true, description: 'Tipo de habitación. Vacío = todos los tipos.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  unit_type_id?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Estancia mínima para llegar esa noche.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  min_stay?: number | null;

  @ApiProperty({ required: false, nullable: true, description: 'Estancia máxima para llegar esa noche.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  max_stay?: number | null;

  @ApiProperty({ required: false, description: 'Cerrado a la llegada (CTA).' })
  @IsOptional()
  @IsBoolean()
  closed_to_arrival?: boolean;

  @ApiProperty({ required: false, description: 'Cerrado a la salida (CTD).' })
  @IsOptional()
  @IsBoolean()
  closed_to_departure?: boolean;

  @ApiProperty({ required: false, description: 'Venta detenida (stop-sell).' })
  @IsOptional()
  @IsBoolean()
  stop_sell?: boolean;
}
