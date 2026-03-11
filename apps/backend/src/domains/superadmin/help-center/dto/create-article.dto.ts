import { IsString, IsEnum, IsOptional, IsNumber, IsBoolean, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export enum HelpArticleTypeEnum {
  TUTORIAL = 'TUTORIAL',
  FAQ = 'FAQ',
  GUIDE = 'GUIDE',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  RELEASE_NOTE = 'RELEASE_NOTE',
}

export enum HelpArticleStatusEnum {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export class CreateArticleDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  @MaxLength(500)
  summary: string;

  @IsString()
  content: string;

  @IsEnum(HelpArticleTypeEnum)
  type: HelpArticleTypeEnum;

  @IsOptional()
  @IsEnum(HelpArticleStatusEnum)
  status?: HelpArticleStatusEnum;

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
  @IsString()
  cover_image_url?: string;

  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sort_order?: number;
}
