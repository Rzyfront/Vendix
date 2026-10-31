import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const CRM_TASK_STATUSES = ['pending', 'done', 'cancelled'] as const;
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];

/** Due windows, measured in the store's timezone. */
export const CRM_TASK_DUE_FILTERS = ['overdue', 'today', 'week'] as const;
export type CrmTaskDueFilter = (typeof CRM_TASK_DUE_FILTERS)[number];

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

export class CrmTasksQueryDto {
  /** `me`, `unassigned`, `all` or a user id. */
  @IsOptional()
  @Matches(/^(me|unassigned|all|\d+)$/, {
    message: 'assigned must be me, unassigned, all or a user id',
  })
  assigned?: string;

  @IsOptional()
  @IsIn(CRM_TASK_STATUSES)
  status?: CrmTaskStatus;

  @IsOptional()
  @IsIn(CRM_TASK_DUE_FILTERS)
  due?: CrmTaskDueFilter;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  customer_id?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  opportunity_id?: number;

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
  @Max(100)
  limit?: number;
}

export class CreateCrmTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  due_at?: string;

  /** Defaults to the creator. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  assigned_user_id?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  customer_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  opportunity_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  conversation_id?: number;
}

/** `null` clears `description`, `due_at` or `assigned_user_id`. */
export class UpdateCrmTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  due_at?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  assigned_user_id?: number | null;

  @IsOptional()
  @IsIn(CRM_TASK_STATUSES)
  status?: CrmTaskStatus;
}
