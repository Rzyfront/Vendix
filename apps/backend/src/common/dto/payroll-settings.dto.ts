import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsInt,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Payroll parafiscales toggles persisted under
 * `{store_settings|organization_settings}.settings.payroll.minimal`.
 *
 * These flags drive the wizard PayrollConfigStep — they answer the
 * question "which obligatory contributions does this tenant pay?" and
 * are used downstream by the payroll engine to decide which lines to
 * generate. They DO NOT replace the per-year rate matrix owned by
 * PayrollRulesService (which lives under `payroll.rules[year]`).
 */
export class PayrollParafiscalesDto {
  @IsBoolean()
  sena: boolean;

  @IsBoolean()
  icbf: boolean;

  @IsBoolean()
  caja_compensacion: boolean;

  @IsBoolean()
  eps: boolean;

  @IsBoolean()
  arl: boolean;

  @IsBoolean()
  pension: boolean;
}

/**
 * Minimal payroll configuration captured before a tenant can run
 * payroll. Wider per-year rules live under `payroll.rules[YYYY]`.
 */
export class UpdatePayrollSettingsDto {
  @IsIn(['MENSUAL', 'QUINCENAL', 'SEMANAL'])
  payment_frequency: string;

  @IsBoolean()
  withholding_enabled: boolean;

  @ValidateNested()
  @Type(() => PayrollParafiscalesDto)
  parafiscales: PayrollParafiscalesDto;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  pila_operator?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_id?: number;
}

/**
 * Shape returned by GET payroll/settings — same as the update DTO plus
 * a flag indicating whether the values are persisted or defaults.
 */
export interface PayrollMinimalSettings {
  payment_frequency: 'MENSUAL' | 'QUINCENAL' | 'SEMANAL';
  withholding_enabled: boolean;
  parafiscales: {
    sena: boolean;
    icbf: boolean;
    caja_compensacion: boolean;
    eps: boolean;
    arl: boolean;
    pension: boolean;
  };
  pila_operator?: string;
}

export interface PayrollMinimalSettingsResponse extends PayrollMinimalSettings {
  is_default: boolean;
}
