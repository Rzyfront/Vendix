import { IsEmail, IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'usuario@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
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

export class ChangePasswordDto {
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
