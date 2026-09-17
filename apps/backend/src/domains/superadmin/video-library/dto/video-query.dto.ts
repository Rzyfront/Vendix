import { IsOptional, IsString, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { VideoStatusEnum, VideoSourceTypeEnum } from './create-video.dto';

export class AdminVideoQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(VideoStatusEnum)
  status?: VideoStatusEnum;

  @IsOptional()
  @IsEnum(VideoSourceTypeEnum)
  video_source?: VideoSourceTypeEnum;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
