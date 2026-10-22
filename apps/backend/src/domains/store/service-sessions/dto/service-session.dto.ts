import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

export class ServiceSubjectDto {
  @IsString()
  @IsIn(['vehicle', 'person', 'other'])
  subject_type: 'vehicle' | 'person' | 'other';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Respuesta a un campo de la plantilla de Recolección de datos vinculada al servicio.
 * `field_id` es `entity_metadata_fields.id` (item.metadata_field.id de la plantilla).
 */
export class ServiceIntakeValueDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  field_id: number;

  /** string | number | boolean | null; se mapea a value_text/number/date/bool según field_type. */
  @IsOptional()
  @IsIntakeScalar()
  value: string | number | boolean | null;
}

export class OpenServiceSessionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  booking_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  station_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provider_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id?: number;

  /** Opcional para walk-in (si no se envía, calcula now + duración del servicio o 60 min); las reservas usan su asignación confirmada. */
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: 'planned_end_at debe incluir zona horaria explícita' })
  planned_end_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customer_id?: number;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contact_email?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceSubjectDto)
  subject?: ServiceSubjectDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ServiceIntakeValueDto)
  intake_values?: ServiceIntakeValueDto[];
}

export class ServiceIntakeQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  station_id?: number;
}

export class ServiceIntakePrefillQueryDto extends ServiceIntakeQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customer_id: number;
}

export class ServiceSessionTransitionDto {
  @IsIn(['pause', 'resume', 'close', 'cancel', 'no_show', 'change_provider'])
  action: 'pause' | 'resume' | 'close' | 'cancel' | 'no_show' | 'change_provider';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provider_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  public_text?: string;
}

export class ExtendServiceSessionDto {
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: 'planned_end_at debe incluir zona horaria explícita' })
  planned_end_at: string;
}

export class ListActiveServiceSessionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;
}

export class AddSessionItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  unit_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}


export class AddSessionItemsBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddSessionItemDto)
  items: AddSessionItemDto[];
}

function IsIntakeScalar(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIntakeScalar',
      target: object.constructor,
      propertyName,
      options: { message: 'value debe ser texto (máx. 2000), número, booleano o null', ...validationOptions },
      validator: {
        validate(value: unknown) {
          if (value === null || value === undefined) return true;
          if (typeof value === 'string') return value.length <= 2000;
          if (typeof value === 'number') return Number.isFinite(value);
          return typeof value === 'boolean';
        },
      },
    });
  };
}
