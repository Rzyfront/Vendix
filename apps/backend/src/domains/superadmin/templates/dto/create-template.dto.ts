import { IsString, IsOptional, IsEnum, IsBoolean, IsNotEmpty, MinLength, MaxLength, validateSync } from 'class-validator';
import { template_config_type_enum } from '@prisma/client';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(255)
  template_name: string;

  @IsEnum(template_config_type_enum)
  @IsNotEmpty()
  configuration_type: template_config_type_enum;

  @IsNotEmpty()
  template_data: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_system?: boolean;
}
