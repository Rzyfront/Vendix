import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO to renew (and charge) a membership at reception.
 *
 * The plan price is used by default; `amount` overrides it when a custom charge
 * is needed. `store_payment_method_id` selects the reception payment method
 * (cash / card / transfer). Customer contact fields default to the linked
 * user's data when omitted.
 */
export class RenewMembershipDto {
  @IsInt()
  @Type(() => Number)
  store_payment_method_id!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customer_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customer_phone?: string;
}
