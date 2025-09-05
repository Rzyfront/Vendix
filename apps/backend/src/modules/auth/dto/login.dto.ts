import { IsEmail, IsNotEmpty, IsString, ValidateIf, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'usuario@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail({}, { message: 'Debe ser un email válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Contraseña del usuario',
  })
  @IsString({ message: 'La contraseña debe ser un string' })
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  password: string;

  @ApiPropertyOptional({
    example: 'mi-super-organizacion',
    description: 'Slug de la organización a la que se intenta acceder (opcional si se proporciona storeSlug)',
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => !o.storeSlug)
  @IsNotEmpty({ message: 'El slug de la organización es requerido si no se proporciona storeSlug' })
  organizationSlug?: string;

  @ApiPropertyOptional({
    example: 'mi-tienda-principal',
    description: 'Slug de la tienda a la que se intenta acceder (opcional si se proporciona organizationSlug)',
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => !o.organizationSlug)
  @IsNotEmpty({ message: 'El slug de la tienda es requerido si no se proporciona organizationSlug' })
  storeSlug?: string;
}

