import { Type } from 'class-transformer';
import {
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

