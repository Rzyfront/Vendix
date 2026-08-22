import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { print_format_type_enum } from '@prisma/client';

export class CreatePrintTemplateDto {
  @IsEnum(print_format_type_enum)
  format_type: print_format_type_enum;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsObject()
  definition: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  is_shared?: boolean;
}

export class UpdatePrintTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  definition?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  is_shared?: boolean;
}

export class UpdateTemplateShareDto {
  @IsBoolean()
  is_shared: boolean;
}
