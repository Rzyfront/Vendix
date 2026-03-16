import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class AddAttachmentDto {
  @IsOptional()
  @IsString()
  supplier_invoice_number?: string;

  @IsOptional()
  @IsDateString()
  supplier_invoice_date?: string;

  @IsOptional()
  @IsNumber()
  supplier_invoice_amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
