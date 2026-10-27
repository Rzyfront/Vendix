import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Demand season with its own prices in each plan (H2.2). */
export class CreateSeasonDto {
  @ApiProperty({ example: 'Alta' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: '2026-12-15', description: 'Primera noche de la temporada.' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from_date!: string;

  @ApiProperty({ example: '2027-01-15', description: 'Última noche de la temporada (incluida).' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to_date!: string;

  @ApiProperty({
    required: false,
    default: 0,
    description: 'Si dos temporadas se solapan, gana la de mayor prioridad.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiProperty({ required: false, example: '#F59E0B', description: 'Color en el calendario de tarifas.' })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateSeasonDto extends PartialType(CreateSeasonDto) {}
