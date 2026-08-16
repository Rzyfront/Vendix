import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsStrongPassword } from '../../../common/validators/password-policy';

export class RegisterOwnerDto {
  @ApiProperty({
    example: 'Mi Super Tienda',
    description: 'Nombre de la nueva organización',
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la organización es requerido' })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s.,'&@()-]/g, '')
      : value,
  )
  organization_name: string;

  @ApiProperty({
    example: 'usuario@email.com',
    description: 'Correo electrónico del usuario',
  })
  @IsEmail({}, { message: 'Debe ser un email válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description:
      'Contraseña del usuario (mínimo 8 caracteres, al menos un carácter especial)',
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
    enum: ['STORE', 'ORGANIZATION'],
    description:
      'Fiscal scope inicial. STORE mantiene NIT/configuración DIAN por tienda; ORGANIZATION usa entidad fiscal consolidada.',
  })
  @IsOptional()
  @IsIn(['STORE', 'ORGANIZATION'] as any, {
    message: 'fiscal_scope must be STORE or ORGANIZATION',
  })
  fiscal_scope?: 'STORE' | 'ORGANIZATION';
}
