import { ApiProperty } from '@nestjs/swagger';

export class PaymentMethodDto {
  @ApiProperty({
    description: 'ID del método de pago del sistema',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'Nombre único del método de pago',
    example: 'stripe',
  })
  name: string;

  @ApiProperty({
    description: 'Nombre para mostrar del método de pago',
    example: 'Stripe Credit Card',
  })
  display_name: string;

  @ApiProperty({
    description: 'Descripción del método de pago',
    example: 'Tarjetas de crédito y débito vía Stripe',
  })
  description?: string | null;

  @ApiProperty({
    description: 'Tipo de método de pago',
    example: 'card',
    enum: ['cash', 'card', 'paypal', 'bank_transfer', 'voucher'],
  })
  type: string;

  @ApiProperty({
    description: 'Proveedor del método de pago',
    example: 'stripe',
  })
  provider: string;

  @ApiProperty({
    description: 'URL del logo del método de pago',
    example: 'https://s3.amazonaws.com/logos/stripe.png',
  })
  logo_url?: string | null | undefined;

  @ApiProperty({
    description: 'Si el método está activo a nivel del sistema',
    example: true,
  })
  is_active: boolean;

  @ApiProperty({
    description: 'Si el método está permitido para esta organización',
    example: true,
  })
  is_allowed: boolean;

  @ApiProperty({
    description: 'Si el método requiere configuración',
    example: true,
  })
  requires_config: boolean;

  @ApiProperty({
    description: 'Monedas soportadas',
    example: ['USD', 'EUR', 'MXN'],
  })
  supported_currencies: string[];

  @ApiProperty({
    description: 'Monto mínimo de transacción',
    example: 1.0,
  })
  min_amount?: number;

  @ApiProperty({
    description: 'Monto máximo de transacción',
    example: 10000.0,
  })
  max_amount?: number;
}
