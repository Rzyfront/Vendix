import { IsEnum, IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { print_format_type_enum } from '@prisma/client';

export class RenderPrintDocumentDto {
  @IsEnum(print_format_type_enum)
  format_type: print_format_type_enum;

  @IsNotEmpty()
  document_id: number | string;

  @IsOptional()
  @IsIn(['html', 'pdf'])
  engine?: 'html' | 'pdf' = 'html';
}
