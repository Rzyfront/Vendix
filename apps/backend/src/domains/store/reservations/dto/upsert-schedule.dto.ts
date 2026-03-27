import {
  IsInt,
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  Min,
  Max,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ScheduleItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  @Type(() => Number)
  day_of_week: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'start_time debe tener formato HH:mm' })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'end_time debe tener formato HH:mm' })
  end_time: string;

  @IsInt()
  @Min(5)
  @Type(() => Number)
  slot_duration_minutes: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  capacity?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  buffer_minutes?: number = 0;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_active?: boolean = true;
}

export class UpsertScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleItemDto)
  items: ScheduleItemDto[];
}
