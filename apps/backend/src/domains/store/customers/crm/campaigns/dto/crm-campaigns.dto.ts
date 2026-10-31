import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
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
  ValidateNested,
} from 'class-validator';
import { CAMPAIGN_CHANNELS, CampaignChannel } from '../crm-campaign-audience';

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

/** WhatsApp template approved in Meta; variables may use the closed placeholders. */
export class CrmCampaignTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[a-z0-9_]+$/)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  language!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  variables?: string[];
}

/** What is sent and to whom; shared by the estimate and the campaign itself. */
export class CrmCampaignContentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  segment_id!: number;

  @IsIn(CAMPAIGN_CHANNELS)
  channel!: CampaignChannel;

  @IsOptional()
  @ValidateNested()
  @Type(() => CrmCampaignTemplateDto)
  template?: CrmCampaignTemplateDto;

  /** SMS and email text. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  /** Email only. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;
}

export class CreateCrmCampaignDto extends CrmCampaignContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;
}

export class SendCrmCampaignDto {
  /** Must equal the current estimate (USD, 4 decimals). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  confirm_estimated_cost!: number;
}

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;

export class CrmCampaignRecipientsQueryDto {
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

  @IsOptional()
  @IsIn(CAMPAIGN_RECIPIENT_STATUSES)
  status?: (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];
}

export class CrmCampaignsQueryDto {
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
