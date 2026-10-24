import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ServiceStationScheduleWindowDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  start_time!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  end_time!: string;
}

export class ReplaceServiceStationSchedulesDto {
  @IsArray()
  @ArrayMaxSize(42)
  @ValidateNested({ each: true })
  @Type(() => ServiceStationScheduleWindowDto)
  schedules!: ServiceStationScheduleWindowDto[];
}

export class CreateServiceStationExceptionDto {
  @IsDateString()
  start_at!: string;

  @IsDateString()
  end_at!: string;
}