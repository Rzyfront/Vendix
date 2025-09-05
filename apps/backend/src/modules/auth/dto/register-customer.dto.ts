import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsNumber,
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
      'Contraseña del cliente (mínimo 8 caracteres, al menos un carácter especial)',
  })
  @IsString({ message: 'La contraseña debe ser un string' })
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'La contraseña debe contener al menos un carácter especial',
  })
  password: string;

  @ApiProperty({ example: 'Juan', description: 'Nombre del cliente' })
  @IsString({ message: 'El nombre debe ser un string' })
  @IsNotEmpty({ message: 'El nombre es requerido' })
  first_name: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del cliente' })
  @IsString({ message: 'El apellido debe ser un string' })
  @IsNotEmpty({ message: 'El apellido es requerido' })
  last_name: string;

  @ApiProperty({
    example: 1,
    description: 'ID de la tienda donde se registra el cliente',
  })
  @IsNumber({}, { message: 'El ID de la tienda debe ser un número' })
  @IsNotEmpty({ message: 'El ID de la tienda es requerido' })
  storeId: number;
}
