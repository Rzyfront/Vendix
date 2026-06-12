import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVendorSupportDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  vendor_nit: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  vendor_name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  invoice_number: string;

  @IsDateString()
  issue_date: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  subtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tax_amount?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  total: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  account_code: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
