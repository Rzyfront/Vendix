import { IsBoolean, IsEnum, IsOptional, IsObject, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { print_format_type_enum } from '@prisma/client';

export class UpdatePrintFormatConfigDto {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  gateway_enabled?: boolean;

  @IsOptional()
  @IsNumber()
  template_id?: number | null;

  @IsOptional()
  @IsObject()
  overrides?: Record<string, any>;
}

export class PrintPreviewRequestDto {
  @IsOptional()
  @IsObject()
  overrides?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  sample_document_id?: number;

  @IsOptional()
  @IsEnum(['dummy', 'tokenized', 'real'])
  render_mode?: 'dummy' | 'tokenized' | 'real';
}
