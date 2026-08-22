import { IsEnum, IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { PrintFormatTypeEnum } from '../enums/print-format.enum';

export class RenderPrintDocumentDto {
  @IsEnum(PrintFormatTypeEnum)
  format_type: PrintFormatTypeEnum;

  @IsNotEmpty()
  document_id: number | string;

  @IsOptional()
  @IsIn(['html', 'pdf'])
  engine?: 'html' | 'pdf' = 'html';
}
