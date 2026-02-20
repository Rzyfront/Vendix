import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterCustomerDto {
  @ApiProperty({
    example: 'cliente@email.com',
    description: 'Correo electrónico del cliente',
  })
  @IsEmail({}, { message: 'Debe ser un email válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description:
      'Contraseña del cliente (opcional, se genera temporal si no se proporciona)',
    required: false,
  })
  @IsString({ message: 'La contraseña debe ser un string' })
  @IsOptional()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'La contraseña debe contener al menos un carácter especial',
  })
  password?: string;

  @ApiProperty({ example: 'Juan', description: 'Nombre del cliente' })
  @IsString({ message: 'El nombre debe ser un string' })
  @IsNotEmpty({ message: 'El nombre es requerido' })
  first_name: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del cliente' })
  @IsString({ message: 'El apellido debe ser un string' })
  @IsNotEmpty({ message: 'El apellido es requerido' })
  last_name: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'Teléfono del cliente',
    required: false,
  })
  @IsString({ message: 'El teléfono debe ser un string' })
  @IsOptional()
  @Matches(/^[\d+#*\s()-]*$/, { message: 'El teléfono solo puede contener números y los símbolos + # * ( ) -' })
  phone?: string;

  @ApiProperty({
    example: 'CC',
    description: 'Tipo de documento del cliente',
    required: false,
  })
  @IsString({ message: 'El tipo de documento debe ser un string' })
  @IsOptional()
  document_type?: string;

  @ApiProperty({
    example: '123456789',
    description: 'Número de documento del cliente',
    required: false,
  })
  @IsString({ message: 'El número de documento debe ser un string' })
  @IsOptional()
  document_number?: string;

  @ApiProperty({
    example: 1,
    description: 'ID de la tienda donde se registra el cliente',
  })
  @IsNumber({}, { message: 'El ID de la tienda debe ser un número' })
  @IsNotEmpty({ message: 'El ID de la tienda es requerido' })
  store_id: number;
}
