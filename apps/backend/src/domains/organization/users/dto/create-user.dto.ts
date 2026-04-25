import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  IsEnum,
  IsBoolean,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_state_enum } from '@prisma/client';

export class CreateUserDto {
  @ApiPropertyOptional({
    example: 'STORE_ADMIN',
    description: 'App para la configuración de usuario',
  })
  @IsOptional()
  @IsString()
  app?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID de la organización' })
  @IsOptional()
  @IsInt()
  organization_id?: number;

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

  @ApiProperty({
    example: 'juan@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'Contraseña del usuario (mínimo 8 caracteres)',
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Estado del usuario (opcional)',
  })
  @IsOptional()
  @IsEnum(user_state_enum)
  state?: user_state_enum;

  @ApiPropertyOptional({ example: '+573001234567', description: 'Teléfono del usuario' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'CC', description: 'Tipo de documento' })
  @IsOptional()
  @IsString()
  document_type?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Número de documento' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  document_number?: string;

  @ApiPropertyOptional({ example: 'avatars/user-123.jpg', description: 'URL del avatar en S3' })
  @IsOptional()
  @IsString()
  avatar_url?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID de la tienda principal' })
  @IsOptional()
  @IsInt()
  main_store_id?: number;
}
