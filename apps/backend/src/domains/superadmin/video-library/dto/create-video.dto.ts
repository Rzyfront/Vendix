import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  MaxLength,
  IsUrl,
  Matches,
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
  @IsUrl({}, { message: 'video_url debe ser una URL válida' })
  video_url: string;

  @IsOptional()
  @IsEnum(VideoSourceTypeEnum)
  video_source?: VideoSourceTypeEnum;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'external_id solo puede contener caracteres alfanuméricos, guiones y guiones bajos',
  })
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
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

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
