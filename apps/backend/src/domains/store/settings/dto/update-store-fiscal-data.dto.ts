import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

/**
 * Person type for fiscal/tax purposes (Colombia).
 */
export enum FiscalPersonType {
  NATURAL = 'NATURAL',
  JURIDICA = 'JURIDICA',
}

/**
 * Tax regime classification (Colombia DIAN).
 */
export enum FiscalTaxRegime {
  COMUN = 'COMUN',
  SIMPLIFICADO = 'SIMPLIFICADO',
  GRAN_CONTRIBUYENTE = 'GRAN_CONTRIBUYENTE',
}

/**
 * Partial update payload for the `fiscal_data` section of `store_settings`.
 *
 * All fields are optional; the service performs a deep-merge over
 * `settings.fiscal_data` so callers can patch a subset of attributes.
 *
 * Decision: dedicated endpoint (`PATCH /store/settings/fiscal-data`) keeps
 * fiscal data writes isolated from the generic per-section PATCH and matches
 * the symmetry with `/organization/settings/fiscal-data`.
 */
@ApiSchema({ name: 'StoreUpdateFiscalDataDto' })
export class UpdateStoreFiscalDataDto {
  @ApiPropertyOptional({ example: '900123456', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nit?: string;

  @ApiPropertyOptional({ example: '7', maxLength: 2 })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  nit_dv?: string;

  @ApiPropertyOptional({ example: 'Comercializadora ABC S.A.S.', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @ApiPropertyOptional({ enum: FiscalPersonType })
  @IsOptional()
  @IsEnum(FiscalPersonType)
  person_type?: FiscalPersonType;

  @ApiPropertyOptional({ enum: FiscalTaxRegime })
  @IsOptional()
  @IsEnum(FiscalTaxRegime)
  tax_regime?: FiscalTaxRegime;

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
