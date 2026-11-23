import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum VideoSeriesStatusEnum {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export class VideoSeriesItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  video_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  article_id?: number | null;
}

export class CreateVideoSeriesDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string;

  @IsOptional()
  @IsString()
  thumbnail_url?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  /** Ordered list: array position defines the playback order. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VideoSeriesItemDto)
  items?: VideoSeriesItemDto[];
}

export class UpdateVideoSeriesDto extends PartialType(CreateVideoSeriesDto) {}

export class VideoSeriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(VideoSeriesStatusEnum)
  status?: VideoSeriesStatusEnum;

  @IsOptional()
  @IsString()
  search?: string;
}
