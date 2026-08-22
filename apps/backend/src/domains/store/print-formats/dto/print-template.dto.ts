import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { PrintFormatTypeEnum } from '../enums/print-format.enum';

export class CreatePrintTemplateDto {
  @IsEnum(PrintFormatTypeEnum)
  format_type: PrintFormatTypeEnum;

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
