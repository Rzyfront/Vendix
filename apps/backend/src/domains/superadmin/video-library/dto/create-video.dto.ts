import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum VideoSourceTypeEnum {
  YOUTUBE = 'YOUTUBE',
  VIMEO = 'VIMEO',
  LOOM = 'LOOM',
  DIRECT_S3 = 'DIRECT_S3',
}

export enum VideoStatusEnum {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export class CreateVideoDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  @MaxLength(500)
  summary: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  video_url: string;

  @IsOptional()
  @IsEnum(VideoSourceTypeEnum)
  video_source?: VideoSourceTypeEnum;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  external_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  duration_seconds?: number;

  @IsOptional()
  @IsString()
  thumbnail_url?: string;

  @IsOptional()
  @IsEnum(VideoStatusEnum)
  status?: VideoStatusEnum;

  @Type(() => Number)
  @IsNumber()
  category_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sort_order?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;
}
