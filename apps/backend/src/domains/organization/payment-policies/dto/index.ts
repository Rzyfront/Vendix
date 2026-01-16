import {
  IsOptional,
  IsArray,
  IsObject,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsString,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdatePaymentPoliciesDto {
  @ApiPropertyOptional({
    description: 'IDs de métodos de pago permitidos para la organización',
    example: ['stripe', 'paypal', 'mercadopago'],
  })
  @IsOptional()
  @IsArray()
  allowed_methods?: string[];

  @ApiPropertyOptional({
    description: 'Configuración base que heredan las tiendas',
    example: { default_currency: 'USD', tax_included: false },
  })
  @IsOptional()
  @IsObject()
  default_config?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Si se aplican las políticas a todas las tiendas',
    example: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enforce_policies?: boolean;

  @ApiPropertyOptional({
    description: 'Si las tiendas pueden modificar configuraciones',
    example: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allow_store_overrides?: boolean;

  @ApiPropertyOptional({
    description: 'Monto mínimo global para pedidos',
    example: 10.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  min_order_amount?: number;

  @ApiPropertyOptional({
    description: 'Monto máximo global para pedidos',
    example: 10000.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  max_order_amount?: number;
}

export { UpdatePaymentMethodsDto } from './update-payment-methods.dto';
export { PaymentMethodDto } from './payment-method.dto';
