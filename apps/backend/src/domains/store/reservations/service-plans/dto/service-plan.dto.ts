import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Tramo del precio del paquete según tamaño del grupo (pax totales). */
export class PlanPaxTierDto {
  @Type(() => Number)
  @IsInt({ message: 'El mínimo de personas debe ser un número entero' })
  @Min(1, { message: 'El mínimo de personas del tramo es 1' })
  @Max(999)
  min_pax: number;

  @Type(() => Number)
  @IsInt({ message: 'El máximo de personas debe ser un número entero' })
  @Min(1, { message: 'El máximo de personas del tramo es 1' })
  @Max(999)
  max_pax: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio del tramo debe tener máximo 2 decimales' })
  @Min(0, { message: 'El precio del tramo no puede ser negativo' })
  @Max(9_999_999_999.99)
  price: number;
}

/** Reemplaza todos los tramos del plan (lista vacía = sin tramos). */
export class ReplacePlanPaxPricesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PlanPaxTierDto)
  tiers: PlanPaxTierDto[];
}

export class CreatePlanDepartureDto {
  @IsDateString({}, { message: 'La fecha de salida debe tener formato YYYY-MM-DD' })
  departure_date: string;

  @Type(() => Number)
  @IsInt({ message: 'El cupo debe ser un número entero' })
  @Min(1, { message: 'El cupo de la salida es mínimo 1' })
  @Max(9999)
  capacity: number;

  /** Precio del paquete en esta salida; reemplaza al tramo. null/ausente = usa los tramos. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio de la salida debe tener máximo 2 decimales' })
  @Min(0, { message: 'El precio de la salida no puede ser negativo' })
  @Max(9_999_999_999.99)
  price_override?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePlanDepartureDto {
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de salida debe tener formato YYYY-MM-DD' })
  departure_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El cupo debe ser un número entero' })
  @Min(1, { message: 'El cupo de la salida es mínimo 1' })
  @Max(9999)
  capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio de la salida debe tener máximo 2 decimales' })
  @Min(0, { message: 'El precio de la salida no puede ser negativo' })
  @Max(9_999_999_999.99)
  price_override?: number | null;

  @IsOptional()
  @IsIn(['open', 'closed', 'cancelled'], { message: 'El estado de la salida no es válido' })
  status?: 'open' | 'closed' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class PlanQueryDto {
  /** true = incluye salidas pasadas (por defecto solo desde hoy en la zona horaria de la tienda). */
  @IsOptional()
  // Lee el valor crudo: la conversión implícita global volvería `'false'` en `true`.
  @Transform(({ obj }) => obj.include_past === true || obj.include_past === 'true')
  @IsBoolean()
  include_past?: boolean;
}
