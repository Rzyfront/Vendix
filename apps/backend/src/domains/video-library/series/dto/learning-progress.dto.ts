import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class LearningProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  video_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  series_id?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  seconds_watched: number;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
