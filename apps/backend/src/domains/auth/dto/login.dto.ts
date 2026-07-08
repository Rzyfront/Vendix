import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';
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
    example: 'mi-organizacion',
    description:
      'Identificador de la organización (slug o nombre). OPCIONAL (CD1/CD2): ' +
      'si se omite, la tienda de arranque se resuelve por main_store_id. Si ' +
      'se envía, dirige el login a esa instancia concreta.',
  })
  @IsString()
  @IsOptional()
  organization_slug?: string;

  @ApiPropertyOptional({
    example: 'mi-tienda-principal',
    description:
      'Slug de la tienda a la que se intenta acceder. OPCIONAL (CD2): si se ' +
      'envía, dirige el login a esa tienda concreta.',
  })
  @IsString()
  @IsOptional()
  store_slug?: string;
}
