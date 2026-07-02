import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import {
  fiscal_close_status_enum,
  fiscal_obligation_status_enum,
  fiscal_obligation_type_enum,
  fiscal_evidence_type_enum,
  tax_declaration_type_enum,
} from '@prisma/client';
import {
  FISCAL_CLOSE_TYPES,
  FiscalCloseType,
} from '../services/fiscal-period.util';

export class FiscalListQueryDto {
  @IsOptional()
  @IsEnum(fiscal_obligation_type_enum)
  type?: fiscal_obligation_type_enum;

  @IsOptional()
  @IsEnum(fiscal_obligation_status_enum)
  status?: fiscal_obligation_status_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  period_year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  period_month?: number;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accounting_entity_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}

export class FiscalFlowStateQueryDto {
  @Type(() => Number)
  @IsInt()
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class GenerateFiscalObligationsDto {
  @Type(() => Number)
  @IsInt()
  period_year!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  period_month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  period_quarter?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(fiscal_obligation_type_enum, { each: true })
  types?: fiscal_obligation_type_enum[];

  @IsOptional()
  @IsBoolean()
  force_refresh?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class ChangeFiscalObligationStatusDto {
  @IsEnum(fiscal_obligation_status_enum)
  status!: fiscal_obligation_status_enum;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  blocking_reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  evidence_id?: number;

  @IsOptional()
  payment_info?: Record<string, unknown>;
}

export class CreateTaxDeclarationDraftDto {
  @IsEnum(tax_declaration_type_enum)
  declaration_type!: tax_declaration_type_enum;

  @Type(() => Number)
  @IsInt()
  period_year!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  period_month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  period_quarter?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  obligation_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class MarkFiscalSubmittedDto {
  @IsDateString()
  submitted_at!: string;

  @IsOptional()
  @IsString()
  external_reference?: string;

  @IsOptional()
  @IsEnum(fiscal_evidence_type_enum)
  evidence_type?: fiscal_evidence_type_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  evidence_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateFiscalCloseSessionDto {
  @Type(() => Number)
  @IsInt()
  period_year!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  period_month?: number;

  /**
   * Periodicidad de cierre. Conjunto cerrado alineado a periodos DIAN reales
   * (no trimestral/semestral). Reutiliza la convención de periodicidad IVA:
   * monthly, bimonthly (bimestral), four_monthly (cuatrimestral) y annual.
   * Por defecto 'monthly' en el servicio (compatibilidad con valores previos).
   */
  @IsOptional()
  @IsIn(FISCAL_CLOSE_TYPES)
  close_type?: FiscalCloseType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class FiscalCloseQueryDto {
  @IsOptional()
  @IsEnum(fiscal_close_status_enum)
  status?: fiscal_close_status_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  period_year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class OverrideFiscalCloseCheckDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  evidence_id?: number;
}

export class ReopenFiscalCloseDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  reason!: string;
}

export class FiscalRulesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @IsOptional()
  @IsString()
  rule_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class FiscalHistoryQueryDto {
  @IsOptional()
  @IsString()
  event_type?: string;

  @IsOptional()
  @IsString()
  resource_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  resource_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  obligation_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  declaration_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  close_session_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  evidence_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accounting_entity_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class AttachFiscalEvidenceDto {
  @IsEnum(fiscal_evidence_type_enum)
  evidence_type!: fiscal_evidence_type_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;

  @IsOptional()
  @IsString()
  storage_key?: string;

  @IsOptional()
  @IsString()
  content_hash?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  source_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  source_id?: number;
}
