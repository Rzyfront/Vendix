import {
  IsOptional,
  IsString,
  IsPhoneNumber,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetupUserWizardDto {
  @ApiPropertyOptional({ example: 'Juan', description: 'User first name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name?: string;

  @ApiPropertyOptional({ example: 'Pérez', description: 'User last name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;

  @ApiPropertyOptional({
    example: '+52 123 456 7890',
    description: 'User phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // Address fields
  @ApiPropertyOptional({
    example: 'Calle Principal 123',
    description: 'Address line 1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line1?: string;

  @ApiPropertyOptional({
    example: 'Departamento 4B',
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
