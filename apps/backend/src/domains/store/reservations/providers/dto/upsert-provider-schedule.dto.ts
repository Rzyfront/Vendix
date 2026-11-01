import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/// HH:mm 24h — the exact shape `provider_schedules.start_time/end_time`
/// (`VarChar(5)`) accepts. Anything else (empty, `HH:mm:ss`, garbage)
/// used to blow up inside `createMany` as a 500 (QUI-968).
export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ProviderScheduleItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week: number;

  /// Order of this block within the day (0 = first, 1 = second, etc.)
  /// Optional: when omitted the service assigns per-day counters.
  /// NOTE: no `= 0` default — a default would fill every missing value
  /// with 0 and collide on the (provider_id, day_of_week, block_order)
  /// unique index as soon as a day has two blocks (QUI-968, P2002 → 500).
  @IsOptional()
  @IsInt()
  @Min(0)
  block_order?: number;

  @IsString()
  @Matches(SCHEDULE_TIME_PATTERN, {
    message: 'start_time debe usar formato HH:mm (00:00-23:59)',
  })
  start_time: string;

  @IsString()
  @Matches(SCHEDULE_TIME_PATTERN, {
    message: 'end_time debe usar formato HH:mm (00:00-23:59)',
  })
  end_time: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}

export class UpsertProviderScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProviderScheduleItemDto)
  items: ProviderScheduleItemDto[];
}
