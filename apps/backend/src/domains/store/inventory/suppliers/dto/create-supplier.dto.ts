import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsIn,
  IsNumber,
  IsBoolean,
  ValidateIf,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { supplier_category_enum, supplier_state_enum } from '@prisma/client';
import { DIAN_IDENTIFICATION_TYPES } from '../../../invoicing/validators/customer-fiscal-identity.validator';

/** Códigos DIAN del Anexo 19: el mismo catálogo que usa la identidad fiscal de clientes. */
const DIAN_DOCUMENT_TYPE_CODES: string[] = DIAN_IDENTIFICATION_TYPES.map(
  (t) => t.code,
);

/**
 * Convierte `null` en `undefined` para que Prisma omita el campo y aplique el
 * default de la columna.
 *
 * `@IsOptional()` no valida cuando el valor es `null`, así que un `null`
 * enviado por el cliente atraviesa la validación y llega al `data` de Prisma.
 * En una columna NOT NULL con default eso invalida el input *unchecked*,
 * Prisma cae al *checked* y responde `Argument 'organizations' is missing` —
 * un error que no menciona el campo culpable y manda a buscar la relación.
 */
const nullToUndefined = () =>
  Transform(({ value }) => (value === null ? undefined : value));

/**
 * Dirección fiscal del proveedor (tabla `addresses`). `municipality_code` es el
 * código DIVIPOLA/DANE que exige el documento soporte.
 */
export class SupplierAddressDto {
  @ApiProperty({ description: 'Address line 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address_line1: string;

  @ApiPropertyOptional({ description: 'Address line 2' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line2?: string;

  @ApiProperty({ description: 'City / municipality name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiPropertyOptional({ description: 'State / department' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state_province?: string;

  @ApiPropertyOptional({ description: 'ISO country code', default: 'CO' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  country_code?: string;

  @ApiPropertyOptional({ description: 'Postal code' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postal_code?: string;

  @ApiPropertyOptional({ description: 'DIAN municipality code (DIVIPOLA)' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  municipality_code?: string;
}

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

  @ApiPropertyOptional({
    description: 'DIAN identification document type code (e.g. 31 = NIT)',
    enum: DIAN_DOCUMENT_TYPE_CODES,
  })
  @IsOptional()
  @nullToUndefined()
  @IsIn(DIAN_DOCUMENT_TYPE_CODES)
  document_type?: string;

  @ApiPropertyOptional({ description: 'NIT verification digit (single digit)' })
  @IsOptional()
  @nullToUndefined()
  @Matches(/^\d$/, { message: 'verification_digit must be a single digit' })
  verification_digit?: string;

  @ApiPropertyOptional({
    description: 'Fiscal address; created or updated in place',
    type: () => SupplierAddressDto,
  })
  @IsOptional()
  @nullToUndefined()
  @ValidateNested()
  @Type(() => SupplierAddressDto)
  address?: SupplierAddressDto;

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
  @nullToUndefined()
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

  @ApiPropertyOptional({
    description:
      'Lifecycle state. `archived` no se acepta al crear ni al actualizar: archivar va por DELETE.',
    enum: [supplier_state_enum.active, supplier_state_enum.inactive],
    default: 'active',
  })
  @IsOptional()
  @nullToUndefined()
  @IsIn([supplier_state_enum.active, supplier_state_enum.inactive])
  state?: supplier_state_enum = supplier_state_enum.active;

  // Plan Despacho Economía — FASE 1 paso 7.
  @ApiPropertyOptional({
    description: 'Supplier category (goods|carrier|service). `carrier` enables AP+withholding on route close.',
    enum: supplier_category_enum,
    default: 'goods',
  })
  @IsOptional()
  @nullToUndefined()
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
