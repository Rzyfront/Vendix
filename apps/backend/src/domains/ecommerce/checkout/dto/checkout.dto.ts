import {
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  IsIn,
  IsBoolean,
  ValidateIf,
  ValidateNested,
  Min,
  Max,
  IsNumber,
  IsDateString,
  Matches,
  IsEmail,
  IsPositive,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class CheckoutCartItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description:
      'Presentacion de venta elegida por el comprador (price_tiers.kind=sale_unit): "Bulto 50kg", "Kilo", "Rollo 20 m". Omitirlo conserva la presentacion por defecto del producto. La tarifa se autoriza en el servidor contra la tienda y el producto, y exige el flag ecommerce.catalog.enable_sale_unit_selector. quantity siempre cuenta PAQUETES de esta presentacion, nunca unidades de stock.',
    example: 67,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  price_tier_id?: number;
}

export class GuestCheckoutCustomerDto {
  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsOptional()
  @IsString()
  document_number?: string;
}

export class CheckoutShippingAddressDto {
  @IsString()
  address_line1: string;

  @IsOptional()
  @IsString()
  address_line2?: string;

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  state_province?: string;

  @IsString()
  country_code: string;

  @IsOptional()
  @IsString()
  postal_code?: string;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

/**
 * NOTA comprobante: el soporte de pago NO viaja en este DTO sino como
 * multipart `file` (`POST /ecommerce/checkout`, `FileInterceptor('file')`,
 * 5 MB). Con `ecommerce.checkout.require_payment_receipt` activo, el backend
 * rechaza bank_transfer/voucher sin archivo (ECOM_CHECKOUT_001); con el flag
 * apagado el archivo es opcional y se ignora en métodos no elegibles.
 */
export class CheckoutDto {
  // Booking selections for bookable services
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutBookingDto)
  bookings?: CheckoutBookingDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_method_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_rate_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_address_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutShippingAddressDto)
  shipping_address?: CheckoutShippingAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuestCheckoutCustomerDto)
  guest_customer?: GuestCheckoutCustomerDto;

  /**
   * pago opcional solo cuando `pending_shipping_assignment` es true: la
   * orden se crea sin fila de `payments`, la tienda cobra por fuera del
   * sistema tras contactar al comprador por WhatsApp para acordar envío.
   */
  @ValidateIf((o) => !o.pending_shipping_assignment)
  @IsInt()
  @Min(1)
  payment_method_id?: number;

  /**
   * ID de la cuenta bancaria destino para `bank_transfer` / `voucher`.
   * Validado en backend con `resolveAndValidateBankAccount` antes de
   * persistir el pago. Opcional: los métodos sin cuenta (cash, card, wompi,
   * wallet) lo ignoran. QUI-728.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  bank_account_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutCartItemDto)
  items?: CheckoutCartItemDto[];

  /**
   * Optional coupon code provided by the customer. When set, the backend
   * validates it against {@link CouponsService.validate}; the discount is
   * applied on top of automatic promotion discounts. Invalid codes raise an
   * error and abort the checkout — frontend must NOT send the code unless
   * the customer explicitly entered it.
   *
   * Trim + uppercase is done by the validator. Totals are never sent from
   * the client — backend recomputes every value.
   */
  @IsOptional()
  @IsString()
  coupon_code?: string;

  /**
   * Canal de la venta. El storefront envía `'whatsapp'` cuando la orden se
   * finaliza con "Finalizar por WhatsApp": recorre EXACTAMENTE el mismo
   * núcleo (validación, cálculo, persistencia) y solo cambia el post-éxito
   * en el frontend (resumen + deep-link a `wa.me` con automensaje).
   * Default `'ecommerce'`. Cualquier otro valor se rechaza por whitelist.
   */
  @ApiPropertyOptional({
    description:
      "Canal de la venta: 'ecommerce' (default) o 'whatsapp' (finalizada por WhatsApp).",
    example: 'whatsapp',
  })
  @IsOptional()
  @IsIn(['ecommerce', 'whatsapp'])
  channel?: string;

  /**
   * Fallback de checkout cuando no se pudo ubicar al comprador (sin
   * coordenadas ni geocode válido — ver `vendix-shipping-distance-pricing`
   * regla 6). El comprador confirma la orden por WhatsApp SIN método/tarifa
   * de envío elegidos; la tienda asigna el envío después (`assignShipping`)
   * al contactarlo. Requiere `channel='whatsapp'`, prohíbe
   * `shipping_method_id`/`shipping_rate_id`, y exige que la tienda tenga
   * `ecommerce.checkout.whatsapp_checkout=true` con `whatsapp_number`
   * configurado (`ECOM_CHECKOUT_PENDING_SHIPPING_001` en cualquier otro
   * caso). La orden se crea con `delivery_type='other'`, `shipping_cost=0`,
   * sin fila de `payments` y sin factura DIAN automática.
   */
  @ApiPropertyOptional({
    description:
      'Cuando es true, crea la orden por WhatsApp con envío por asignar (sin método/tarifa, la tienda lo resuelve después). Requiere channel=whatsapp y la tienda con checkout por WhatsApp habilitado.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  pending_shipping_assignment?: boolean;
}

class CheckoutBookingDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;
}
