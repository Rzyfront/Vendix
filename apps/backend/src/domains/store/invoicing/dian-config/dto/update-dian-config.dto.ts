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

export class UpdateDianConfigDto {
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @TrimTaxId()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'NIT must contain only digits' })
  nit?: string;

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

  // Same contract as CreateDianConfigDto: these are DIAN-issued UUIDs pasted by
  // hand, so they are trimmed and shape-checked. Values such as "9547" reached
  // production before this guard existed.
  @IsOptional()
  @TrimString()
  @IsString()
  @IsUUID(undefined, {
    message: 'software_id must be the UUID issued by the DIAN portal',
  })
  software_id?: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  software_pin?: string;

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
