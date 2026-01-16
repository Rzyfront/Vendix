import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class UpdatePaymentMethodsDto {
  @ApiProperty({
    description:
      'Array con los nombres de los métodos de pago permitidos para la organización',
    example: ['stripe', 'paypal', 'mercadopago'],
  })
  @IsArray()
  @IsString({ each: true })
  allowed_methods: string[];
}
