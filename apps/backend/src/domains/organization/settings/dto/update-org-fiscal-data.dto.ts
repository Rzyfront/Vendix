import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

/**
 * Person type for fiscal/tax purposes (Colombia).
 */
export enum OrgFiscalPersonType {
  NATURAL = 'NATURAL',
  JURIDICA = 'JURIDICA',
}

/**
 * Tax regime classification (Colombia DIAN).
 */
export enum OrgFiscalTaxRegime {
  COMUN = 'COMUN',
  SIMPLIFICADO = 'SIMPLIFICADO',
  GRAN_CONTRIBUYENTE = 'GRAN_CONTRIBUYENTE',
}

/**
 * Partial update payload for the `fiscal_data` section of
 * `organization_settings`.
 *
 * All fields are optional; the service performs a deep-merge over
 * `settings.fiscal_data` without touching other sections (branding, fonts,
 * inventory, payroll, panel_ui, fiscal_status).
 *
 * Canonical endpoint: `PATCH /organization/settings/fiscal-data`.
 */
@ApiSchema({ name: 'OrganizationUpdateFiscalDataDto' })
export class UpdateOrgFiscalDataDto {
  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({ example: '900123456', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nit?: string;

  @ApiPropertyOptional({ example: '900123456', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_id?: string;

  @ApiPropertyOptional({ example: '7', maxLength: 2 })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  nit_dv?: string;

  @ApiPropertyOptional({ example: '7', maxLength: 2 })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  tax_id_dv?: string;

  @ApiPropertyOptional({
    enum: ['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'])
  nit_type?: 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

  @ApiPropertyOptional({ example: 'Comercializadora ABC S.A.S.', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @ApiPropertyOptional({ enum: OrgFiscalPersonType })
  @IsOptional()
  @IsEnum(OrgFiscalPersonType)
  person_type?: OrgFiscalPersonType;

  @ApiPropertyOptional({ enum: OrgFiscalTaxRegime })
  @IsOptional()
  @IsEnum(OrgFiscalTaxRegime)
  tax_regime?: OrgFiscalTaxRegime;

  @ApiPropertyOptional({ example: '4711', maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  ciiu?: string;

  @ApiPropertyOptional({ example: 'Calle 100 # 15 - 20', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fiscal_address?: string;

  @ApiPropertyOptional({ example: 'CO', maxLength: 8 })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;

  @ApiPropertyOptional({ example: 'Cundinamarca', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  department?: string;

  @ApiPropertyOptional({ example: 'Bogotá', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  city?: string;

  @ApiPropertyOptional({ type: [String], example: ['O-13', 'O-15'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  tax_responsibilities?: string[];
}
