import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInventorySupplierDto {
  @ApiProperty({ description: 'Organization ID' })
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  @ApiProperty({ description: 'Supplier name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Supplier code' })
  @IsString()
  @IsNotEmpty()
  code: string;

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
  @IsNumber()
  @IsOptional()
  lead_time_days?: number;

  @ApiProperty({ description: 'Notes about the supplier' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Is supplier active' })
  @IsOptional()
  is_active?: boolean = true;
}
