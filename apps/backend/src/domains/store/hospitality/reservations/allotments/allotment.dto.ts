import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Rooms of a type held for an agency or company (H2.5). */
export class CreateAllotmentDto {
  @ApiProperty({ description: 'Agencia o empresa (cliente de la tienda).' })
  @Type(() => Number)
  @IsInt()
  customer_id!: number;

  @ApiProperty({ description: 'Tipo de habitación.' })
  @Type(() => Number)
  @IsInt()
  unit_type_id!: number;

  @ApiProperty({
    example: '2026-12-01',
    description: 'Primera noche del cupo.',
  })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from_date!: string;

  @ApiProperty({
    example: '2026-12-31',
    description: 'Última noche del cupo (incluida).',
  })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to_date!: string;

  @ApiProperty({
    example: 3,
    description: 'Habitaciones retenidas cada noche.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  rooms!: number;

  @ApiProperty({
    required: false,
    default: 7,
    description:
      'Días antes de cada noche en que lo no reservado vuelve al público.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  release_days?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Agency and room type are fixed: create another allotment to change them. */
export class UpdateAllotmentDto extends PartialType(
  OmitType(CreateAllotmentDto, ['customer_id', 'unit_type_id'] as const),
) {
  @ApiProperty({
    required: false,
    description: 'Desactivar libera el cupo de inmediato.',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
