import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEmail,
  IsPhoneNumber,
  IsDateString,
  MaxLength,
  Min,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Enums
export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BLOCKED = 'blocked',
}

export enum CustomerGender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

// Create Customer DTO
export class CreateCustomerDto {
  @ApiProperty({ example: 'Juan', description: 'Nombre del cliente' })
  @IsString()
  @MaxLength(100)
  first_name: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del cliente' })
  @IsString()
  @MaxLength(100)
  last_name: string;

  @ApiProperty({ example: 'juan.perez@email.com', description: 'Correo electrónico' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({ example: '+521234567890', description: 'Teléfono (opcional)' })
  @IsString()
  @IsOptional()
  @IsPhoneNumber()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: '+521234567891', description: 'Celular (opcional)' })
  @IsString()
  @IsOptional()
  @IsPhoneNumber()
  @MaxLength(20)
  mobile?: string;

  @ApiPropertyOptional({ example: '1990-01-01', description: 'Fecha de nacimiento (opcional)' })
  @IsDateString()
  @IsOptional()
  date_of_birth?: string;

  @ApiPropertyOptional({ example: 'male', enum: CustomerGender, description: 'Género (opcional)' })
  @IsEnum(CustomerGender)
  @IsOptional()
  gender?: CustomerGender;

  @ApiProperty({ example: 1, description: 'ID de la tienda' })
  @IsInt()
  @Min(1)
  store_id: number;

  @ApiPropertyOptional({ example: 1, description: 'ID de la organización (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;

  @ApiPropertyOptional({ example: 'Cliente frecuente', description: 'Notas (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: 'active', enum: CustomerStatus, description: 'Estado del cliente (opcional)' })
  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus = CustomerStatus.ACTIVE;

  @ApiPropertyOptional({ example: false, description: '¿Verificado? (opcional)' })
  @IsBoolean()
  @IsOptional()
  is_verified?: boolean = false;

  @ApiPropertyOptional({ example: false, description: '¿Acepta marketing? (opcional)' })
  @IsBoolean()
  @IsOptional()
  marketing_consent?: boolean = false;
}

// Update Customer DTO
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional({ example: 1, description: 'ID de la tienda (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID de la organización (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;
}

// Customer Query DTO
export class CustomerQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Página (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, description: 'Límite de resultados por página (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({ example: 'juan', description: 'Búsqueda por nombre o email (opcional)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID de la tienda (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID de la organización (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  organization_id?: number;

  @ApiPropertyOptional({ example: 'active', enum: CustomerStatus, description: 'Estado del cliente (opcional)' })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional({ example: 'male', enum: CustomerGender, description: 'Género (opcional)' })
  @IsOptional()
  @IsEnum(CustomerGender)
  gender?: CustomerGender;

  @ApiPropertyOptional({ example: false, description: '¿Verificado? (opcional)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_verified?: boolean;

  @ApiPropertyOptional({ example: false, description: '¿Acepta marketing? (opcional)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  marketing_consent?: boolean;

  @ApiPropertyOptional({ example: 'created_at', description: 'Campo de ordenamiento (opcional)' })
  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @ApiPropertyOptional({ example: 'desc', description: 'Orden (asc o desc) (opcional)' })
  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: false, description: '¿Incluir inactivos? (opcional)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}
