import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import {
  TrimString,
  TrimTaxId,
} from '../../../../../common/decorators/trim-string.decorator';

export class CreateDianConfigDto {
  @TrimString()
  @IsString()
  @MaxLength(100)
  name: string;

  @TrimTaxId()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'NIT must contain only digits' })
  nit: string;

  @IsOptional()
  @IsEnum(['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'])
  nit_type?: 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(1)
  @Matches(/^\d$/, { message: 'nit_dv must be a single digit' })
  nit_dv?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsEnum(['invoicing', 'support_document', 'payroll'])
  configuration_type?: 'invoicing' | 'support_document' | 'payroll';

  @IsOptional()
  @IsEnum(['own_software', 'technological_provider'])
  operation_mode?: 'own_software' | 'technological_provider';

  // SoftwareID and TestSetId are UUIDs issued by the DIAN portal and pasted by
  // hand. `MaxLength(100)` accepted values like "9547" and "12312", which reach
  // the DIAN as-is and get the batch discarded without a verdict. Any UUID
  // version is allowed (the portal's version is not part of our contract), but
  // the shape is enforced.
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'software_id must be the UUID issued by the DIAN portal',
  })
  software_id: string;

  // The PIN is numeric in practice but its format is not contractually fixed by
  // DIAN, so it is only trimmed and bounded — a false rejection here would block
  // a legitimate configuration.
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  software_pin: string;

  @IsOptional()
  @IsEnum(['test', 'production'])
  environment?: 'test' | 'production';

  @IsOptional()
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'test_set_id must be the TestSetId UUID issued by the DIAN portal',
  })
  test_set_id?: string;
}
