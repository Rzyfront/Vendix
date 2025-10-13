import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsInt,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterStaffDto {
  @ApiProperty({ example: 'Juan', description: 'Nombre del staff' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  first_name: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del staff' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  last_name: string;

  @ApiProperty({
    example: 'juan.perez@empresa.com',
    description: 'Correo electrónico del staff',
  })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'Contraseña del staff (mínimo 8 caracteres)',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password: string;

  @ApiProperty({
    example: 'manager',
    description: 'Rol del staff (manager, supervisor, employee)',
    enum: ['manager', 'supervisor', 'employee'],
  })
  @IsString()
  @IsEnum(['manager', 'supervisor', 'employee'])
  role: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'ID de la tienda (opcional, para asignar staff a una tienda específica)',
  })
  @IsOptional()
  @IsInt()
  store_id?: number;
}
