import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Meal plans a rate plan can include (free text names stay in `name`). */
export const MEAL_PLANS = [
  'room_only',
  'breakfast',
  'half_board',
  'full_board',
  'all_inclusive',
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Nightly price of a room type: base (no weekday) or a weekday override, regular or inside a season. */
export class RatePriceDto {
  @ApiProperty({ description: 'Tipo de habitación.' })
  @Type(() => Number)
  @IsInt()
  unit_type_id!: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Día de la semana (0 = domingo … 6 = sábado). Vacío = precio base de todas las noches.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Temporada (H2.2). Vacío = precio regular, fuera de temporada.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  season_id?: number | null;

  @ApiProperty({ description: 'Precio por noche antes de impuestos.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999)
  price!: number;
}

/** Rate plan with its prices per room type and weekday (H2.1). */
export class CreateRatePlanDto {
  @ApiProperty({ example: 'Con desayuno' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  code?: string;

  @ApiProperty({ required: false, enum: MEAL_PLANS, default: 'room_only' })
  @IsOptional()
  @IsIn(MEAL_PLANS)
  meal_plan?: (typeof MEAL_PLANS)[number];

  @ApiProperty({ required: false, description: 'Se preselecciona al reservar.' })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiProperty({
    type: [RatePriceDto],
    description: 'Precios del plan. Reemplazan todos los anteriores al editar.',
  })
  @IsArray()
  @ArrayMaxSize(800)
  @ValidateNested({ each: true })
  @Type(() => RatePriceDto)
  prices!: RatePriceDto[];
}

export class UpdateRatePlanDto extends PartialType(CreateRatePlanDto) {}
