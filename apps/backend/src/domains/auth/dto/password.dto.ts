import { normalizeEmail } from '@common/utils/email.util';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsInt,
  IsPositive,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validators/password-policy';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'usuario@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  email: string;

  // QUI-943: opcional y acepta el V-link de la organización O el de la
  // tienda, igual que el login de staff. El nombre del campo se conserva por
  // compatibilidad con los clientes existentes (web y mobile).
  @ApiProperty({
    example: 'mi-organizacion',
    description:
      'V-link de la organización o de la tienda (opcional). Sin él, se usa la única cuenta de staff del email.',
    required: false,
  })
  @IsOptional()
  @IsString()
  organization_slug?: string;
}

export class ForgotPasswordCustomerDto {
  @ApiProperty({
    example: 'cliente@email.com',
    description: 'Correo electrónico del cliente',
  })
  @IsEmail()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  email: string;

  @ApiProperty({
    example: 1,
    description: 'ID de la tienda (requerido para multi-tenant ecommerce)',
  })
  @IsInt()
  @IsPositive()
  store_id: number;
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
    example: 'NuevaClave123.',
    description:
      'Nueva contraseña: mínimo 8 caracteres, con minúscula, mayúscula, número y símbolo',
  })
  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  new_password: string;

  /**
   * ID de la tienda ecommerce desde la que se inicia la recuperación.
   * Opcional: cuando está presente, el flujo customer vincula al cliente
   * con la tienda (idempotente) y activa la cuenta pending_verification.
   * El reset genérico (owner/staff) lo ignora.
   */
  @ApiProperty({
    example: 10,
    description:
      'ID de la tienda ecommerce donde el cliente recupera su cuenta',
    required: false,
  })
  @IsOptional()
  @IsInt()
  store_id?: number;
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
    example: 'NuevaClave123.',
    description:
      'Nueva contraseña: mínimo 8 caracteres, con minúscula, mayúscula, número y símbolo',
  })
  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  new_password: string;
}

export { AuthChangePasswordDto as ChangePasswordDto };
