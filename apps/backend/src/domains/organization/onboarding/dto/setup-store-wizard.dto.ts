import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
    example: 'America/Mexico_City',
    description: 'Store timezone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({ example: 'COP', description: 'ISO 4217 currency code' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

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
    example: 'Ciudad de México',
    description: 'City',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'CDMX',
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
    example: 'MX',
    description: 'Country code (ISO 3166-1 alpha-2)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country_code?: string;
}
