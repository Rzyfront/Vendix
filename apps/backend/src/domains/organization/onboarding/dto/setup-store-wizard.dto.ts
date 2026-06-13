import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  MaxLength,
  MinLength,
  ValidateNested,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WizardFiscalDataDto } from './wizard-fiscal-data.dto';
import { StoreIndustry } from '../../../store/stores/dto';

export enum StoreType {
  PHYSICAL = 'physical',
  ONLINE = 'online',
  HYBRID = 'hybrid',
}

export class SetupStoreWizardDto {
  @ApiProperty({
    example: 'Tienda Principal',
    description: 'Store name',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: 'Nuestra sucursal principal en el centro',
    description: 'Store description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: 'physical',
    enum: StoreType,
    description: 'Type of store',
  })
  @IsOptional()
  @IsEnum(StoreType)
  store_type?: StoreType;

  @ApiPropertyOptional({
    example: ['retail', 'restaurant'],
    enum: StoreIndustry,
    isArray: true,
    description:
      'Store industries (multi-select). At least one required. Mirrors ' +
      '`stores.industries` on the backend; defaults to `["retail"]` when omitted.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(StoreIndustry, { each: true })
  industries?: StoreIndustry[];

  @ApiPropertyOptional({
    example: 'America/Bogota',
    description: 'Store timezone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({
    example: 'COP',
    description: 'ISO 4217 currency code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Default inventory location ID for this store',
  })
  @IsOptional()
  @IsNumber()
  default_location_id?: number;

  // Address fields (pre-populated from organization)
  @ApiPropertyOptional({
    example: 'Calle Principal 123',
    description: 'Address line 1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line1?: string;

  @ApiPropertyOptional({
    example: 'Local 5',
    description: 'Address line 2',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line2?: string;

  @ApiPropertyOptional({
    example: 'Bogotá',
    description: 'City',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'Cundinamarca',
    description: 'State or province',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state_province?: string;

  @ApiPropertyOptional({
    example: '06000',
    description: 'Postal code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postal_code?: string;

  @ApiPropertyOptional({
    example: 'CO',
    description: 'Country code (ISO 3166-1 alpha-2)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country_code?: string;

  @ApiPropertyOptional({
    type: WizardFiscalDataDto,
    description:
      'OPTIONAL fiscal identity. When provided, it is persisted to ' +
      'settings.fiscal_data of the store scope (fiscal_scope=STORE) and marks ' +
      'the has_fiscal_identity detector signal without activating the fiscal gate.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WizardFiscalDataDto)
  fiscal_data?: WizardFiscalDataDto;
}
