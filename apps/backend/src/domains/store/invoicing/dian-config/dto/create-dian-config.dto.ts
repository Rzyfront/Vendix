import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateDianConfigDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'NIT must contain only digits' })
  nit: string;

  @IsOptional()
  @IsEnum(['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA'])
  nit_type?: 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';

  @IsOptional()
  @IsString()
  @MaxLength(1)
  nit_dv?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsString()
  @MaxLength(100)
  software_id: string;

  @IsString()
  @MinLength(1)
  software_pin: string;

  @IsOptional()
  @IsEnum(['test', 'production'])
  environment?: 'test' | 'production';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  test_set_id?: string;
}
