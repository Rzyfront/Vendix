import {
  ArrayMaxSize,
  IsArray,
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

/** Max support people of one task. */
export const CRM_TASK_MAX_SUPPORTERS = 10;

const ASSIGNED_PATTERN = /^(me|unassigned|all|\d+)$/;
const ASSIGNED_MESSAGE = 'assigned must be me, unassigned, all or a user id';

/**
 * Counters of the tasks screen. With `assigned` they count the same tasks the
 * list shows for that filter; without it, everything the viewer can see.
 */
export class CrmTaskStatsQueryDto {
  /** `me`, `unassigned`, `all` or a user id. */
  @IsOptional()
  @Matches(ASSIGNED_PATTERN, { message: ASSIGNED_MESSAGE })
  assigned?: string;
}

/** Search of the support picker: active staff of the store by name. */
export class CrmTaskStaffQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CrmTasksQueryDto {
  /** `me`, `unassigned`, `all` or a user id. */
  @IsOptional()
  @Matches(ASSIGNED_PATTERN, { message: ASSIGNED_MESSAGE })
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

  /** Support people: active staff; the assignee is dropped from the list. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CRM_TASK_MAX_SUPPORTERS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  support_user_ids?: number[];

  /**
   * Stage the linked opportunity moves to when the task is completed. Needs
   * `opportunity_id`; an active, non-lost stage of its board.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  move_to_stage_id?: number | null;
}

/**
 * Body of `POST /:id/complete`, optional. Empty, the task is just completed.
 * With both fields (a task that moves nothing, the seller chose on the spot),
 * completing it also moves that open opportunity of the task's customer to
 * that stage. One without the other is rejected.
 */
export class CompleteCrmTaskDto {
  @ValidateIf(
    (dto: CompleteCrmTaskDto) =>
      dto.opportunity_id !== undefined || dto.move_to_stage_id !== undefined,
  )
  @IsInt()
  @Min(1)
  opportunity_id?: number;

  @ValidateIf(
    (dto: CompleteCrmTaskDto) =>
      dto.opportunity_id !== undefined || dto.move_to_stage_id !== undefined,
  )
  @IsInt()
  @Min(1)
  move_to_stage_id?: number;
}

/**
 * `null` clears `description`, `due_at`, `assigned_user_id` or
 * `move_to_stage_id`.
 */
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

  /** Replaces the whole set of support people. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CRM_TASK_MAX_SUPPORTERS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  support_user_ids?: number[];

  /** `null` stops the task from moving its opportunity. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  move_to_stage_id?: number | null;
}
