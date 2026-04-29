import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateInvoiceItemDto,
  CreateInvoiceTaxDto,
} from '../../dto/create-invoice.dto';

export class CreateCreditNoteDto {
  @IsNumber()
  @Type(() => Number)
  related_invoice_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsDateString()
  issue_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}

export class CreateDebitNoteDto {
  @IsNumber()
  @Type(() => Number)
  related_invoice_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsDateString()
  issue_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}
