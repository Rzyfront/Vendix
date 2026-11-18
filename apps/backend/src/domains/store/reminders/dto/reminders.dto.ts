import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const REMINDER_STATUSES = ['pending', 'done'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** `all` lists pending and done together. */
export const REMINDER_STATUS_FILTERS = ['pending', 'done', 'all'] as const;
export type ReminderStatusFilter = (typeof REMINDER_STATUS_FILTERS)[number];

/** Due windows, measured in the store's timezone. */
export const REMINDER_DUE_FILTERS = [
  'overdue',
  'today',
  'upcoming',
  'no_date',
] as const;
export type ReminderDueFilter = (typeof REMINDER_DUE_FILTERS)[number];

/**
 * Store records a reminder can point at; `metric` only carries a label.
 * `user_reminders.link_type` is VarChar(20): keep every value within it.
 */
export const REMINDER_LINK_TYPES = [
  'product',
  'order',
  'customer',
  'supplier',
  'purchase_order',
  'quotation',
  'invoice',
  'metric',
] as const;
export type ReminderLinkType = (typeof REMINDER_LINK_TYPES)[number];

export const REMINDER_SOURCES = ['manual', 'vex'] as const;
export type ReminderSource = (typeof REMINDER_SOURCES)[number];

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class RemindersQueryDto {
  @IsOptional()
  @IsIn(REMINDER_STATUS_FILTERS)
  status?: ReminderStatusFilter;

  @IsOptional()
  @IsIn(REMINDER_DUE_FILTERS)
  due?: ReminderDueFilter;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** `GET /store/reminders/link-search?q=`: records to link, at least 2 characters. */
export class ReminderLinkSearchDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  q!: string;
}

export class CreateReminderDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  /**
   * ISO 8601 instant (`2026-11-15T14:00:00Z`) or a store-local wall clock
   * without offset (`2026-11-15T09:00`). `null` means "no date".
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  remind_at?: string | null;

  @IsOptional()
  @IsIn(REMINDER_LINK_TYPES)
  link_type?: ReminderLinkType | null;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  link_id?: number | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  link_label?: string | null;
}

export class UpdateReminderDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  remind_at?: string | null;

  @IsOptional()
  @IsIn(REMINDER_STATUSES)
  status?: ReminderStatus;

  @IsOptional()
  @IsIn(REMINDER_LINK_TYPES)
  link_type?: ReminderLinkType | null;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  link_id?: number | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  link_label?: string | null;
}
