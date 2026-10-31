import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  CRM_TIMELINE_TYPES,
  CrmTimelineType,
} from '../../../history/customer-history.service';

/** `store_users.crm_source` values (PLAN-CRM §2.2). */
export const CRM_CUSTOMER_SOURCES = [
  'pos',
  'ecommerce',
  'whatsapp',
  'landing',
  'import',
  'manual',
  'referral',
] as const;
export type CrmCustomerSource = (typeof CRM_CUSTOMER_SOURCES)[number];

export const CRM_CONSENT_VALUES = ['unknown', 'opted_in', 'opted_out'] as const;
export type CrmConsentValue = (typeof CRM_CONSENT_VALUES)[number];

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

export class CrmConsentsDto {
  @IsOptional()
  @IsIn(CRM_CONSENT_VALUES)
  whatsapp?: CrmConsentValue;

  @IsOptional()
  @IsIn(CRM_CONSENT_VALUES)
  sms?: CrmConsentValue;

  @IsOptional()
  @IsIn(CRM_CONSENT_VALUES)
  email?: CrmConsentValue;
}

/** `null` clears the field; an absent key leaves it unchanged. */
export class UpdateCustomerCrmProfileDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  owner_user_id?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(CRM_CUSTOMER_SOURCES)
  source?: CrmCustomerSource | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  stage_id?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => CrmConsentsDto)
  consents?: CrmConsentsDto;
}

export class CustomerCrmTimelineQueryDto {
  /** Comma-separated subset of the timeline sources. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((type) => type.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsIn(CRM_TIMELINE_TYPES, { each: true })
  types?: CrmTimelineType[];

  /** ISO instant; returns items strictly older (from `meta.next_before`). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/, {
    message: 'before must be an ISO 8601 instant',
  })
  before?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class SetCustomerTagsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tag_ids!: number[];
}

export class CreateCrmCustomerNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  is_pinned?: boolean;
}

export class UpdateCrmCustomerNoteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  is_pinned?: boolean;
}

export class CrmNotesQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateCrmTagDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(20)
  color?: string | null;
}

export class UpdateCrmTagDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(20)
  color?: string | null;
}
