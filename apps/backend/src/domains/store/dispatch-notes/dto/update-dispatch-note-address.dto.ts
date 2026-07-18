import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  MinLength,
  MaxLength,
  Length,
} from 'class-validator';

/**
 * Payload para re-snapshotear la dirección de entrega de una remisión.
 *
 * El snapshot persistido en `dispatch_notes.customer_address` usa las claves
 * de la tabla `addresses` (`address_line1`, `state_province`,
 * `country_code`, ...), NO el vocabulario del DTO. El service mapea
 * `address_line_1` → `address_line1` al construir el JSON congelado.
 *
 * Este endpoint es independiente del status de la remisión: solo afecta
 * display+mapa, no toca inventario ni contabilidad.
 */
export class UpdateDispatchNoteAddressDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(150)
  address_line_1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  address_line_2?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state_province?: string;

  @IsOptional()
  @IsString()
  @Length(2, 3)
  country_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postal_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
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