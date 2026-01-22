import { IsEmail, IsNotEmpty, IsString, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginCustomerDto {
  @ApiProperty({
    example: 'cliente@email.com',
    description: 'Correo electrónico del cliente',
  })
  @IsEmail({}, { message: 'Debe ser un email válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Contraseña del cliente',
  })
  @IsString({ message: 'La contraseña debe ser un string' })
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  password: string;

  @ApiProperty({
    example: 1,
    description: 'ID de la tienda donde intenta iniciar sesión',
  })
  @IsNumber({}, { message: 'El ID de la tienda debe ser un número' })
  @IsNotEmpty({ message: 'El ID de la tienda es requerido' })
  store_id: number;
}
