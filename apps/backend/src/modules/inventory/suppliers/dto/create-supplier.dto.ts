import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSupplierDto {
  @ApiProperty({ description: 'Supplier name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Contact person name' })
  @IsString()
  @IsOptional()
  contact_person?: string;

  @ApiProperty({ description: 'Email address' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: 'Phone number' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ description: 'Mobile phone number' })
  @IsString()
  @IsOptional()
  mobile?: string;

  @ApiProperty({ description: 'Website URL' })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiProperty({ description: 'Tax ID or VAT number' })
  @IsString()
  @IsOptional()
  tax_id?: string;

  @ApiProperty({ description: 'Payment terms (e.g., NET30, NET60)' })
  @IsString()
  @IsOptional()
  payment_terms?: string;

  @ApiProperty({ description: 'Currency code' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ description: 'Lead time in days' })
  @IsString()
  @IsOptional()
  lead_time?: string;

  @ApiProperty({ description: 'Minimum order quantity' })
  @IsString()
  @IsOptional()
  minimum_order_quantity?: string;

  @ApiProperty({ description: 'Notes about the supplier' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Is supplier active' })
  @IsOptional()
  is_active?: boolean = true;
}
