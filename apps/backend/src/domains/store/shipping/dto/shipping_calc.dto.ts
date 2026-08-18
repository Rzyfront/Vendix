import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  ValidateNested,
  IsArray,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ShippingAddressDto {
  @IsString()
  country_code: string;

  @IsString()
  @IsOptional()
  state_province?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address_line1?: string;

  @IsString()
  @IsOptional()
  address_line2?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[\d+#*\s()-]*$/, {
    message:
      'El teléfono solo puede contener números y los símbolos + # * ( ) -',
  })
  phone_number?: string;

  @IsString()
  @IsOptional()
  postal_code?: string;

  /**
   * Código DANE del municipio, resuelto por el selector de ciudad del checkout.
   *
   * El storefront lo envía desde `checkout.component.ts` desde el 2026-07-31
   * (commit 7a6590893), pero el DTO nunca lo declaró. Con
   * `forbidNonWhitelisted` activo eso no se ignora: devuelve
   * `400 SYS_VALIDATION_001 "property municipality_code should not exist"` y
   * deja `shipping_options` vacío, lo que **bloquea el botón Continuar del
   * checkout web para toda compra con envío**. Declararlo es la corrección
   * mínima; el campo se acepta y hoy no se usa para cotizar.
   */
  @IsString()
  @IsOptional()
  municipality_code?: string;

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

export class CartItemCalcDto {
  @IsInt()
  product_id: number;

  @IsInt()
  quantity: number;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  price: number;
}

export class CalculateShippingDto {
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  address: ShippingAddressDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemCalcDto)
  items: CartItemCalcDto[];
}
