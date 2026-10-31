import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const CRM_STAGE_KINDS = ['open', 'won', 'lost'] as const;
export type CrmStageKind = (typeof CRM_STAGE_KINDS)[number];

export const CRM_OPPORTUNITY_STATUSES = ['open', 'won', 'lost'] as const;
export type CrmOpportunityStatus = (typeof CRM_OPPORTUNITY_STATUSES)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

export class CreateCrmStageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsIn(CRM_STAGE_KINDS)
  kind?: CrmStageKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  /** Defaults to the end of the pipeline. */
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}

/** No delete: a stage is deactivated (PLAN-CRM §4.6). */
export class UpdateCrmStageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(20)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CrmOpportunitiesQueryDto {
  /** Defaults to the store's default pipeline. */
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  pipeline_id?: number;

  /** `me` or a user id. */
  @IsOptional()
  @Matches(/^(me|\d+)$/, { message: 'owner must be me or a user id' })
  owner?: string;

  @IsOptional()
  @IsIn(CRM_OPPORTUNITY_STATUSES)
  status?: CrmOpportunityStatus;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  customer_id?: number;

  /** Title or customer name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateCrmOpportunityDto {
  @IsInt()
  @Min(1)
  customer_id!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999.99)
  amount?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  /** Defaults to the first open stage of the pipeline. */
  @IsOptional()
  @IsInt()
  @Min(1)
  stage_id?: number;

  /** Defaults to the store's default pipeline (or the stage's). */
  @IsOptional()
  @IsInt()
  @Min(1)
  pipeline_id?: number;

  /** Defaults to the creator. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  owner_user_id?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  quotation_id?: number;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'expected_close_date must be YYYY-MM-DD' })
  expected_close_date?: string;
}

/** `null` clears the field. Stage changes go through `/move`, `/win`, `/lose`. */
export class UpdateCrmOpportunityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999.99)
  amount?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  owner_user_id?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  quotation_id?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_ONLY, { message: 'expected_close_date must be YYYY-MM-DD' })
  expected_close_date?: string | null;

  /** Only for an already lost opportunity. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  lost_reason?: string;
}

export class MoveCrmOpportunityDto {
  @IsInt()
  @Min(1)
  stage_id!: number;

  /** Position inside the column; defaults to the end. */
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  /** Required when the target stage is a `lost` stage. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  lost_reason?: string;
}

export class LoseCrmOpportunityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  lost_reason!: string;
}
