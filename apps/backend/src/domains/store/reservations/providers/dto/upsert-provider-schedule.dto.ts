import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class ProviderScheduleItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week: number;

  @IsString()
  start_time: string;

  @IsString()
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
