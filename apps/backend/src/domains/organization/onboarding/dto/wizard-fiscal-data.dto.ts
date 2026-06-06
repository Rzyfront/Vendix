import { IsIn, IsOptional, IsString, MaxLength, IsEnum } from 'class-validator';
import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
// Same domain (organization) — reuse the canonical fiscal enums instead of
// redefining them. Keeps the wizard payload aligned with
// `UpdateOrgFiscalDataDto` / `settings.fiscal_data`.
import { OrgFiscalTaxRegime } from '../../settings/dto/update-org-fiscal-data.dto';

/**
 * OPTIONAL fiscal identity captured during the onboarding wizard.
 *
 * Every field is optional: the wizard never forces fiscal data. When present it
 * is persisted (deep-merged) into `settings.fiscal_data` of the correct scope
 * (organization_settings for fiscal_scope=ORGANIZATION, store_settings for
 * fiscal_scope=STORE) by reusing `SettingsService.updateFiscalData`.
 *
 * This is a deliberately minimal subset of the canonical `UpdateOrgFiscalDataDto`
 * shape (legal_name, nit, nit_dv, nit_type, tax_regime) — enough to seed the
 * fiscal núcleo and flip the `has_fiscal_identity` detector signal WITHOUT
 * activating the fiscal gate (fiscal_status stays INACTIVE).
 */
@ApiSchema({ name: 'WizardFiscalDataDto' })
export class WizardFiscalDataDto {
  @ApiPropertyOptional({ example: 'Comercializadora ABC S.A.S.', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

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

  @ApiPropertyOptional({
    enum: ['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'])
  nit_type?: 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

  @ApiPropertyOptional({ enum: OrgFiscalTaxRegime })
  @IsOptional()
  @IsEnum(OrgFiscalTaxRegime)
  tax_regime?: OrgFiscalTaxRegime;
}
