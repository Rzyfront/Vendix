import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  identification_type_enum,
  persona_type_enum,
  tax_regime_enum,
} from '@prisma/client';
import { DOCUMENT_TYPE_CODES } from '../../../../common/constants/document-types';
import { DocumentNumberMatchesType } from '../../../../common/validators/document-number.validator';
import { JuridicaNameRule } from '../../../../common/validators/juridica-name.validator';
import { NitDvMatches } from '../../../../common/validators/nit-dv.validator';
import { FiscalResponsibilityInCatalogRule } from '../../../../common/validators/fiscal-responsibility.validator';

// Local aliases so the DTO and consumers can read property types in PascalCase
// while keeping the snake_case Prisma export names at the boundary.
type IdentificationType =
  (typeof identification_type_enum)[keyof typeof identification_type_enum];
type PersonaType =
  (typeof persona_type_enum)[keyof typeof persona_type_enum];
type TaxRegime = (typeof tax_regime_enum)[keyof typeof tax_regime_enum];

export class CreateCustomerDto {
  @ApiPropertyOptional({
    example: 'juan.perez@example.com',
    description:
      'Correo del cliente. Opcional; si se omite, el sistema genera uno interno único.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsOptional()
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email?: string | null;

  @ApiPropertyOptional({
    example: 'Juan',
    description:
      "Nombre. Requerido cuando `person_type === 'NATURAL'`; debe ser NULL/vacío para personas jurídicas (la razón social ocupa ese rol).",
  })
  @IsOptional()
  @IsString()
  first_name?: string | null;

  @ApiPropertyOptional({
    example: 'Perez',
    description:
      "Apellido. Requerido cuando `person_type === 'NATURAL'`; debe ser NULL/vacío para personas jurídicas.",
  })
  @IsOptional()
  @IsString()
  last_name?: string | null;

  @ApiPropertyOptional({
    example: 'Acme S.A.S',
    description:
      "Razón social. Requerida cuando `person_type === 'JURIDICA'`; debe ser NULL/vacía para personas naturales.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string | null;

  @ApiPropertyOptional({ example: '12345678' })
  @IsOptional()
  @IsString()
  @DocumentNumberMatchesType()
  document_number?: string | null;

  @ApiPropertyOptional({ example: 'CC', enum: DOCUMENT_TYPE_CODES })
  @IsOptional()
  @IsEnum(identification_type_enum, {
    message: 'document_type debe ser uno de los códigos DIAN válidos',
  })
  document_type?: IdentificationType | null;

  @ApiPropertyOptional({
    example: '7',
    description:
      'Dígito de verificación del NIT (módulo 11). Solo aplica cuando document_type=NIT. Validado contra computeNitDv(document_number).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1)
  @Matches(/^\d?$/, {
    message:
      'verification_digit debe ser un único dígito (0-9) o estar vacío',
  })
  @NitDvMatches()
  verification_digit?: string | null;

  @ApiPropertyOptional({ example: '3001234567' })
  @IsString()
  @IsOptional()
  @Matches(/^\d{10}$/, {
    message:
      'El teléfono debe tener exactamente 10 dígitos (sin prefijo de país)',
  })
  phone?: string | null;

  @ApiPropertyOptional({
    description: 'Tax regime (fiscal classification)',
    enum: tax_regime_enum,
  })
  @IsOptional()
  @IsEnum(tax_regime_enum, {
    message: 'tax_regime debe ser uno de los regímenes tributarios válidos',
  })
  tax_regime?: TaxRegime | null;

  @ApiPropertyOptional({
    description: 'Person type for withholding resolution',
    enum: persona_type_enum,
  })
  @IsOptional()
  @IsEnum(persona_type_enum, {
    message: "person_type debe ser 'NATURAL' o 'JURIDICA'",
  })
  @JuridicaNameRule()
  person_type?: PersonaType | null;

  @ApiPropertyOptional({
    description:
      'Lista de responsabilidades fiscales del RUT (DIAN). Cada código debe pertenecer al catálogo canónico FISCAL_RESPONSIBILITIES.',
    example: ['O-13', 'O-15'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @FiscalResponsibilityInCatalogRule()
  fiscal_responsibilities?: string[];

  @ApiPropertyOptional({
    description:
      'Código CIIU de actividad económica (4 dígitos, RUT rev. 4 AC). La descripción oficial se resuelve client-side.',
    example: '4711',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{2,4}$/, {
    message: 'ciiu_code debe ser un código numérico de 2 a 4 dígitos',
  })
  ciiu_code?: string | null;

  @ApiPropertyOptional({
    description:
      'Whether the customer is a withholding agent (agente de retención)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_withholding_agent?: boolean;
}
