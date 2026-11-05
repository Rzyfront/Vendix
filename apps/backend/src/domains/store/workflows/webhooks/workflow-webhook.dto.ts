import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { WORKFLOW_WEBHOOK_EVENTS } from './workflow-webhook.constants';

const EVENTS = WORKFLOW_WEBHOOK_EVENTS as unknown as string[];

export class CreateWebhookDto {
  @IsString() @MinLength(1) @MaxLength(500) url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EVENTS.length)
  @ArrayUnique()
  @IsIn(EVENTS, { each: true })
  event_types!: string[];

  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

export class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EVENTS.length)
  @ArrayUnique()
  @IsIn(EVENTS, { each: true })
  event_types?: string[];

  @IsOptional() @IsBoolean() is_active?: boolean;

  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

export class WebhookDeliveriesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
  @IsOptional() @IsIn(['pending', 'delivered', 'failed', 'dead']) status?:
    | 'pending'
    | 'delivered'
    | 'failed'
    | 'dead';
}
