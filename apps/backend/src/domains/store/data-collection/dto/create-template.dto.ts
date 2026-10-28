import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsInt,
  MaxLength,
  Matches,
  IsIn,
} from 'class-validator';
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
  @Matches(/^(25|33|50|75|100)$/, {
    message: 'width must be 25, 33, 50, 75, or 100',
  })
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
  @IsIn(['active', 'inactive', 'archived'])
  status?: string;

  @IsOptional()
  @IsIn(['customer', 'booking', 'order', 'service_session'])
  entity_type?: string;

  /** Tipo de estación para el que se diseñó; la estación creada con esta plantilla lo hereda. */
  @IsOptional()
  @IsIn(['carro', 'moto', 'peluqueria', 'barberia', 'salon_belleza', 'general', 'celular'])
  station_type?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  /**
   * Bloques fijos de la recepción (Asignar) que la plantilla muestra.
   * Servicio y técnico van siempre; presupuesto, productos y notas los puede
   * quitar el administrador por plantilla. Sin valor: visibles.
   */
  @IsOptional()
  @IsBoolean()
  checkin_show_budget?: boolean;

  @IsOptional()
  @IsBoolean()
  checkin_show_products?: boolean;

  @IsOptional()
  @IsBoolean()
  checkin_show_notes?: boolean;

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
