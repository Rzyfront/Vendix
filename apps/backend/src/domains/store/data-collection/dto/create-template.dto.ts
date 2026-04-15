import { IsString, IsOptional, IsEnum, IsBoolean, IsArray, ValidateNested, IsInt, MaxLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTemplateItemDto {
  @IsInt()
  metadata_field_id: number;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @IsOptional()
  @IsBoolean()
  include_in_summary?: boolean;

  @IsOptional()
  @IsString()
  help_text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  placeholder?: string;

  @IsOptional()
  validation_rules?: Record<string, any>;

  @IsOptional()
  @IsString()
  @Matches(/^(25|33|50|75|100)$/, { message: 'width must be 25, 33, 50, 75, or 100' })
  width?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;
}

export class CreateTemplateSectionDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTemplateItemDto)
  items?: CreateTemplateItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTemplateSectionDto)
  child_sections?: CreateTemplateSectionDto[];
}

export class CreateTemplateTabDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTemplateSectionDto)
  sections?: CreateTemplateSectionDto[];
}

export class CreateTemplateDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsOptional()
  @IsEnum(['active', 'inactive', 'archived'])
  status?: string;

  @IsOptional()
  @IsEnum(['customer', 'booking', 'order'])
  entity_type?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTemplateTabDto)
  tabs?: CreateTemplateTabDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTemplateSectionDto)
  sections?: CreateTemplateSectionDto[];
}
