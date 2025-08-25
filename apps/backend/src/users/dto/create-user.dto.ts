import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsEnum,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_state_enum } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'Juan', description: 'Nombre del usuario' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  first_name: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del usuario' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  last_name: string;

  @ApiProperty({ example: 'juanperez', description: 'Nombre de usuario único' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @ApiProperty({ example: 'juan@email.com', description: 'Correo electrónico del usuario' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'password123', description: 'Contraseña del usuario (mínimo 8 caracteres)' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'active', description: 'Estado del usuario (opcional)' })
  @IsOptional()
  @IsEnum(user_state_enum)
  state?: user_state_enum;

  @ApiPropertyOptional({ example: false, description: '¿Email verificado? (opcional)' })
  @IsOptional()
  @IsBoolean()
  email_verified?: boolean;

  @ApiPropertyOptional({ example: false, description: '¿Tiene 2FA habilitado? (opcional)' })
  @IsOptional()
  @IsBoolean()
  two_factor_enabled?: boolean;

  @ApiPropertyOptional({ example: 'SECRET2FA', description: 'Secreto de 2FA (opcional)' })
  @IsOptional()
  @IsString()
  two_factor_secret?: string;
}
