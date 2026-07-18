import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  ValidateIf,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { supplier_category_enum } from '@prisma/client';

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

  @ApiPropertyOptional({ description: 'Tax regime (fiscal classification)' })
  @IsOptional()
  @IsString()
  tax_regime?: string;

  @ApiPropertyOptional({
    description: 'Person type for withholding resolution',
    enum: ['NATURAL', 'JURIDICA'],
  })
  @IsOptional()
  @IsString()
  person_type?: string;

  @ApiPropertyOptional({
    description: 'Whether the supplier is a self-withholder (autorretenedor)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_self_withholder?: boolean;

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

  // Plan Despacho Economía — FASE 1 paso 7.
  @ApiPropertyOptional({
    description: 'Supplier category (goods|carrier|service). `carrier` enables AP+withholding on route close.',
    enum: supplier_category_enum,
    default: 'goods',
  })
  @IsOptional()
  @IsEnum(supplier_category_enum)
  supplier_category?: supplier_category_enum;

  // Banco destino del pago inmediato al carrier (paso 17).
  // Las 3 columnas cierran el bug latente de ap-bank-export.service.ts:39-41
  // que las seleccionaba sin que existieran en la tabla.
  @ApiPropertyOptional({ description: 'Bank name (required when supplier_category=carrier)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bank_name?: string;

  @ApiPropertyOptional({ description: 'Bank account number (required when supplier_category=carrier)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  bank_account_number?: string;

  @ApiPropertyOptional({
    description: 'Bank account type (savings|checking)',
    enum: ['savings', 'checking'],
  })
  @IsOptional()
  @ValidateIf((o) => o.bank_name || o.bank_account_number)
  @IsString()
  @MaxLength(20)
  bank_account_type?: string;
}
