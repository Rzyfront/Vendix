import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validators/password-policy';

export class RegisterDto {
  @ApiProperty({
    example: 'usuario@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail({}, { message: 'Debe ser un email válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  email: string;

  @ApiProperty({
    example: 'Password123.',
    description:
      'Contraseña: mínimo 8 caracteres, con minúscula, mayúscula, número y símbolo',
  })
  @IsString({ message: 'La contraseña debe ser un string' })
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  @IsStrongPassword()
  password: string;

  @ApiProperty({ example: 'Juan', description: 'Nombre del usuario' })
  @IsString({ message: 'El nombre debe ser un string' })
  @IsNotEmpty({ message: 'El nombre es requerido' })
  first_name: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del usuario' })
  @IsString({ message: 'El apellido debe ser un string' })
  @IsNotEmpty({ message: 'El apellido es requerido' })
  last_name: string;

  @ApiPropertyOptional({
    example: '+521234567890',
    description: 'Teléfono del usuario (opcional)',
  })
  @IsString({ message: 'El teléfono debe ser un string' })
  @IsOptional()
  @Matches(/^[\d+#*\s()-]*$/, {
    message:
      'El teléfono solo puede contener números y los símbolos + # * ( ) -',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'ID de la organización a la que pertenece el usuario (opcional en algunos flujos)',
  })
  @IsOptional()
  organization_id?: number;
}
