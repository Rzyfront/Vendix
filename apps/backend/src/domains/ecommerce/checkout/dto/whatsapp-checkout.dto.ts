import {
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  IsPositive,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CheckoutShippingAddressDto,
  GuestCheckoutCustomerDto,
} from './checkout.dto';

class WhatsappCartItemDto {
  @IsInt()
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description:
      'Presentacion de venta elegida por el comprador (price_tiers.kind=sale_unit). Mismo contrato que el checkout web: se autoriza en el servidor contra tienda y producto, exige el flag ecommerce.catalog.enable_sale_unit_selector, y quantity cuenta PAQUETES de esta presentacion.',
    example: 67,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  price_tier_id?: number;
}

export class WhatsappCheckoutDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsappCartItemDto)
  items?: WhatsappCartItemDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_method_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_rate_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutShippingAddressDto)
  shipping_address?: CheckoutShippingAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuestCheckoutCustomerDto)
  guest_customer?: GuestCheckoutCustomerDto;

  /**
   * Optional coupon code applied to the WhatsApp checkout. Backend validates
   * via CouponsService and persists `coupon_uses` + `discount_amount` on the
   * order. Invalid codes abort the checkout.
   */
  @IsOptional()
  @IsString()
  coupon_code?: string;
}
