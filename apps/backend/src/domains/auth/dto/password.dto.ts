import { IsEmail, IsString, IsNotEmpty, MinLength, IsInt } from 'class-validator';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'usuario@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'mi-organizacion',
    description: 'Slug de la organización (requerido para multi-tenant)',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  organization_slug: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    example: 'reset-token-here',
    description: 'Token de reseteo de contraseña',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'nuevaContraseña123',
    description: 'Nueva contraseña (mínimo 8 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  new_password: string;
}

@ApiSchema({ name: 'AuthChangePasswordDto' })
export class AuthChangePasswordDto {
  @ApiProperty({
    example: 'contraseñaActual',
    description: 'Contraseña actual del usuario',
  })
  @IsString()
  @IsNotEmpty()
  current_password: string;

  @ApiProperty({
    example: 'nuevaContraseña123',
    description: 'Nueva contraseña (mínimo 8 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  new_password: string;
}

export { AuthChangePasswordDto as ChangePasswordDto };

export class ForgotCustomerPasswordDto {
  @ApiProperty({
    example: 'cliente@email.com',
    description:
      'Correo del cliente ecommerce. No requiere organization_slug — la tienda se resuelve desde el contexto del request',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 12,
    description: 'ID de la tienda ecommerce donde el cliente intenta registrarse',
  })
  @IsInt()
  @IsNotEmpty()
  store_id: number;
}

export class ResetCustomerPasswordDto {
  @ApiProperty({
    example: 'reset-token-here',
    description: 'Token recibido por email tras forgotCustomerPassword',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'NuevaContraseña123!',
    description:
      'Nueva contraseña (mínimo 8 caracteres con mayúsculas, minúsculas y números). Si la cuenta estaba en pending_verification, también se activa.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  new_password: string;
}
