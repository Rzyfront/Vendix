import {
  IsArray,
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

export const CRM_CONVERSATION_STATUSES = [
  'open',
  'pending',
  'snoozed',
  'closed',
] as const;
export type CrmConversationStatus = (typeof CRM_CONVERSATION_STATUSES)[number];

export const CRM_CONVERSATION_CHANNELS = ['whatsapp', 'sms', 'email'] as const;

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

export class CrmConversationsQueryDto {
  @IsOptional()
  @IsIn(CRM_CONVERSATION_STATUSES)
  status?: CrmConversationStatus;

  @IsOptional()
  @IsIn(CRM_CONVERSATION_CHANNELS)
  channel?: (typeof CRM_CONVERSATION_CHANNELS)[number];

  /** `me`, `unassigned` or a user id. */
  @IsOptional()
  @Matches(/^(me|unassigned|\d+)$/, {
    message: 'assigned must be me, unassigned or a user id',
  })
  assigned?: string;

  /** Contact address or customer name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CrmMessagesQueryDto {
  /** Cursor: returns messages older than this id. */
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  before_id?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CrmTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  language!: string;

  /** Positional body variables (`{{1}}`, `{{2}}`…), in order. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  variables?: string[];
}

export class SendCrmMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  body?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CrmTemplateDto)
  template?: CrmTemplateDto;

  /**
   * Client-generated id of this send. Repeating it (double click, network
   * retry) returns the first message instead of sending twice.
   */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, {
    message: 'client_request_id must be 8-64 letters, digits, - or _',
  })
  client_request_id!: string;
}

export class CreateCrmNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  body!: string;
}

export class AssignCrmConversationDto {
  /** Staff user id, or null to unassign. Required either way. */
  @ValidateIf((dto: AssignCrmConversationDto) => dto.assigned_user_id !== null)
  @IsInt()
  @Min(1)
  assigned_user_id!: number | null;
}
