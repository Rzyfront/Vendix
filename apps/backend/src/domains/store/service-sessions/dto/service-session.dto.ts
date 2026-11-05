import { payment_methods_type_enum } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
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

/** Money received for the consumable deposit of a station session (cash, transfer, card...). */
export class ServiceSessionDepositDto {
  /** Major units; the ledger works in cents. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  /** Canonical method type: cash, bank_transfer, card... The ledger books `cash` to the drawer and the rest to the bank. */
  @IsIn(Object.values(payment_methods_type_enum), { message: 'El método de pago no es válido' })
  method: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_payment_method_id?: number;

  /** Idempotency key: a replay with the same id never credits twice. */
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  request_id: string;
}

export class SettleServiceSessionDto {
  /** What happens with the deposit left after the account is covered. Defaults to `credit`. */
  @IsOptional()
  @IsIn(['refund', 'credit'])
  leftover_action?: 'refund' | 'credit';

  /** How the refund leaves (cash, bank_transfer...). Defaults to `cash`. */
  @IsOptional()
  @IsIn(Object.values(payment_methods_type_enum), { message: 'El método de pago no es válido' })
  refund_method?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_payment_method_id?: number;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  request_id: string;
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

  /** Walk-in only: duration variant of the rental product. Its duration wins over the product's. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_variant_id?: number;

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

  /** Consumable deposit received while opening (S4). */
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceSessionDepositDto)
  deposit?: ServiceSessionDepositDto;
}

export class ProviderAvailabilityQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  station_id: number;

  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: 'planned_end_at debe incluir zona horaria explícita' })
  planned_end_at?: string;
}

export class ServiceIntakeQueryDto {
  /** Opcional si se envía station_id: la plantilla de la estación no depende del servicio. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id?: number;

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

  /** Obligatoria si el producto maneja variantes (talla, presentación, viscosidad…). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_variant_id?: number;

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
