import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Matches,
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
  @IsDateString({}, { message: 'La fecha del evento debe tener formato YYYY-MM-DD' })
  departure_date: string;

  @Type(() => Number)
  @IsInt({ message: 'El cupo debe ser un número entero' })
  @Min(1, { message: 'El cupo del evento es mínimo 1' })
  @Max(9999)
  capacity: number;

  /** Precio del paquete en esta salida; reemplaza al tramo. null/ausente = usa los tramos. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio del evento debe tener máximo 2 decimales' })
  @Min(0, { message: 'El precio del evento no puede ser negativo' })
  @Max(9_999_999_999.99)
  price_override?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePlanDepartureDto {
  @IsOptional()
  @IsDateString({}, { message: 'La fecha del evento debe tener formato YYYY-MM-DD' })
  departure_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El cupo debe ser un número entero' })
  @Min(1, { message: 'El cupo del evento es mínimo 1' })
  @Max(9999)
  capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio del evento debe tener máximo 2 decimales' })
  @Min(0, { message: 'El precio del evento no puede ser negativo' })
  @Max(9_999_999_999.99)
  price_override?: number | null;

  @IsOptional()
  @IsIn(['open', 'closed', 'cancelled'], { message: 'El estado del evento no es válido' })
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

// -----------------------------------------------------------------------------
// QUI-1060 F2 · Itinerario del plan
// -----------------------------------------------------------------------------

const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

/** Campos comunes del alta y la edición de una actividad del itinerario. */
class PlanActivityFieldsDto {
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'La hora de la actividad debe tener formato HH:mm' })
  start_time?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  /** Responsable interno (prestador de la tienda). Excluye a `supplier_*`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El responsable no es válido' })
  @Min(1)
  provider_id?: number | null;

  /**
   * Tercero elegido de los proveedores registrados (activos) de la tienda. Excluye a
   * `provider_id`; el servidor copia su nombre y contacto en `supplier_*`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El proveedor no es válido' })
  @Min(1)
  supplier_id?: number | null;

  /** Tercero que presta la actividad. Excluye a `provider_id`. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  supplier_name?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  supplier_contact?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El costo debe tener máximo 2 decimales' })
  @Min(0, { message: 'El costo no puede ser negativo' })
  @Max(9_999_999_999.99)
  cost?: number | null;

  @IsOptional()
  @IsBoolean()
  creates_task?: boolean;

  @IsOptional()
  @IsBoolean()
  is_public?: boolean;
}

export class CreatePlanActivityDto extends PlanActivityFieldsDto {
  @Type(() => Number)
  @IsInt({ message: 'El día de la actividad debe ser un número entero' })
  @Min(1, { message: 'El día de la actividad es mínimo 1' })
  @Max(365)
  day_number: number;

  @Transform(trimOrNull)
  @IsString({ message: 'El título de la actividad es obligatorio' })
  @IsNotEmpty({ message: 'El título de la actividad es obligatorio' })
  @MaxLength(200)
  title: string;
}

export class UpdatePlanActivityDto extends PlanActivityFieldsDto {
  /** Cambiar de día la manda al final del nuevo día. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El día de la actividad debe ser un número entero' })
  @Min(1, { message: 'El día de la actividad es mínimo 1' })
  @Max(365)
  day_number?: number;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString({ message: 'El título de la actividad es obligatorio' })
  @IsNotEmpty({ message: 'El título de la actividad es obligatorio' })
  @MaxLength(200)
  title?: string;
}

/** Nuevo orden de las actividades de un día: exactamente las del día, en orden. */
export class ReorderPlanActivitiesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  day_number: number;

  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Type(() => Number)
  activity_ids: number[];
}
