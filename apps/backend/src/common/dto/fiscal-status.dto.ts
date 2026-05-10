import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import type {
  FiscalArea,
  FiscalWizardStepId,
} from '../interfaces/fiscal-status.interface';

export class StartFiscalWizardDto {
  @IsOptional()
  @IsArray()
  @IsIn(['invoicing', 'accounting', 'payroll'], { each: true })
  selected_areas?: FiscalArea[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class AdvanceFiscalWizardStepDto {
  @IsIn([
    'area_selection',
    'legal_data',
    'dian_config',
    'puc',
    'accounting_period',
    'default_taxes',
    'accounting_mappings',
    'initial_inventory',
    'payroll_config',
    'validation',
  ])
  step: FiscalWizardStepId;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class FinalizeFiscalWizardDto {
  @IsOptional()
  @IsArray()
  @IsIn(['invoicing', 'accounting', 'payroll'], { each: true })
  selected_areas?: FiscalArea[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class FiscalStatusStoreContextDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class ApplyFiscalDetectorSignalsDto extends FiscalStatusStoreContextDto {
  @IsObject()
  signals: Record<string, unknown>;
}
