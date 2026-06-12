import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query DTO for the read-only fiscal configuration checklist.
 *
 * `store_id` is only meaningful on the organization endpoint: organizations
 * with `fiscal_scope = STORE` must indicate which store's fiscal setup to
 * inspect (mirrors the single-entity resolution used by fiscal mutations).
 */
export class FiscalConfigChecklistQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

export class CreateFiscalRuleSetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  rule_type!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  country_code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  version?: string;

  @IsOptional()
  @IsDateString()
  effective_from?: string;

  /** Rule payload. Must be a non-empty JSON object (validated in service). */
  @IsObject()
  rules!: Record<string, unknown>;

  /** Optional fiscal entity binding (entity rules take precedence over org). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accounting_entity_id?: number;
}

export class UpdateFiscalRuleSetDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  rule_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  version?: string;

  @IsOptional()
  @IsDateString()
  effective_from?: string;

  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;
}
