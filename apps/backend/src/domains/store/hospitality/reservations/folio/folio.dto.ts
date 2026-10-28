import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** H3.4 — manual charge (laundry, minibar): an existing product or service. */
export class AddFolioChargeDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  product_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  product_variant_id?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;

  /**
   * Unit price in the catalog's terms (like `products.base_price`) when it
   * differs from the catalog, e.g. laundry by weight. Needs the POS price
   * override rule.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unit_price?: number;
}

/** H3.4 — voiding a folio line always needs a reason. */
export class VoidFolioChargeDto {
  @IsString()
  @MinLength(3, { message: 'Escribe el motivo de la anulación' })
  @MaxLength(500)
  reason!: string;
}

/** H3.4 — partial payment of the folio balance (direct payment, D3). */
export class FolioPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  store_payment_method_id!: number;

  /** Client key of this payment attempt: a double click registers it once. */
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  request_id!: string;
}

/** H3.6 — "Cargos bloqueados" on or off. */
export class FolioChargesBlockedDto {
  @IsBoolean()
  blocked!: boolean;
}

/** H3.9 — "No residente – exento de IVA" of the holder on or off. */
export class FolioVatExemptionDto {
  @IsBoolean()
  enabled!: boolean;
}
