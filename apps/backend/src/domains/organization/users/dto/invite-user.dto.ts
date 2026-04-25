import { IsString, IsEmail, IsOptional, MinLength, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteUserDto {
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

  @ApiProperty({
    example: 'juan@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({
    enum: ['ORG_ADMIN', 'STORE_ADMIN', 'STORE_ECOMMERCE', 'VENDIX_LANDING'],
    description: 'App para la configuración de usuario',
  })
  @IsOptional()
  @IsString()
  app?: string;
}